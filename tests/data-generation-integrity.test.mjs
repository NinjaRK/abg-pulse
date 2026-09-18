import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sealPayload, snapshotIdentity, utcTime, positiveLimit, validateSourceCounts, verifyPayloadHash } from '../lib/data-integrity.mjs';
import { filterLiveSnapshot, validateLiveSnapshot } from '../lib/live-snapshot.mjs';
import claimsHandler, { validateClaimEvidenceGraph } from '../api/claims.js';
import scanHandler from '../api/scan.js';
import { buildClaimEvidenceGraph } from '../lib/claim-evidence.mjs';
import { applyEventSupportPolicy } from '../lib/claim-support.mjs';
import { verifySnapshotPublication, verifySnapshotConsumer, verifyClaimPublication, verifyClaimConsumer, verifyClaimManifest } from '../scripts/verify-data-generation.mjs';
import { fixtureSource, sourceChecks } from './helpers/governed-fixtures.mjs';

const now = new Date('2026-09-18T12:00:00.000Z');
const stamp = minutes => new Date(now.getTime() - minutes * 60_000).toISOString();
function snapshot(age = 1) {
  return sealPayload({ schemaVersion: 1, generatedAt: stamp(age), windowStart: stamp(age + 1440), windowEnd: stamp(age),
    source: fixtureSource, events: [{ id: 'e1', title: 'A synthetic disclosure', facts: ['A synthetic disclosure was published.'], publishedAt: stamp(10), updatedAt: stamp(10), entityIds: ['example'],
      sources: [{ name: 'Example official', url: 'https://official.example/disclosure', tier: 0 }] }],
    meta: { queryCount: 3, successfulQueries: 2, sourceChecks: sourceChecks(3,2), eventCount: 1, registryReconciled: true } });
}
function graphFrom(input = snapshot(), generatedAt = stamp(0)) {
  const graph = buildClaimEvidenceGraph(input.events, { generatedAt, sourceCommit: input.source.commitSha });
  graph.quality = { publishable: true, unsupportedMaterialClaimCount: 0 };
  graph.input = { governedSnapshotGeneratedAt: input.generatedAt, governedSnapshotSourceCommit: graph.sourceCommit,
    governedSnapshotWorkflowRunId: input.source.workflowRunId || null, governedSnapshotWorkflowRunAttempt: input.source.workflowRunAttempt || null,
    governedSnapshotIdentity: snapshotIdentity(input), governedSnapshotEventCount: input.events.length };
  return sealPayload(graph);
}
function consumer(input = snapshot()) {
  const result = filterLiveSnapshot(input, { start: stamp(1440), end: stamp(0) }, { now, allowTrailingLag: true });
  result.events = result.events.map(applyEventSupportPolicy);
  return result;
}
const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(text) { this.body = JSON.parse(text); } });

