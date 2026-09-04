import test from 'node:test';
import assert from 'node:assert/strict';
import scanHandler from '../api/scan.js';
import {
  SnapshotError,
  filterLiveSnapshot,
  loadLiveSnapshot,
  shouldUseGovernedSnapshot,
  validateLiveSnapshot
} from '../lib/live-snapshot.mjs';
import { generateLiveSnapshot } from '../scripts/refresh-live-snapshot.mjs';

function event(id, publishedAt) {
  return {
    id,
    headline: `Event ${id}`,
    summary: 'A sufficiently complete evidence-backed event summary for governed snapshot testing.',
    whyItMatters: 'It proves that period filtering is performed without launching upstream discovery calls.',
    bucket: 'other',
    status: 'confirmed',
    category: 'Test',
    entityIds: ['abg'],
    publishedAt,
    updatedAt: publishedAt,
    sources: [{ name: 'Official source', url: 'https://example.com/event', tier: 0 }],
    intelligence: { materiality: 50, certainty: 90, momentum: 20, sentiment: 0 }
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    serviceVersion: '6.0.0',
    generatedAt: '2026-09-04T10:00:00.000Z',
    windowStart: '2026-08-05T10:00:00.000Z',
    windowEnd: '2026-09-04T10:00:00.000Z',
    source: { repository: 'NinjaRK/abg-pulse', commitSha: 'abc123', workflowRunId: '42' },
    integrity: { algorithm: 'sha256', payloadHash: 'hash' },
    events: [event('recent', '2026-09-04T09:00:00.000Z'), event('older', '2026-09-01T09:00:00.000Z')],
    entityUniverse: { officialCompanyEntries: 42, officialLeadershipEntries: 40 },
    meta: {
      queryCount: 65,
      successfulQueries: 40,
      sourceChecks: [{ name: 'official', provider: 'Official source', ok: true, status: 'healthy', itemCount: 1 }],
      registryReconciled: true,
      eventCount: 2
    },
    ...overrides
  };
}

function mockResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); },
    json() { return JSON.parse(this.body); },
    headers
  };
}

function request() {
  return {
    method: 'GET',
    url: '/api/scan?start=2026-09-04T08:00:00.000Z&end=2026-09-04T10:00:00.000Z',
    headers: { host: 'abg-pulse.test' }
  };
}

test('production defaults to governed snapshot delivery while local tests default to live mode', () => {
  assert.equal(shouldUseGovernedSnapshot({}, {}), false);
  assert.equal(shouldUseGovernedSnapshot({}, { VERCEL_ENV: 'production' }), true);
  assert.equal(shouldUseGovernedSnapshot({}, { VERCEL_ENV: 'production', ABG_SCAN_MODE: 'live' }), false);
  assert.equal(shouldUseGovernedSnapshot({}, { ABG_SCAN_MODE: 'snapshot' }), true);
});

test('snapshot validation fails closed when source success is too low', () => {
  assert.throws(
    () => validateLiveSnapshot(snapshot({ meta: { queryCount: 65, successfulQueries: 2, sourceChecks: [] } })),
    (error) => error instanceof SnapshotError && error.code === 'snapshot_source_coverage_too_low'
  );
});

test('snapshot filters events to the requested period and exposes provenance', () => {
  const result = filterLiveSnapshot(snapshot(), {
    start: '2026-09-04T08:00:00.000Z',
    end: '2026-09-04T10:00:00.000Z'
  }, { now: new Date('2026-09-04T10:20:00.000Z') });
  assert.deepEqual(result.events.map((item) => item.id), ['recent']);
  assert.equal(result.meta.deliveryMode, 'governed-snapshot');
  assert.equal(result.meta.snapshot.sourceCommit, 'abc123');
  assert.equal(result.meta.snapshot.fresh, true);
  assert.equal(result.meta.snapshot.ageMinutes, 20);
});

test('stale snapshot is rejected instead of silently serving old intelligence', () => {
  assert.throws(
    () => filterLiveSnapshot(snapshot(), {
      start: '2026-09-04T08:00:00.000Z',
      end: '2026-09-04T10:00:00.000Z'
    }, { now: new Date('2026-09-04T12:00:00.000Z'), staleAfterMinutes: 90 }),
    (error) => error instanceof SnapshotError && error.code === 'snapshot_stale'
  );
});

test('snapshot loader performs one controlled fetch and no source fan-out', async () => {
  let calls = 0;
  const result = await loadLiveSnapshot({
    url: 'https://example.com/live-snapshot.json',
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => snapshot() };
    },
    window: { start: '2026-09-04T08:00:00.000Z', end: '2026-09-04T10:00:00.000Z' },
    now: new Date('2026-09-04T10:10:00.000Z')
  });
  assert.equal(calls, 1);
  assert.equal(result.events.length, 1);
});

test('production scan route serves one governed snapshot request', async () => {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    ABG_SCAN_MODE: process.env.ABG_SCAN_MODE,
    LIVE_SNAPSHOT_URL: process.env.LIVE_SNAPSHOT_URL,
    fetch: global.fetch
  };
  process.env.VERCEL_ENV = 'production';
  delete process.env.ABG_SCAN_MODE;
  process.env.LIVE_SNAPSHOT_URL = 'https://example.com/live-snapshot.json';
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    assert.equal(String(url), 'https://example.com/live-snapshot.json');
    return { ok: true, status: 200, json: async () => snapshot() };
  };
  try {
    const res = mockResponse();
    await scanHandler(request(), res);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(calls, 1);
    assert.equal(body.meta.deliveryMode, 'governed-snapshot');
    assert.equal(body.events.length, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (key === 'fetch') continue;
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    global.fetch = previous.fetch;
  }
});

test('production scan route returns 503 when the snapshot is stale', async () => {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    ABG_SCAN_MODE: process.env.ABG_SCAN_MODE,
    LIVE_SNAPSHOT_URL: process.env.LIVE_SNAPSHOT_URL,
    fetch: global.fetch
  };
  process.env.VERCEL_ENV = 'production';
  delete process.env.ABG_SCAN_MODE;
  process.env.LIVE_SNAPSHOT_URL = 'https://example.com/live-snapshot.json';
  global.fetch = async () => ({ ok: true, status: 200, json: async () => snapshot({ generatedAt: '2026-09-04T06:00:00.000Z' }) });
  try {
    const res = mockResponse();
    await scanHandler(request(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, 'snapshot_stale');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (key === 'fetch') continue;
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    global.fetch = previous.fetch;
  }
});

test('snapshot generator rejects a weak scan and records provenance for a healthy scan', async () => {
  const good = await generateLiveSnapshot({
    now: new Date('2026-09-04T10:00:00.000Z'),
    scan: async ({ window }) => ({
      events: [event('generated', '2026-09-04T09:00:00.000Z')],
      entityUniverse: { officialCompanyEntries: 42 },
      meta: { queryCount: 10, successfulQueries: 8, sourceChecks: [], windowStart: window.start, windowEnd: window.end }
    })
  });
  assert.equal(good.schemaVersion, 1);
  assert.equal(good.events.length, 1);
  assert.match(good.integrity.payloadHash, /^[a-f0-9]{64}$/);

  await assert.rejects(
    () => generateLiveSnapshot({
      now: new Date('2026-09-04T10:00:00.000Z'),
      scan: async () => ({ events: [], entityUniverse: {}, meta: { queryCount: 10, successfulQueries: 1, sourceChecks: [] } })
    }),
    /Snapshot rejected/
  );
});
