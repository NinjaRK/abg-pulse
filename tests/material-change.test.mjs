import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEventChange, detectMaterialChanges } from '../lib/material-change.mjs';

function event(overrides = {}) {
  return {
    id: 'event-1',
    title: 'Company announces a ₹1,000 crore investment',
    summary: 'The company announced a material investment through an official filing.',
    classification: 'Must Know',
    verificationStatus: 'confirmed',
    materiality: 85,
    lifecycleStatus: 'confirmed',
    entityIds: ['company-1'],
    evidenceChain: {
      chainHash: 'chain-1',
      evidenceHash: 'evidence-1',
      tier0EvidenceCount: 1,
      independentSourceCount: 1,
      contradictions: [],
      claimGroups: [{
        id: 'claim-1',
        canonicalText: 'Company announces a ₹1,000 crore investment',
        material: true,
        supported: true,
        verification: 'confirmed-by-authoritative-source',
        numericAnchors: ['1000 crore'],
        topicKey: 'company investment',
        evidenceIds: ['evidence-a']
      }]
    },
    ...overrides
  };
}

test('new confirmed Must Know development is notification eligible', () => {
  const change = compareEventChange(event(), null);
  assert.equal(change.type, 'new');
  assert.equal(change.notificationEligible, true);
  assert.ok(change.score >= 50);
  assert.match(change.alertSummary, /official filing/i);
});

test('new single-source report does not notify even if mislabelled Must Know', () => {
  const candidate = event({
    verificationStatus: 'single-source',
    evidenceChain: {
      chainHash: 'single',
      evidenceHash: 'single',
      tier0EvidenceCount: 0,
      independentSourceCount: 1,
      contradictions: [],
      claimGroups: [{ id: 'claim-1', canonicalText: 'Company may invest ₹1,000 crore', material: true, supported: false, numericAnchors: ['1000 crore'] }]
    }
  });
  const change = compareEventChange(candidate, null);
  assert.equal(change.notificationEligible, false);
});

test('source-count growth and headline wording alone do not create an alert', () => {
  const previous = event();
  const current = event({
    title: 'Official filing: company confirms investment worth ₹1,000 crore',
    evidenceChain: { ...previous.evidenceChain, chainHash: 'chain-2', independentSourceCount: 4 }
  });
  const change = compareEventChange(current, previous);
  assert.equal(change.notificationEligible, false);
  assert.ok(change.signals.some((signal) => signal.name === 'new_corroboration') || change.signals.some((signal) => signal.name === 'source_or_wording_only'));
  assert.ok(change.score < 50);
});

test('Watch to Must Know escalation with verified evidence notifies', () => {
  const previous = event({ classification: 'Watch', materiality: 70, verificationStatus: 'corroborated' });
  const current = event({ classification: 'Must Know', materiality: 85, verificationStatus: 'confirmed' });
  const change = compareEventChange(current, previous);
  assert.equal(change.notificationEligible, true);
  assert.match(change.reasons.join(' '), /priority escalated/);
});

test('new supported material claim creates a material update', () => {
  const previous = event();
  const current = event({
    evidenceChain: {
      ...previous.evidenceChain,
      chainHash: 'chain-2',
      claimGroups: [
        ...previous.evidenceChain.claimGroups,
        { id: 'claim-2', canonicalText: 'The project will add 2 million tonnes of capacity', material: true, supported: true, verification: 'confirmed-by-authoritative-source', numericAnchors: ['2 million tonnes'], topicKey: 'project capacity', evidenceIds: ['evidence-b'] }
      ]
    }
  });
  const change = compareEventChange(current, previous);
  assert.equal(change.notificationEligible, true);
  assert.match(change.reasons.join(' '), /new supported material claim/);
});

test('numeric change on the same topic is alert-worthy', () => {
  const previous = event();
  const current = event({
    evidenceChain: {
      ...previous.evidenceChain,
      chainHash: 'chain-2',
      claimGroups: [{
        ...previous.evidenceChain.claimGroups[0],
        id: 'claim-2',
        canonicalText: 'Company announces a ₹1,500 crore investment',
        numericAnchors: ['1500 crore']
      }]
    }
  });
  const change = compareEventChange(current, previous);
  assert.equal(change.notificationEligible, true);
  assert.match(change.reasons.join(' '), /numeric fact/);
});

test('disputed update is held for review and not automatically notified', () => {
  const current = event({
    verificationStatus: 'disputed',
    evidenceChain: { ...event().evidenceChain, contradictions: [{ id: 'contradiction-1' }] }
  });
  const change = compareEventChange(current, event());
  assert.equal(change.notificationEligible, false);
  assert.equal(change.reviewRequired, true);
});

test('verified correction or retraction is always material', () => {
  const corrected = event({ lifecycleStatus: 'corrected', verificationStatus: 'confirmed', materiality: 20 });
  const change = compareEventChange(corrected, event({ lifecycleStatus: 'confirmed', materiality: 20 }));
  assert.equal(change.notificationEligible, true);
  assert.equal(change.type, 'corrected');
});

test('notification keys suppress duplicate delivery', () => {
  const first = compareEventChange(event(), null);
  const result = detectMaterialChanges({ currentEvents: [event()], previousEvents: [], previouslyNotifiedKeys: [first.notificationKey] });
  assert.equal(result.summary.notificationEligible, 0);
  assert.equal(result.summary.duplicateNotificationsSuppressed, 1);
});

test('batch comparison matches equivalent event identity despite an ID change', () => {
  const previous = event({ id: 'old-id', classification: 'Watch', verificationStatus: 'corroborated', materiality: 70 });
  const current = event({ id: 'new-id', classification: 'Must Know', verificationStatus: 'confirmed', materiality: 85 });
  const result = detectMaterialChanges({ currentEvents: [current], previousEvents: [previous] });
  assert.equal(result.eligible.length, 1);
  assert.match(result.eligible[0].reasons.join(' '), /priority escalated/);
});
