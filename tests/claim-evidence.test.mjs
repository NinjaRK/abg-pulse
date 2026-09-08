import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCorrection,
  buildClaimEvidenceGraph,
  deriveClaimEvidenceForEvent,
  findPotentialContradictions
} from '../lib/claim-evidence.mjs';

const officialSource = {
  name: 'BSE Limited',
  authority: 'BSE Limited',
  url: 'https://www.bseindia.com/xml-data/corpfiling/example.pdf?utm_source=test',
  publishedAt: '2026-09-08T06:00:00.000Z',
  tier: 0,
  official: true,
  sourceId: 'bse-abg-listed',
  rights: 'public-exchange-metadata'
};

const event = {
  id: 'event-1',
  title: 'Company Alpha approves a new investment',
  facts: [
    'Company Alpha approved a new investment.',
    'The disclosure was filed with BSE on 8 September 2026.'
  ],
  interpretation: ['The investment may strengthen capacity over time.'],
  entityIds: ['company-alpha'],
  latestAt: '2026-09-08T06:05:00.000Z',
  intelligence: { materiality: 78 },
  sources: [officialSource]
};

test('facts and interpretation remain explicitly separate', () => {
  const result = deriveClaimEvidenceForEvent(event);
  assert.equal(result.claims.length, 3);
  assert.equal(result.claims.filter((claim) => claim.kind === 'fact').length, 2);
  assert.equal(result.claims.filter((claim) => claim.kind === 'interpretation').length, 1);
  assert.equal(result.claims.find((claim) => claim.kind === 'interpretation').supportStatus, 'interpretation');
});

test('direct official evidence marks factual claims supported', () => {
  const result = deriveClaimEvidenceForEvent(event);
  const facts = result.claims.filter((claim) => claim.kind === 'fact');
  assert.ok(facts.every((claim) => claim.supportStatus === 'supported'));
  assert.ok(facts.every((claim) => claim.supportConfidence >= 0.94));
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].tier, 0);
  assert.equal(result.evidence[0].official, true);
  assert.equal(result.evidence[0].url.includes('utm_source'), false);
});

test('events without traceable sources create unsupported facts rather than invented evidence', () => {
  const result = deriveClaimEvidenceForEvent({
    id: 'event-no-source',
    title: 'Unverified material assertion',
    entityIds: ['company-alpha'],
    sources: []
  });
  assert.equal(result.evidence.length, 0);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].supportStatus, 'unsupported');
  assert.equal(result.claims[0].supportConfidence, 0);
});

test('duplicate source URLs collapse into one evidence record', () => {
  const result = deriveClaimEvidenceForEvent({
    ...event,
    id: 'event-duplicate-source',
    sources: [officialSource, { ...officialSource, url: `${officialSource.url}&gclid=123` }]
  });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.claims[0].evidenceCount, 1);
});

test('graph summary reconciles events, claims and evidence', () => {
  const graph = buildClaimEvidenceGraph([
    event,
    {
      id: 'event-2',
      title: 'A single lower-tier report mentions Company Alpha',
      entityIds: ['company-alpha'],
      sources: [{ name: 'Sector Blog', url: 'https://sector.example.com/story', tier: 3 }]
    }
  ], { generatedAt: '2026-09-08T07:00:00.000Z', sourceCommit: 'abc123' });
  assert.equal(graph.summary.eventCount, 2);
  assert.equal(graph.summary.factClaimCount, 3);
  assert.equal(graph.summary.interpretationCount, 1);
  assert.equal(graph.summary.evidenceCount, 2);
  assert.equal(graph.summary.supportedFactClaims, 2);
  assert.equal(graph.summary.provisionalFactClaims, 1);
  assert.equal(graph.summary.unsupportedFactClaims, 0);
  assert.equal(graph.sourceCommit, 'abc123');
});

test('a correction is append-only, evidence-bound and versions the original claim', () => {
  const graph = buildClaimEvidenceGraph([event]);
  const claim = graph.claims.find((item) => item.kind === 'fact');
  const correction = applyCorrection(graph, {
    claimId: claim.id,
    correctionText: 'Company Alpha approved a revised investment amount.',
    evidenceIds: [graph.evidence[0].id],
    reason: 'Subsequent exchange filing corrected the amount.',
    correctedAt: '2026-09-08T08:00:00.000Z',
    actor: 'editor-rk'
  });
  assert.equal(graph.corrections.length, 1);
  assert.equal(correction.claimId, claim.id);
  assert.equal(correction.previousText, 'Company Alpha approved a new investment.');
  assert.equal(correction.version, 2);
  assert.equal(claim.lifecycle, 'corrected');
  assert.equal(claim.correctionId, correction.id);
});

test('corrections cannot cite unknown evidence', () => {
  const graph = buildClaimEvidenceGraph([event]);
  const claim = graph.claims.find((item) => item.kind === 'fact');
  assert.throws(() => applyCorrection(graph, {
    claimId: claim.id,
    correctionText: 'Corrected text',
    evidenceIds: ['invented-evidence']
  }), /Unknown correction evidence/);
});

test('potential contradictions are flagged for human review, not auto-resolved', () => {
  const claims = [
    {
      id: 'claim-a',
      eventId: 'event-a',
      entityIds: ['company-alpha'],
      kind: 'fact',
      text: 'Company Alpha approved the proposed investment plan.',
      normalizedText: 'company alpha approved proposed investment plan'
    },
    {
      id: 'claim-b',
      eventId: 'event-b',
      entityIds: ['company-alpha'],
      kind: 'fact',
      text: 'Company Alpha did not approve the proposed investment plan.',
      normalizedText: 'company alpha did not approve proposed investment plan'
    }
  ];
  const contradictions = findPotentialContradictions(claims);
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].status, 'potential');
  assert.match(contradictions[0].reason, /human review/i);
  assert.deepEqual(contradictions[0].claimIds, ['claim-a', 'claim-b']);
});
