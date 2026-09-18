import { sealPayload } from '../lib/data-integrity.mjs';
import { sealedGraph } from './helpers/governed-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveClaimEvidenceForEvent, buildClaimEvidenceGraph } from '../lib/claim-evidence.mjs';
import { CLAIM_SUPPORT_POLICY, applyClaimSupportPolicy, applyEventSupportPolicy, eventSupportPresentation, traceableSourceUrl } from '../lib/claim-support.mjs';
import claimsHandler, { projectClaimGraph } from '../api/claims.js';
import scanHandler from '../api/scan.js';
import eventsHandler from '../api/events.js';

const source = { name: 'Example official filing', url: 'https://official.example/annual-report', tier: 0, official: true };
const event = { id: 't51-event', title: 'ExampleCo opened an office on Mars.', facts: ['ExampleCo opened an office on Mars.', 'Its revenue doubled.'], entityIds: ['exampleco'], sources: [source] };
function graph() {
  const g = buildClaimEvidenceGraph([event]);
  g.quality = { publishable: true, unsupportedMaterialClaimCount: 0 };
  return g;
}
function legacy() {
  const g = graph(); delete g.supportPolicy; delete g.statementVerification;
  g.claims.forEach(c => { c.supportStatus = 'supported'; c.supportConfidence = .99; c.independentEvidenceCount = 5; c.verified = true; });
  g.summary.supportedFactClaims = g.claims.length; g.summary.provisionalFactClaims = 0;
  g.eventSummaries.forEach(s => { s.supportedFactClaims = 2; s.provisionalFactClaims = 0; });
  return g;
}
function response() {
  return { headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(v) { this.body = JSON.parse(v); } };
}

test('unrelated official metadata never verifies a fictional assertion or its sibling facts', () => {
  const r = deriveClaimEvidenceForEvent(event);
  for (const c of r.claims) {
    assert.equal(c.supportStatus, 'provisional'); assert.equal(c.supportConfidence, null);
    assert.equal(c.statementVerification, 'not_performed'); assert.equal(c.independentEvidenceCount, null);
  }
});
for (const tier of [0, 1, 2, 3, -1, null, '0']) test(`source tier ${tier} cannot promote metadata to verified`, () => {
  const r = deriveClaimEvidenceForEvent({ ...event, sources: [{ ...source, tier }] });
  assert.ok(r.claims.every(c => c.supportStatus === 'provisional' && c.supportConfidence === null));
});

test('different domains carrying one report are not independent confirmations', () => {
  const r = deriveClaimEvidenceForEvent({ ...event, sources: [
    { name: 'Paper A', url: 'https://paper-a.example/story', tier: 1, wireService: 'Example Wire', originalReportUrl: 'https://wire.example/report/123' },
    { name: 'Paper B', url: 'https://paper-b.example/story', tier: 1, wireService: 'Example Wire', originalReportUrl: 'https://wire.example/report/123' }
  ] });
  assert.equal(r.claims[0].independentEvidenceCount, null); assert.equal(r.claims[0].sourceDomainCount, 2);
  assert.equal(r.claims[0].supportStatus, 'provisional'); assert.equal(r.claims[0].supportConfidence, null);
  assert.equal(r.evidence[0].originalReportUrl, r.evidence[1].originalReportUrl);
});

test('unknown original reporting is unknown, not assumed independent', () => {
  const r = deriveClaimEvidenceForEvent({ ...event, sources: [source, { ...source, url: 'https://another.example/report' }] });
  assert.equal(r.claims[0].independenceAssessment, 'not_established'); assert.equal(r.claims[0].independentEvidenceCount, null);
});

for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///etc/passwd', 'https://user:secret@example.test/a', 'relative/path', null, '']) {
  test(`unsafe/missing source is not traceable: ${url}`, () => {
    assert.equal(traceableSourceUrl(url), null);
    const r = deriveClaimEvidenceForEvent({ ...event, sources: [{ ...source, url }] });
    assert.equal(r.claims[0].supportStatus, 'unsupported'); assert.equal(r.claims[0].supportConfidence, null);
    assert.equal(r.evidence.length, 0);
  });
}

test('legacy confident graph is downgraded without changing its raw text, IDs, dates or hash provenance', () => {
  const raw = legacy(), before = JSON.stringify(raw), view = applyClaimSupportPolicy(raw);
  assert.equal(JSON.stringify(raw), before); assert.equal(view.generatedAt, raw.generatedAt);
  assert.equal(view.supportPolicy, CLAIM_SUPPORT_POLICY); assert.equal(view.summary.supportedFactClaims, 0);
  assert.equal(view.summary.provisionalFactClaims, 2); assert.equal(view.quality.factualAccuracyVerified, false);
  assert.equal(view.eventSummaries[0].supportedFactClaims, 0);
  for (const c of view.claims) { assert.equal(c.supportStatus, 'provisional'); assert.equal(c.supportConfidence, null); assert.equal(c.verified, undefined); }
  assert.deepEqual(view.claims.map(c=>c.id),raw.claims.map(c=>c.id)); assert.deepEqual(view.claims.map(c=>c.text),raw.claims.map(c=>c.text));
  assert.deepEqual(applyClaimSupportPolicy(view), view);
});

test('incoming policy and verified flags cannot opt out of conservative delivery', () => {
  const raw = legacy(); raw.supportPolicy = CLAIM_SUPPORT_POLICY;
  raw.claims[0].statementVerification = 'verified'; raw.claims[0].verification = { approved: true }; raw.claims[0].supportConfidence = 1;
  const c = applyClaimSupportPolicy(raw).claims[0];
  assert.equal(c.statementVerification, 'not_performed'); assert.equal(c.verification, undefined); assert.equal(c.supportConfidence, null);
});