test('content hash matches the existing serialized placeholder format, without mutating data', () => {
  const s = snapshot(), original = JSON.stringify(s), copy = structuredClone(s);
  copy.integrity.payloadHash = null;
  assert.equal(s.integrity.payloadHash, createHash('sha256').update(JSON.stringify(copy)).digest('hex'));
  assert.equal(verifyPayloadHash(s, 'snapshot'), s.integrity.payloadHash);
  assert.equal(JSON.stringify(s), original);
});
for (const value of [null, undefined, false, 0, '', '2026-09-18', '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-09-18T24:00:00Z', '2026-09-18T12:00:00', 'not-a-date']) {
  test(`strict timestamps reject ${String(value)}`, () => assert.throws(() => utcTime(value)));
}
test('valid UTC seconds and millisecond precision are preserved', () => {
  assert.equal(utcTime('2026-09-18T12:00:00Z'), now.getTime());
  assert.equal(utcTime('2026-09-18T12:00:00.1Z'), now.getTime()+100);
  assert.ok(Number.isFinite(utcTime('2024-02-29T00:00:00.000Z')));
});
for (const value of [null, '', ' ', false, true, NaN, Infinity, -1, 0, 'NaN', 'Infinity', '0x10']) {
  test(`configuration rejects invalid limit ${String(value)}`, () => assert.throws(() => positiveLimit(value, 90)));
}
test('only an absent setting uses its default; a numeric environment string remains valid', () => {
  assert.equal(positiveLimit(undefined, 90), 90); assert.equal(positiveLimit('90', 90), 90);
});
const malformedChecks = [
  ['more successes than attempts', m => m.successfulQueries = 4],
  ['numeric string', m => m.queryCount = '3'], ['fractional total', m => m.queryCount = 3.5],
  ['negative total', m => m.queryCount = -1], ['missing outcomes', m => m.sourceChecks = []],
  ['extra outcomes', m => m.sourceChecks.push({ name: 'extra', ok: true })],
  ['duplicate source name', m => m.sourceChecks[1].name = m.sourceChecks[0].name],
  ['string boolean', m => m.sourceChecks[0].ok = 'true'], ['contradictory status', m => m.sourceChecks[0].status = 'failed'],
  ['negative item count', m => m.sourceChecks[0].itemCount = -1],
  ['success total disagrees with outcomes', m => m.successfulQueries = 3],
  ['wrong event total', m => m.eventCount = 2], ['wrong claimed ratio', m => m.successRatio = 1]
];
for (const [name, mutate] of malformedChecks) test(`source reconciliation rejects ${name}`, () => {
  const s = snapshot(); mutate(s.meta);
  assert.throws(() => validateSourceCounts(s.meta, s.events.length), { code: 'snapshot_source_counts_invalid' });
});
for (const value of [NaN, Infinity, 0, -0.1, 1.1, null, '']) test(`snapshot ratio configuration cannot bypass checks: ${String(value)}`, () => {
  assert.throws(() => validateLiveSnapshot(snapshot(), { minimumSuccessRatio: value }), { code: 'snapshot_coverage_config_invalid' });
});
test('healthy response with zero items is distinct from an unsuccessful source', () => {
  const s = snapshot(); s.meta.sourceChecks[0].itemCount = 0;
  assert.equal(validateSourceCounts(s.meta,1), 2/3);
  assert.equal(s.meta.sourceChecks[0].ok, true); assert.equal(s.meta.sourceChecks[2].ok, false);
});
test('payload tampering is detected even when shape and counts remain valid', () => {
  const s = snapshot(); s.events[0].title = 'Modified after hashing';
  assert.throws(() => validateLiveSnapshot(s), { code: 'snapshot_integrity_mismatch' });
});
test('unsealed legacy snapshots are rejected rather than inventing integrity evidence', () => {
  const s = snapshot(); delete s.integrity;
  assert.throws(() => validateLiveSnapshot(s), { code: 'snapshot_integrity_missing' });
});
test('snapshot staleness has no rounding grace beyond the exact threshold', () => {
  const s = snapshot(90);
  filterLiveSnapshot(s, { start: s.windowStart, end: s.windowEnd }, { now });
  assert.throws(() => filterLiveSnapshot(s, { start: s.windowStart, end: s.windowEnd }, { now: new Date(now.getTime()+1) }), { code: 'snapshot_stale' });
});
test('a future snapshot beyond clock-skew tolerance is rejected', () => {
  const s = snapshot(-2);
  assert.throws(() => filterLiveSnapshot(s, { start: s.windowStart, end: s.windowEnd }, { now }), { code: 'snapshot_timestamp_future' });
});
test('new graph cannot make a month-old input fresh', () => {
  assert.throws(() => validateClaimEvidenceGraph(graphFrom(snapshot(30*1440)), { now }), { code: 'claim_graph_input_stale' });
});
test('upstream coverage age is validated separately from input generation age', () => {
  const s = snapshot(); s.windowEnd = stamp(181);
  assert.throws(() => validateClaimEvidenceGraph(graphFrom(sealPayload(s)), { now }), { code: 'claim_graph_input_stale' });
});
test('future graph timestamps cannot become age zero', () => {
  assert.throws(() => validateClaimEvidenceGraph(graphFrom(snapshot(), stamp(-2)), { now }), { code: 'claim_graph_timestamp_future' });
});
test('a graph cannot predate the snapshot it claims to use', () => {
  assert.throws(() => validateClaimEvidenceGraph(graphFrom(snapshot(), stamp(5)), { now }), { code: 'claim_graph_input_invalid' });
});
for (const field of ['generatedAt', 'sourceCommit', 'payloadHash', 'generationId', 'sourceWorkflowRunAttempt']) test(`changing input identity ${field} invalidates claims`, () => {
  const graph = graphFrom(); graph.input.governedSnapshotIdentity[field] = 'untrusted';
  assert.throws(() => validateClaimEvidenceGraph(sealPayload(graph), { now }));
});
test('input and output freshness boundaries are evaluated without rounding down', () => {
  const graph = graphFrom(snapshot(180), stamp(0));
  const result = validateClaimEvidenceGraph(graph, { now }); assert.equal(result.inputAgeMinutes, 180);
  assert.throws(() => validateClaimEvidenceGraph(graph, { now: new Date(now.getTime()+1) }), { code: 'claim_graph_input_stale' });
  const old = graphFrom(snapshot(241), stamp(240));
  validateClaimEvidenceGraph(old, { now, inputStaleAfterMinutes: 300 });
  assert.throws(() => validateClaimEvidenceGraph(old, { now: new Date(now.getTime()+1), inputStaleAfterMinutes: 300 }), { code: 'claim_graph_stale' });
});
test('a tampered claim is rejected before policy projection or display', () => {
  const graph = graphFrom(); graph.claims[0].text = 'Changed claim';
  assert.throws(() => validateClaimEvidenceGraph(graph, { now }), { code: 'claim_graph_integrity_mismatch' });
});
test('unsealed legacy graphs require regeneration and cannot quietly opt out of validation', () => {
  const graph = graphFrom(); delete graph.integrity;
  assert.throws(() => validateClaimEvidenceGraph(graph, { now }), { code: 'claim_graph_integrity_missing' });
});
test('counts and materiality gate cannot use missing or string-valued counters', () => {
  const graph = graphFrom(); graph.summary.claimCount = 40;
  assert.throws(() => validateClaimEvidenceGraph(sealPayload(graph), { now }), { code: 'claim_graph_counts_invalid' });
  graph.quality.unsupportedMaterialClaimCount = '0';
  assert.throws(() => validateClaimEvidenceGraph(sealPayload(graph), { now }), { code: 'unsupported_material_claims' });
});
test('fresh older data made by the same code fails exact-generation publication verification', () => {
  assert.throws(() => verifySnapshotPublication(snapshot(), snapshot(2), now));
});
test('rerun attempts remain distinguishable even at the same commit and generation timestamp', () => {
  const old = snapshot(), next = structuredClone(old); next.source.workflowRunAttempt = '2';
  assert.notEqual(snapshotIdentity(old).generationId, snapshotIdentity(sealPayload(next)).generationId);
  assert.throws(() => verifySnapshotPublication(sealPayload(next), old, now));
});
test('exact generation verifies publication and the actual transformed event body', () => {
  const s = snapshot(); verifySnapshotPublication(s, structuredClone(s), now);
  assert.equal(verifySnapshotConsumer(s, consumer(s), now).generationId, snapshotIdentity(s).generationId);
});
test('cached consumer generation fails even though its code SHA matches', () => {
  assert.throws(() => verifySnapshotConsumer(snapshot(), consumer(snapshot(2)), now));
});
test('a forged consumer identity cannot conceal changed event content', () => {
  const payload = consumer(); payload.events[0].title = 'Unrelated contents';
  assert.throws(() => verifySnapshotConsumer(snapshot(), payload, now));
});
test('consumer source counts and coverage notices must agree with verified input', () => {
  const payload = consumer(); payload.meta.successfulQueries++;
  assert.throws(() => verifySnapshotConsumer(snapshot(), payload, now));
  const other = consumer(); other.meta.snapshot.coverageComplete = true;
  assert.throws(() => verifySnapshotConsumer(snapshot(), other, now));
});
test('claim publication must match exact graph and input, not just summary size or code SHA', () => {
  const graph = graphFrom(); verifyClaimPublication(graph, structuredClone(graph), now);
  const old = graphFrom(snapshot(2)); assert.equal(old.summary.claimCount, graph.summary.claimCount);
  assert.throws(() => verifyClaimPublication(graph, old, now));
});
test('invalid evaluation clocks and freshness overrides fail closed', () => {
  assert.throws(() => validateClaimEvidenceGraph(graphFrom(), { now: new Date('invalid') }), { code: 'data_clock_invalid' });
  for (const value of [NaN, Infinity, -1, 0, null, '']) {
    assert.throws(() => validateClaimEvidenceGraph(graphFrom(), { now, staleAfterMinutes: value }));
    assert.throws(() => validateClaimEvidenceGraph(graphFrom(), { now, inputStaleAfterMinutes: value }));
  }
});

