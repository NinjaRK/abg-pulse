import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAuthoritativeRecords,
  loadAuthoritativeSnapshot,
  validateAuthoritativeSnapshot
} from '../api/authoritative.js';

const baseSnapshot = {
  generatedAt: '2026-09-08T06:00:00.000Z',
  quality: { publishable: true },
  sourceChecks: [
    { sourceId: 'sec-novelis', ok: true },
    { sourceId: 'nse-abg-listed', ok: false }
  ],
  records: [
    { id: 'inside', sourceId: 'sec-novelis', publishedAt: '2026-09-08T05:00:00.000Z' },
    { id: 'outside', sourceId: 'sec-novelis', publishedAt: '2026-09-01T05:00:00.000Z' },
    { id: 'other', sourceId: 'nse-abg-listed', publishedAt: '2026-09-08T05:30:00.000Z' },
    { id: 'undated', sourceId: 'sec-novelis', publishedAt: null }
  ]
};

test('authoritative snapshot validation exposes exact freshness', () => {
  const result = validateAuthoritativeSnapshot(baseSnapshot, {
    now: new Date('2026-09-08T06:45:00.000Z'),
    staleAfterMinutes: 120
  });
  assert.equal(result.ageMinutes, 45);
  assert.equal(result.staleAfterMinutes, 120);
});

test('stale authoritative snapshots fail closed', () => {
  assert.throws(() => validateAuthoritativeSnapshot(baseSnapshot, {
    now: new Date('2026-09-08T09:00:00.000Z'),
    staleAfterMinutes: 120
  }), (error) => error.code === 'snapshot_stale' && error.detail.ageMinutes === 180);
});

test('unpublishable snapshots cannot be served', () => {
  assert.throws(() => validateAuthoritativeSnapshot({ ...baseSnapshot, quality: { publishable: false } }, {
    now: new Date('2026-09-08T06:10:00.000Z')
  }), (error) => error.code === 'snapshot_unpublishable');
});

test('records are filtered by time and selected authoritative sources', () => {
  const records = filterAuthoritativeRecords(baseSnapshot.records, {
    start: '2026-09-08T00:00:00.000Z',
    end: '2026-09-08T06:00:00.000Z',
    sourceIds: new Set(['sec-novelis']),
    includeUndated: false
  });
  assert.deepEqual(records.map((record) => record.id), ['inside']);
});

test('undated records require an explicit opt-in', () => {
  const records = filterAuthoritativeRecords(baseSnapshot.records, {
    start: '2026-09-08T00:00:00.000Z',
    end: '2026-09-08T06:00:00.000Z',
    sourceIds: new Set(['sec-novelis']),
    includeUndated: true
  });
  assert.deepEqual(records.map((record) => record.id), ['inside', 'undated']);
});

test('snapshot loader reports upstream HTTP failures', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => loadAuthoritativeSnapshot({ fetchImpl, url: 'https://example.test/snapshot.json' }), (error) => error.code === 'snapshot_http_error' && error.detail.status === 503);
});

test('snapshot loader accepts structurally valid JSON responses', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => baseSnapshot });
  const payload = await loadAuthoritativeSnapshot({ fetchImpl, url: 'https://example.test/snapshot.json' });
  assert.equal(payload.records.length, 4);
});
