import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceHealth, updateSourceBaselines } from '../lib/source-health.mjs';

test('explicit Tier-0 failure is a hard gate failure', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'bse', provider: 'BSE', ok: false, status: 'failed', itemCount: 0, error: 'timeout' }],
    baselines: { bse: { tier: 'tier0', minimumItems: 1, typicalItems: 10, lastReviewedAt: '2026-09-01' } }
  });
  assert.equal(result.summary.tier0ExplicitFailures, 1);
  assert.equal(result.gates.noExplicitTier0Failure, false);
});

test('HTTP success with abnormal zero volume is a silent failure', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'nse', provider: 'NSE', ok: true, status: 'healthy', itemCount: 0, durationMs: 120 }],
    baselines: { nse: { tier: 'tier0', minimumItems: 2, typicalItems: 12, lastReviewedAt: '2026-09-01' } }
  });
  assert.equal(result.summary.explicitFailures, 0);
  assert.equal(result.summary.silentFailures, 1);
  assert.equal(result.gates.noSilentTier0Failure, false);
  assert.ok(result.silentFailures[0].issues.includes('below_minimum_volume'));
});

test('baseline coverage is visibly incomplete rather than assumed healthy', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'official', ok: true, status: 'healthy', itemCount: 3, durationMs: 80 }],
    baselines: {}
  });
  assert.equal(result.gates.baselineCoverageComplete, false);
  assert.equal(result.summary.baselineCoveragePct, 0);
});

test('baseline learner retains a rolling history and computes typical volume', () => {
  let baselines = {};
  for (const count of [8, 10, 12, 9, 11, 10]) {
    baselines = updateSourceBaselines({
      existing: baselines,
      sourceChecks: [{ name: 'source-a', provider: 'Official', ok: true, itemCount: count }],
      date: new Date('2026-09-01T00:00:00Z')
    });
  }
  assert.equal(baselines['source-a'].samples.length, 6);
  assert.equal(baselines['source-a'].typicalItems, 10);
  assert.ok(baselines['source-a'].minimumItems >= 1);
});
