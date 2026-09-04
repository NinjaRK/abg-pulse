import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const plan = JSON.parse(await readFile(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));
const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];

function weighted(field = 'completion') {
  const weightTotal = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const score = milestones.reduce((sum, item) => {
    const value = Number(item[field] ?? item.completion ?? 0);
    return sum + Number(item.weight || 0) * value / 100;
  }, 0);
  return Math.round(score / weightTotal * 100);
}

test('Job Meter weights cover the full objective exactly once', () => {
  assert.equal(milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0), 100);
  assert.equal(new Set(milestones.map((item) => item.id)).size, milestones.length);
});

test('verified completion is evidence-weighted and remains 40 percent', () => {
  assert.equal(weighted('completion'), 40);
  assert.equal(plan.progress.verifiedCompletion, 40);
  assert.equal(plan.progress.remainingToVerify, 60);
});

test('built-but-unverified work cannot inflate verified completion', () => {
  const built = weighted('builtCompletion');
  const verified = weighted('completion');
  assert.ok(built >= verified);
  assert.ok(built > verified, 'Expected tested work awaiting live verification to remain visible.');
  for (const milestone of milestones) {
    assert.ok(Number(milestone.builtCompletion ?? milestone.completion) >= Number(milestone.completion));
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
  const proof = milestones.find((item) => item.id === 'M11');
  assert.ok(proof);
  assert.equal(proof.completion, 0);
  assert.match(proof.acceptanceGate, /30|Thirty/i);
  assert.match(proof.dependency, /Operational platform/i);
});

test('the critical path names only real incomplete milestones', () => {
  const byId = new Map(milestones.map((item) => [item.id, item]));
  assert.ok(plan.progress.criticalPath.length >= 4);
  for (const id of plan.progress.criticalPath) {
    assert.ok(byId.has(id), `Unknown critical-path milestone: ${id}`);
    assert.ok(Number(byId.get(id).completion) < 100, `${id} is already complete and should not be on the critical path.`);
  }
});
