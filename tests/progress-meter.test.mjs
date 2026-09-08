import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const plan = JSON.parse(await readFile(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));
const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];

function weighted(field = 'completion') {
  const weightTotal = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const score = milestones.reduce((sum, item) => {
    const fallback = item.completion ?? 0;
    const value = Number(item[field] ?? fallback);
    return sum + Number(item.weight || 0) * value / 100;
  }, 0);
  return weightTotal ? Math.round(score / weightTotal * 100) : 0;
}

test('Job Meter weights cover the full objective exactly once', () => {
  assert.equal(milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0), 100);
  assert.equal(new Set(milestones.map((item) => item.id)).size, milestones.length);
});

test('verified completion is evidence-weighted and remains 40 percent', () => {
  const verified = weighted('completion');
  assert.equal(verified, 40);
  assert.equal(100 - verified, 60);
  assert.match(plan.measurement?.verifiedFormula || '', /verified completion/i);
});

test('built-but-unverified work cannot inflate verified completion', () => {
  const built = weighted('implementationCompletion');
  const verified = weighted('completion');
  assert.ok(built >= verified);
  assert.ok(built > verified, 'Expected tested work awaiting live verification to remain visible.');
  for (const milestone of milestones) {
    assert.ok(
      Number(milestone.implementationCompletion ?? milestone.completion) >= Number(milestone.completion),
      `${milestone.id} reports less implementation than verified delivery.`
    );
  }
});

test('every incomplete milestone has an acceptance gate and next action', () => {
  for (const milestone of milestones.filter((item) => Number(item.completion) < 100)) {
    assert.ok(milestone.acceptanceGate?.trim(), `${milestone.id} is missing an acceptance gate.`);
    assert.ok(milestone.nextAction?.trim(), `${milestone.id} is missing a next action.`);
    assert.ok(milestone.dependency?.trim(), `${milestone.id} is missing its dependency.`);
    assert.ok(Array.isArray(milestone.evidence), `${milestone.id} is missing an evidence list.`);
  }
});

test('the dependability milestone cannot start before operational prerequisites', () => {
  const proof = milestones.find((item) => /dependability proof/i.test(item.title || ''));
  assert.ok(proof);
  assert.equal(proof.completion, 0);
  assert.match(proof.acceptanceGate, /30|Thirty/i);
  assert.match(proof.dependency, /operational production system/i);
});

test('active programme milestones name only real incomplete work', () => {
  const byId = new Map(milestones.map((item) => [item.id, item]));
  const activeIds = plan.programme?.activeMilestoneIds || [];
  assert.ok(activeIds.length >= 1);
  for (const id of activeIds) {
    assert.ok(byId.has(id), `Unknown active milestone: ${id}`);
    assert.ok(Number(byId.get(id).completion) < 100, `${id} is already complete and should not be active.`);
    assert.equal(byId.get(id).active, true, `${id} is active in the programme but not marked active in the milestone.`);
  }
});

test('world-class release thresholds are explicit and fail closed', () => {
  const gates = plan.programme?.qualityGates || {};
  assert.equal(gates.briefingMedianSeconds, 60);
  assert.equal(gates.criticalEventRecallPct, 100);
  assert.equal(gates.highMaterialityWeightedRecallPct, 98);
  assert.equal(gates.unsupportedMaterialClaims, 0);
  assert.equal(gates.silentTier0Outages, 0);
});