test('supported filter cannot leak legacy supported labels; provisional filter finds relabelled claims', () => {
  const raw = legacy();
  assert.equal(projectClaimGraph(raw, { supportStatus: 'supported' }).claims.length, 0);
  assert.equal(projectClaimGraph(raw, { supportStatus: 'provisional' }).claims.length, 2);
  assert.equal(projectClaimGraph(raw, {}, { summaryOnly: true }).filteredSummary.supportedFactClaims, 0);
});

for (const [name, mutate] of [
  ['cross-event evidence', g => g.evidence[0].eventId = 'unrelated-event'],
  ['orphan reference', g => g.claims[0].evidenceIds = ['missing']],
  ['unsafe evidence URL', g => g.evidence[0].url = 'javascript:alert(1)'],
  ['duplicate evidence ID', g => g.evidence.push(g.evidence[0])],
  ['duplicate claim ID', g => g.claims.push(g.claims[0])],
  ['untraceable factual claim', g => g.claims[0].evidenceIds = []],
  ['unknown kind', g => g.claims[0].kind = 'approved']
]) test(`policy rejects ${name} instead of disguising it as provisional`, () => {
  const raw = legacy(); mutate(raw); assert.throws(() => applyClaimSupportPolicy(raw), e => e.code === 'claim_support_invalid');
});

test('interpretation remains interpretation with no probability of truth', () => {
  const raw = graph(); raw.claims[0].kind = 'interpretation';
  const c = applyClaimSupportPolicy(raw).claims[0]; assert.equal(c.supportStatus, 'interpretation'); assert.equal(c.supportConfidence, null);
});

test('public claims handler corrects legacy summaries and metadata, including summary-only mode', async () => {
  const previous = globalThis.fetch; const raw = sealedGraph(legacy());
  globalThis.fetch = async () => ({ ok: true, json: async () => raw });
  try {
    for (const url of ['/api/claims', '/api/claims?summaryOnly=true', '/api/claims?supportStatus=supported']) {
      const res = response(); await claimsHandler({ method: 'GET', url }, res);
      assert.equal(res.statusCode, 200); assert.equal(res.body.supportPolicy, CLAIM_SUPPORT_POLICY);
      assert.equal(res.body.summary.supportedFactClaims, 0); assert.equal(res.body.filteredSummary.supportedFactClaims, 0);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.ok(res.body.claims.every(c => c.supportStatus !== 'supported' && c.supportConfidence === null));
      assert.match(res.body.methodology.supported, /does not emit supported/);
    }
  } finally { globalThis.fetch = previous; }
});

test('live scan strips cached event confirmation and certainty without altering upstream payload', async () => {
  const previous = globalThis.fetch, oldMode = process.env.ABG_SCAN_MODE;
  const now = Date.now(); const item = { ...event, status: 'confirmed', intelligence: { certainty: 99, materiality: 80 }, publishedAt: new Date(now - 60_000).toISOString() };
  const snapshot = sealPayload({ schemaVersion: 1, generatedAt: new Date(now).toISOString(), windowStart: new Date(now - 3 * 86400_000).toISOString(), windowEnd: new Date(now).toISOString(), source: { commitSha: 'a'.repeat(40) }, events: [item], meta: { queryCount: 1, successfulQueries: 1, sourceChecks: [{ name: 'test-source', ok: true }] } });
  process.env.ABG_SCAN_MODE = 'snapshot'; globalThis.fetch = async () => ({ ok: true, json: async () => snapshot });
  try {
    const res = response(); await scanHandler({ method: 'GET', url: '/api/scan', headers: {} }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].status, 'developing'); assert.equal(res.body.events[0].intelligence.certainty, null);
    assert.equal(res.body.events[0].supportPolicy, CLAIM_SUPPORT_POLICY); assert.equal(item.status, 'confirmed');
  } finally { globalThis.fetch = previous; if (oldMode === undefined) delete process.env.ABG_SCAN_MODE; else process.env.ABG_SCAN_MODE = oldMode; }
});

test('stored legacy events are protected at the public database reader boundary', async () => {
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://fixture.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ payload: { ...event, status: 'confirmed', intelligence: { certainty: 99 } } }] });
  try { const res = response(); await eventsHandler({ method: 'GET' }, res); assert.equal(res.body.events[0].intelligence.certainty, null); assert.equal(res.body.events[0].statementVerification, 'not_performed'); }
  finally { globalThis.fetch = oldFetch; for (const [k,v] of [['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey]]) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } }
});

for (const status of ['confirmed', 'strong', 'developing']) test(`UI does not reintroduce old ${status} labels`, () => {
  const presentation = eventSupportPresentation({ ...event, status, verified: true });
  assert.equal(presentation.label, 'Source-linked · unverified'); assert.equal(presentation.className, 'developing');
  assert.equal(applyEventSupportPolicy({ ...event, status }).status, 'developing');
});

test('source notes and probability removal are wired into both card and detail, with cache migration', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /eventSupportPresentation/); assert.doesNotMatch(app, /scoreItem\('Certainty'/); assert.doesNotMatch(app, /intelligenceTile\('Certainty'/);
  assert.match(app, /Statement check: pending/); assert.match(app, /eventSupportPresentation\(event\)\.notice/);
  const worker = readFileSync(new URL('../service-worker.js', import.meta.url),'utf8');
  assert.match(worker, /abg-pulse-shell-t51-v1/); assert.match(worker, /\/lib\/claim-support\.mjs/);
});
