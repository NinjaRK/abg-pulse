import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DEFAULT_LIVE_SNAPSHOT_URL, filterLiveSnapshot } from '../lib/live-snapshot.mjs';
import scanHandler from '../api/scan.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function runBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s+)run: \|[-+]?\s*$/);
    if (!match) continue;
    const keyIndent = match[1].length;
    const body = [];
    while (++i < lines.length && (!lines[i].trim() || lines[i].match(/^\s*/)[0].length > keyIndent)) body.push(lines[i]);
    i--;
    const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length));
    blocks.push(body.map((line) => line.slice(indent)).join('\n') + '\n');
  }
  return blocks;
}

test('claims builder and scheduled reader use the canonical published snapshot path', () => {
  const script = read('scripts/build-claim-evidence-snapshot.mjs');
  const workflow = read('.github/workflows/refresh-claim-evidence.yml');
  assert.doesNotMatch(script + workflow, /live-data\/data\/live-snapshot\.json/);
  assert.match(script, /import \{ DEFAULT_LIVE_SNAPSHOT_URL \} from '\.\.\/lib\/live-snapshot\.mjs'/);
  assert.ok(workflow.includes(`CLAIM_EVIDENCE_INPUT_URL: ${DEFAULT_LIVE_SNAPSHOT_URL}`));
});
for (const path of ['.github/workflows/refresh-live-snapshot.yml', '.github/workflows/refresh-claim-evidence.yml']) {
  test(`every multiline shell block parses: ${path}`, () => {
    const blocks = runBlocks(read(path));
    assert.ok(blocks.length >= 3, 'Expected workflow shell steps to be checked.');
    blocks.forEach((block, i) => {
      const result = spawnSync('bash', ['-n'], { input: block, encoding: 'utf8' });
      assert.equal(result.status, 0, `Run block ${i + 1}: ${result.stderr}`);
    });
  });
}
const now = new Date('2026-09-08T10:00:00.000Z');
function snapshot() {
  return {
    schemaVersion: 1, generatedAt: '2026-09-08T09:50:00.000Z',
    windowStart: '2026-08-09T09:50:00.000Z', windowEnd: '2026-09-08T09:50:00.000Z',
    source: { commitSha: 'a'.repeat(40), workflowRunId: 'test' },
    events: [{ id: 'event-live', publishedAt: '2026-09-08T09:45:00.000Z', updatedAt: '2026-09-08T09:45:00.000Z' }],
    meta: { queryCount: 10, successfulQueries: 8, sourceChecks: [], registryReconciled: true }
  };
}
const window = { start: '2026-09-07T10:00:00.000Z', end: now.toISOString() };

test('a rolling window can show fresh evidence with the unchecked tail explicit', () => {
  const result = filterLiveSnapshot(snapshot(), window, { now, allowTrailingLag: true });
  assert.equal(result.events.length, 1);
  assert.equal(result.meta.snapshot.coverageComplete, false);
  assert.equal(result.meta.snapshot.coverageLagMinutes, 10);
  assert.equal(result.meta.snapshot.coverageThrough, snapshot().windowEnd);
  assert.match(result.meta.snapshot.coverageNotice, /not yet checked/i);
});
test('strict historical coverage remains the default', () => {
  assert.throws(() => filterLiveSnapshot(snapshot(), window, { now }), { code: 'snapshot_window_incomplete' });
});
test('trailing lag cannot excuse missing history or no overlap', () => {
  for (const requested of [
    { ...window, start: '2026-08-01T00:00:00.000Z' },
    { start: '2026-09-08T09:55:00.000Z', end: now.toISOString() }
  ]) assert.throws(() => filterLiveSnapshot(snapshot(), requested, { now, allowTrailingLag: true }), { code: 'snapshot_window_incomplete' });
});
test('trailing lag cannot excuse stale coverage, future requests, or future snapshots', () => {
  assert.throws(() => filterLiveSnapshot(snapshot(), window, { now: new Date('2026-09-08T12:00:00.000Z'), allowTrailingLag: true }), { code: 'snapshot_stale' });
  assert.throws(() => filterLiveSnapshot(snapshot(), { ...window, end: '2026-09-08T11:00:00.000Z' }, { now, allowTrailingLag: true }), { code: 'snapshot_window_incomplete' });
  assert.throws(() => filterLiveSnapshot({ ...snapshot(), generatedAt: '2026-09-08T11:00:00.000Z' }, window, { now, allowTrailingLag: true }), { code: 'snapshot_timestamp_future' });
});
test('invalid freshness settings cannot bypass live snapshot checks', () => {
  for (const staleAfterMinutes of [NaN, Infinity, -1, 0]) {
    assert.throws(() => filterLiveSnapshot(snapshot(), window, { now, allowTrailingLag: true, staleAfterMinutes }), { code: 'snapshot_freshness_config_invalid' });
  }
});
test('production rolling refresh uses one fetch and returns visible snapshot lag', async () => {
  const previousFetch = globalThis.fetch;
  const priorMode = process.env.ABG_SCAN_MODE;
  let count = 0;
  process.env.ABG_SCAN_MODE = 'snapshot';
  globalThis.fetch = async () => {
    count++;
    const generatedAt = new Date(Date.now() - 600_000).toISOString();
    return { ok: true, json: async () => ({ ...snapshot(), generatedAt, windowEnd: generatedAt,
      windowStart: new Date(Date.now() - 29 * 86400_000).toISOString() }) };
  };
  const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
  try {
    await scanHandler({ method: 'GET', url: '/api/scan', headers: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(count, 1);
    assert.equal(res.body.meta.snapshot.coverageComplete, false);
    assert.ok(res.body.meta.snapshot.coverageLagMinutes >= 9.9);
  } finally {
    globalThis.fetch = previousFetch;
    if (priorMode === undefined) delete process.env.ABG_SCAN_MODE; else process.env.ABG_SCAN_MODE = priorMode;
  }
});

test('the production feed verifier rejects an old deployment instead of claiming delivery', async () => {
  const { verifyLiveFeed } = await import('../scripts/verify-live-feed.mjs');
  const result = await verifyLiveFeed({ expectedCommit: 'a'.repeat(40), now,
    fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ deployment: { commitSha: 'b'.repeat(40) } }) }) });
  assert.equal(result.deploymentVerified, false);
  assert.equal(result.feedVerified, false);
  assert.equal(result.databaseOperational, null);
  assert.match(result.error, /exact reviewed code/i);
});

test('the UI presents the unchecked interval instead of claiming complete coverage', () => {
  const app = read('app.js');
  assert.match(app, /snapshot\.coverageThrough \|\| snapshot\.windowEnd/);
  assert.match(app, /newer period not yet checked/);
  assert.match(app, /escapeHtml\(coverageNotice\)/);
});
