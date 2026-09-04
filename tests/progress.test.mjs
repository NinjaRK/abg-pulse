import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import progressHandler from '../api/progress.js';

const plan = JSON.parse(readFileSync(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));

function completion(planData, field = 'completion') {
  const milestones = planData.milestones || [];
  const total = milestones.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const weighted = milestones.reduce((sum, item) => {
    const value = field === 'implementationCompletion'
      ? (item.implementationCompletion ?? item.completion ?? 0)
      : (item.completion ?? 0);
    return sum + Number(item.weight || 0) * Number(value || 0) / 100;
  }, 0);
  return total ? Math.round(weighted / total * 100) : 0;
}

function mockResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); },
    json() { return JSON.parse(this.body); },
    headers
  };
}

test('milestone weights add to 100', () => {
  assert.equal(plan.milestones.reduce((sum, item) => sum + item.weight, 0), 100);
});

test('dual job meter reports 40% verified and 55% built', () => {
  assert.equal(completion(plan, 'completion'), 40);
  assert.equal(completion(plan, 'implementationCompletion'), 55);
});

test('built progress never falls below verified progress', () => {
  for (const item of plan.milestones) {
    assert.ok(Number(item.implementationCompletion) >= Number(item.completion), `${item.id} built progress is below verified progress`);
  }
});

test('remaining work is simplified into eight evidence-weighted milestones', () => {
  assert.equal(plan.milestones.length, 8);
  assert.deepEqual(plan.programme.activeMilestoneIds, ['M1', 'M3']);
  assert.ok(plan.programme.currentSprint?.name);
  assert.ok(Array.isArray(plan.programme.currentSprint?.deliverables));
  assert.ok(plan.programme.currentSprint.deliverables.length >= 3);
});

test('every milestone has a measurable pass gate, next action and dual progress', () => {
  for (const item of plan.milestones) {
    assert.ok(item.id);
    assert.ok(item.title);
    assert.ok(item.outcome);
    assert.ok(item.acceptanceGate);
    assert.ok(item.nextAction);
    assert.ok(item.dependency);
    assert.ok(Number.isFinite(item.completion) && item.completion >= 0 && item.completion <= 100);
    assert.ok(Number.isFinite(item.implementationCompletion) && item.implementationCompletion >= 0 && item.implementationCompletion <= 100);
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

test('progress API exposes verified, built and proof-gap values', async () => {
  const res = mockResponse();
  await progressHandler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.verifiedCompletion, 40);
  assert.equal(body.implementationCompletion, 55);
  assert.equal(body.builtAwaitingProof, 15);
  assert.equal(body.notYetBuilt, 45);
  assert.equal(body.remainingToVerify, 60);
  assert.equal(body.activeMilestones.length, 2);
  assert.equal(body.milestones.length, 8);
});