test('API consumers avoid cache replay and expose original generation provenance with safe projection', async () => {
  const priorFetch = globalThis.fetch, priorMode = process.env.ABG_SCAN_MODE;
  const s = snapshot(); const delta = Date.now() - now.getTime();
  for (const key of ['generatedAt','windowStart','windowEnd']) s[key] = new Date(Date.parse(s[key])+delta).toISOString();
  const input = sealPayload(s), graph = graphFrom(input, new Date().toISOString());
  const calls = []; process.env.ABG_SCAN_MODE = 'snapshot';
  try {
    globalThis.fetch = async (url, options) => { calls.push({url,options}); return { ok:true, json:async()=> input }; };
    const scan = response(); await scanHandler({ method:'GET', url:'/api/scan', headers:{} }, scan);
    assert.equal(scan.statusCode,200,JSON.stringify(scan.body));
    assert.equal(scan.headers['cache-control'],'no-store'); assert.equal(scan.headers['vercel-cdn-cache-control'],'no-store');
    assert.equal(scan.body.meta.snapshot.generationId,snapshotIdentity(input).generationId);
    globalThis.fetch = async (url, options) => { calls.push({url,options}); return { ok:true, json:async()=>graph }; };
    const claims = response(); await claimsHandler({ method:'GET', url:'/api/claims?summaryOnly=true' }, claims);
    assert.equal(claims.statusCode,200,JSON.stringify(claims.body)); verifyClaimConsumer(graph, claims.body, new Date());
    const altered = structuredClone(claims.body); altered.freshness.graphGenerationId = '0'.repeat(64);
    assert.throws(()=>verifyClaimConsumer(graph,altered,new Date()));
    assert.equal(claims.body.summary.supportedFactClaims,0);
    for (const call of calls) { assert.equal(call.options.cache,'no-store'); assert.ok(new URL(call.url).searchParams.has('abg_read')); }
    assert.equal(calls.length,2);
  } finally { globalThis.fetch = priorFetch; if(priorMode === undefined) delete process.env.ABG_SCAN_MODE; else process.env.ABG_SCAN_MODE=priorMode; }
});

