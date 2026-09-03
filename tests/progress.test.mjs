import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));

function completion(planData) {
  const milestones = planData.milestones || [];
  const total = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const weighted = milestones.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.completion || 0) / 100, 0);
  return total ? Math.round(weighted / total * 100) : 0;
}

test('milestone weights add to 100', () => {
  assert.equal(plan.milestones.reduce((sum, item) => sum + item.weight, 0), 100);
});

test('job meter is evidence-weighted and currently reports 40%', () => {
  assert.equal(completion(plan), 40);
});

test('every milestone has a measurable pass gate and next action', () => {
  for (const item of plan.milestones) {
    assert.ok(item.id);
    assert.ok(item.title);
    assert.ok(item.outcome);
    assert.ok(item.acceptanceGate);
    assert.ok(item.nextAction);
    assert.ok(item.dependency);
    assert.ok(Number.isFinite(item.completion) && item.completion >= 0 && item.completion <= 100);
    assert.ok(['complete','in_progress','blocked','not_started'].includes(item.status));
  }
});

test('external dependencies are explicit rather than hidden', () => {
  const deps = plan.resources?.externalDependencies || [];
  assert.ok(deps.length >= 5);
  for (const item of deps) {
    assert.ok(item.name && item.requiredFor && item.currentState && item.ownerAction);
  }
});
