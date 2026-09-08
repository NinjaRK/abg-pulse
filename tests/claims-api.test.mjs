import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterClaims,
  loadClaimEvidenceGraph,
  projectClaimGraph,
  validateClaimEvidenceGraph
} from '../api/claims.js';

const payload = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-09-08T10:00:00.000Z',
  sourceCommit: 'abc123',
  quality: { publishable: true, unsupportedMaterialClaimCount: 0 },
  summary: { eventCount: 2, claimCount: 3, evidenceCount: 2 },
  eventSummaries: [
    { eventId: 'event-1', claimIds: ['claim-1', 'claim-2'], evidenceIds: ['evidence-1'] },
    { eventId: 'event-2', claimIds: ['claim-3'], evidenceIds: ['evidence-2'] }
  ],
  claims: [
    {
      id: 'claim-1',
      eventId: 'event-1',
      entityIds: ['company-a'],
      kind: 'fact',
      text: 'Company A filed an official disclosure.',
      supportStatus: 'supported',
      lifecycle: 'observed',
      evidenceIds: ['evidence-1']
    },
    {
      id: 'claim-2',
      eventId: 'event-1',
      entityIds: ['company-a'],
      kind: 'interpretation',
      text: 'The filing may influence the market narrative.',
      supportStatus: 'interpretation',
      lifecycle: 'observed',
      evidenceIds: ['evidence-1']
    },
    {
      id: 'claim-3',
      eventId: 'event-2',
      entityIds: ['company-b'],
      kind: 'fact',
      text: 'Company B was mentioned by a sector publication.',
      supportStatus: 'provisional',
      lifecycle: 'observed',
      evidenceIds: ['evidence-2']
    }
  ],
  evidence: [
    { id: 'evidence-1', eventId: 'event-1', url: 'https://exchange.example.com/disclosure', tier: 0 },
    { id: 'evidence-2', eventId: 'event-2', url: 'https://sector.example.com/story', tier: 2 }
  ],
  corrections: [{ id: 'correction-1', claimId: 'claim-1', correctionText: 'Updated filing detail.' }],
  contradictions: [{ id: 'contradiction-1', claimIds: ['claim-1', 'claim-3'], status: 'potential' }]
};

test('valid claim graph passes freshness and orphan-reference checks', () => {
  const result = validateClaimEvidenceGraph(payload, {
    now: new Date('2026-09-08T11:00:00.000Z'),
    staleAfterMinutes: 240
  });
  assert.equal(result.ageMinutes, 60);
  assert.equal(result.orphanReferenceCount, 0);
});

test('stale claim graphs fail closed', () => {
  assert.throws(() => validateClaimEvidenceGraph(payload, {
    now: new Date('2026-09-08T15:00:00.000Z'),
    staleAfterMinutes: 240
  }), (error) => error.code === 'claim_graph_stale' && error.detail.ageMinutes === 300);
});

test('unsupported material claims block graph delivery', () => {
  assert.throws(() => validateClaimEvidenceGraph({
    ...payload,
    quality: { publishable: false, unsupportedMaterialClaimCount: 1 }
  }), (error) => ['claim_graph_unpublishable', 'unsupported_material_claims'].includes(error.code));
});

test('orphan evidence references fail closed', () => {
  const broken = {
    ...payload,
    claims: payload.claims.map((claim, index) => index === 0 ? { ...claim, evidenceIds: ['missing-evidence'] } : claim)
  };
  assert.throws(() => validateClaimEvidenceGraph(broken, {
    now: new Date('2026-09-08T11:00:00.000Z')
  }), (error) => error.code === 'claim_graph_orphan_evidence' && error.detail.orphanReferences.length === 1);
});

test('claim filtering supports event, entity, kind, support, lifecycle and text', () => {
  assert.deepEqual(filterClaims(payload.claims, { eventId: 'event-1' }).map((item) => item.id), ['claim-1', 'claim-2']);
  assert.deepEqual(filterClaims(payload.claims, { entityId: 'company-b' }).map((item) => item.id), ['claim-3']);
  assert.deepEqual(filterClaims(payload.claims, { kind: 'fact', supportStatus: 'supported' }).map((item) => item.id), ['claim-1']);
  assert.deepEqual(filterClaims(payload.claims, { lifecycle: 'observed', search: 'sector publication' }).map((item) => item.id), ['claim-3']);
});

test('graph projection returns only evidence and audit items tied to selected claims', () => {
  const result = projectClaimGraph(payload, { eventId: 'event-1' }, { includeEvidence: true });
  assert.equal(result.filteredSummary.claimCount, 2);
  assert.equal(result.filteredSummary.factClaimCount, 1);
  assert.equal(result.filteredSummary.interpretationCount, 1);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].id, 'evidence-1');
  assert.equal(result.corrections.length, 1);
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.eventSummaries.length, 1);
});

test('summary-only projection suppresses detailed evidence payloads', () => {
  const result = projectClaimGraph(payload, {}, { summaryOnly: true, includeEvidence: true });
  assert.equal(result.filteredSummary.claimCount, 3);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.eventSummaries, []);
});

test('claim graph loader exposes upstream HTTP failures', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => loadClaimEvidenceGraph({ fetchImpl, url: 'https://example.test/claims.json' }), (error) => error.code === 'claim_graph_http_error' && error.detail.status === 503);
});

test('claim graph loader accepts valid JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });
  const result = await loadClaimEvidenceGraph({ fetchImpl, url: 'https://example.test/claims.json' });
  assert.equal(result.claims.length, 3);
});
