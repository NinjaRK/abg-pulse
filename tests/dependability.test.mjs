import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDependability, buildDailyLedgerEntry } from '../lib/dependability.mjs';

const references = [
  { id: 'r-critical', materiality: 'critical', weight: 4 },
  { id: 'r-high', materiality: 'high', weight: 3 },
  { id: 'r-low', materiality: 'low', weight: 1 }
];

test('dependability passes only when every objective gate passes', () => {
  const result = evaluateDependability({
    references,
    systemEvents: [
      { id: 'e1', referenceIds: ['r-critical'], classification: 'must_know', claims: [{ id: 'c1', material: true, evidence: ['s1'] }] },
      { id: 'e2', referenceIds: ['r-high'], classification: 'must_know', claims: [{ id: 'c2', material: true, evidence: ['s2'] }] },
      { id: 'e3', referenceIds: ['r-low'], classification: 'other' }
    ],
    knownTier0Outages: 0
  });
  assert.equal(result.metrics.criticalRecallPct, 100);
  assert.equal(result.metrics.materialityWeightedRecallPct, 100);
  assert.equal(result.metrics.precisionPct, 100);
  assert.equal(result.metrics.unsupportedMaterialClaims, 0);
  assert.equal(result.pass, true);
});

test('a missed critical event fails the proof even when precision is high', () => {
  const result = evaluateDependability({
    references,
    systemEvents: [
      { id: 'e2', referenceIds: ['r-high'] },
      { id: 'e3', referenceIds: ['r-low'] }
    ]
  });
  assert.equal(result.metrics.criticalRecallPct, 0);
  assert.equal(result.gates.criticalEventRecall, false);
  assert.equal(result.pass, false);
  assert.deepEqual(result.misses.map((item) => item.id), ['r-critical']);
});

test('unmatched events are counted as false positives', () => {
  const result = evaluateDependability({
    references: [{ id: 'r1', materiality: 'critical' }],
    systemEvents: [
      { id: 'e1', referenceIds: ['r1'] },
      { id: 'noise' }
    ]
  });
  assert.equal(result.metrics.precisionPct, 50);
  assert.equal(result.falsePositives.length, 1);
  assert.equal(result.gates.minimumPrecision, false);
});

test('unsupported material claims are a hard failure', () => {
  const result = evaluateDependability({
    references: [{ id: 'r1', materiality: 'critical' }],
    systemEvents: [{ id: 'e1', referenceIds: ['r1'], classification: 'must_know', claims: [{ id: 'c1', text: 'Unsupported claim' }] }]
  });
  assert.equal(result.metrics.unsupportedMaterialClaims, 1);
  assert.equal(result.gates.noUnsupportedMaterialClaims, false);
  assert.equal(result.pass, false);
});

test('daily ledger keeps scan failures visible', () => {
  const evaluation = evaluateDependability({
    references: [{ id: 'r1', materiality: 'critical' }],
    systemEvents: [{ id: 'e1', referenceIds: ['r1'] }]
  });
  const entry = buildDailyLedgerEntry({
    date: '2026-09-04',
    evaluation,
    scanMeta: { queryCount: 65, successfulQueries: 35, eventCount: 1 }
  });
  assert.equal(entry.scanMeta.failedQueries, 30);
  assert.equal(entry.scanMeta.queryCount, 65);
});