test('the real claims builder produces sealed input-linked output from a valid file', () => {
  const dir = mkdtempSync(join(tmpdir(),'abg-builder-'));
  try {
    const s = snapshot(); const delta=Date.now()-now.getTime();
    for(const key of ['generatedAt','windowStart','windowEnd']) s[key]=new Date(Date.parse(s[key])+delta).toISOString();
    const input = sealPayload(s); writeFileSync(join(dir,'input.json'),JSON.stringify(input));
    const env={...process.env,CLAIM_EVIDENCE_INPUT_FILE:join(dir,'input.json'),CLAIM_EVIDENCE_OUTPUT:join(dir,'graph.json'),CLAIM_EVIDENCE_MANIFEST_OUTPUT:join(dir,'manifest.json')};
    const run=spawnSync(process.execPath,['scripts/build-claim-evidence-snapshot.mjs'],{encoding:'utf8',env,timeout:10000});
    assert.equal(run.status,0,run.stderr);
    const raw=readFileSync(join(dir,'graph.json'),'utf8'), graph=JSON.parse(raw), manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
    assert.equal(manifest.sha256,createHash('sha256').update(raw).digest('hex'));
    assert.equal(graph.input.governedSnapshotIdentity.generationId,snapshotIdentity(input).generationId);
    assert.equal(validateClaimEvidenceGraph(graph).integrityVerified,true);
    input.events[0].title='tampered';writeFileSync(join(dir,'input.json'),JSON.stringify(input));
    const failed=spawnSync(process.execPath,['scripts/build-claim-evidence-snapshot.mjs'],{encoding:'utf8',env,timeout:10000});
    assert.notEqual(failed.status,0);assert.match(failed.stderr,/hash/i);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('both publisher workflows require exact publication and consumer generation proofs', () => {
  const snapshotWorkflow=readFileSync(new URL('../.github/workflows/refresh-live-snapshot.yml',import.meta.url),'utf8');
  const claimWorkflow=readFileSync(new URL('../.github/workflows/refresh-claim-evidence.yml',import.meta.url),'utf8');
  for(const name of ['snapshot-publication','snapshot-consumer']) assert.ok(snapshotWorkflow.includes(`verify-data-generation.mjs ${name}`));
  for(const name of ['claims-publication','claims-consumer']) assert.ok(claimWorkflow.includes(`verify-data-generation.mjs ${name}`));
  assert.ok(snapshotWorkflow.includes('git worktree add --detach'));
  assert.ok(snapshotWorkflow.includes('${{ github.run_attempt }}')); assert.ok(claimWorkflow.includes('${{ github.run_attempt }}'));
  assert.doesNotMatch(snapshotWorkflow,/source_sha.*GITHUB_SHA/);
});


test('public graph bytes and manifest must match the locally built generation', () => {
  const graph=graphFrom(), text=JSON.stringify(graph), expected={sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text),generatedAt:graph.generatedAt};
  assert.equal(verifyClaimManifest(expected,structuredClone(expected),text).manifestSha256,expected.sha256);
  assert.throws(()=>verifyClaimManifest(expected,{...expected,generatedAt:stamp(2)},text));
  assert.throws(()=>verifyClaimManifest(expected,expected,text+' '));
});
test('CLI refuses a cached older snapshot and preserves the negative result', () => {
  const dir=mkdtempSync(join(tmpdir(),'abg-generation-cli-'));
  try {
    // Current timestamps keep the CLI clock real; the mismatch is data identity.
    const expected=snapshot(),delta=Date.now()-now.getTime();
    for(const key of ['generatedAt','windowStart','windowEnd']) expected[key]=new Date(Date.parse(expected[key])+delta).toISOString();
    const current=sealPayload(expected),older=structuredClone(current);older.source.workflowRunAttempt='2';
    writeFileSync(join(dir,'expected.json'),JSON.stringify(current));writeFileSync(join(dir,'actual.json'),JSON.stringify(sealPayload(older)));
    const run=spawnSync(process.execPath,['scripts/verify-data-generation.mjs','snapshot-publication',join(dir,'expected.json'),join(dir,'actual.json')],{encoding:'utf8',timeout:10000});
    assert.equal(run.status,1);assert.equal(JSON.parse(run.stderr).passed,false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
