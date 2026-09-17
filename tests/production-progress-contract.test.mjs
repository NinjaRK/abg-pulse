import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import progressHandler from '../api/progress.js';
import { validateProductionProgress } from '../scripts/validate-production-progress.mjs';

const plan = JSON.parse(readFileSync(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));
const response = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
await progressHandler({ method: 'GET' }, response);
const valid = response.body;

test('actual eight-milestone API response passes the production contract without rewriting scores', () => {
  const before = JSON.stringify({ plan, valid });
  const result = validateProductionProgress(valid);
  assert.equal(response.statusCode, 200);
  assert.equal(result.milestoneCount, 8);
  assert.equal(result.contractValid, true);
  assert.equal(JSON.stringify({ plan, valid }), before);
});

test('baseline production check demonstrably rejects the valid response this repair accepts', () => {
  assert.equal(valid.milestones.length < 10, true);
  assert.equal(validateProductionProgress(valid).contractValid, true);
});

const invalid = [
  ['missing milestone', p => p.milestones.pop()],
  ['extra milestone', p => p.milestones.push({ ...p.milestones[0], id: 'M9' })],
  ['duplicate ID with unchanged length', p => p.milestones[1].id = p.milestones[0].id],
  ['unknown ID', p => p.milestones[0].id = 'unknown'],
  ['swapped weights still totalling 100', p => { [p.milestones[0].weight, p.milestones[1].weight] = [p.milestones[1].weight, p.milestones[0].weight]; }],
  ['string weight', p => p.milestones[0].weight = String(p.milestones[0].weight)],
  ['zero weight', p => p.milestones[0].weight = 0],
  ['NaN weight', p => p.milestones[0].weight = NaN],
  ['negative score', p => p.milestones[0].completion = -1],
  ['score over 100', p => p.milestones[0].completion = 101],
  ['NaN score', p => p.milestones[0].completion = NaN],
  ['infinite score', p => p.milestones[0].completion = Infinity],
  ['null score', p => p.milestones[0].completion = null],
  ['boolean score', p => p.milestones[0].completion = true],
  ['string score', p => p.milestones[0].completion = '50'],
  ['missing built score', p => delete p.milestones[0].implementationCompletion],
  ['built below verified', p => p.milestones[0].implementationCompletion = p.milestones[0].completion - 1],
  ['invalid status', p => p.milestones[0].status = 'healthy'],
  ['non-object milestone', p => p.milestones[0] = null],
  ['array instead of milestones', p => p.milestones = {}]
];
for (const [name, mutate] of invalid) test(`production contract rejects ${name}`, () => {
  const payload = structuredClone(valid); mutate(payload);
  assert.throws(() => validateProductionProgress(payload));
});
for (const field of ['completion', 'verifiedCompletion', 'implementationCompletion', 'builtAwaitingProof', 'remainingToVerify', 'notYetBuilt', 'weightTotal']) {
  test(`production contract rejects incorrect ${field}`, () => {
    const payload = structuredClone(valid); payload[field] += 1;
    assert.throws(() => validateProductionProgress(payload), new RegExp(field));
  });
}
test('response ordering does not change canonical identity and weight validation', () => {
  const payload = structuredClone(valid); payload.milestones.reverse();
  assert.equal(validateProductionProgress(payload).contractValid, true);
});
test('missing or malformed top-level data fails closed', () => {
  for (const payload of [null, undefined, [], {}, true]) assert.throws(() => validateProductionProgress(payload));
});
test('a malformed canonical plan cannot redefine the release gate', () => {
  for (const mutate of [p => p.milestones.push(p.milestones[0]), p => p.milestones[0].weight = 0, p => p.milestones[0].weight++, p => p.milestones = []]) {
    const badPlan = structuredClone(plan); mutate(badPlan);
    assert.throws(() => validateProductionProgress(valid, badPlan));
  }
});
test('production workflow invokes the canonical validator from the exact checked-out source', () => {
  const workflow = readFileSync(new URL('../.github/workflows/verify-production.yml', import.meta.url), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node scripts\/validate-production-progress\.mjs \/tmp\/progress\.json/);
  assert.doesNotMatch(workflow, /milestones\.length\s*<\s*10/);
  assert.match(workflow, /deployed_sha.*EXPECTED_SHA/);
  assert.match(workflow, /Verify live scan returns valid intelligence JSON/);
});
test('read-only diagnostic keeps failures independent and does not mutate production', () => {
  const workflow = readFileSync(new URL('../.github/workflows/diagnose-production-readonly.yml', import.meta.url), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /credentialsUsed: false/);
  assert.match(workflow, /observationOnly: true/);
  for (const path of ['/api/health', '/api/scan', '/api/claims?summaryOnly=true', '/api/persistence-health', '/api/progress']) assert.ok(workflow.includes(path));
  assert.match(workflow, /method: 'GET', redirect: 'manual'/);
  assert.doesNotMatch(workflow, /secrets\.|git push|curl[^\n]+-X POST|method: '(POST|PUT|PATCH|DELETE)'/);
});
test('command-line validator fails for malformed input and succeeds for the real response', () => {
  const dir = mkdtempSync(join(tmpdir(), 'abg-progress-contract-'));
  const script = new URL('../scripts/validate-production-progress.mjs', import.meta.url).pathname;
  try {
    const good = join(dir, 'good.json'), bad = join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(valid)); writeFileSync(bad, '{');
    const passed = spawnSync(process.execPath, [script, good], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(JSON.parse(passed.stdout).contractValid, true);
    assert.notEqual(spawnSync(process.execPath, [script, bad]).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
