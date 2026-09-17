import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const canonicalPlan = JSON.parse(readFileSync(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));
const statuses = new Set(['complete', 'in_progress', 'blocked', 'not_started']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

// Validate the response contract, not product readiness or the truth of progress claims.
// The checked-out plan is authoritative for IDs and weights; this never edits scores.
export function validateProductionProgress(payload, plan = canonicalPlan) {
  assert.ok(object(plan) && Array.isArray(plan.milestones) && plan.milestones.length > 0, 'Canonical milestones are missing.');
  const expected = new Map();
  for (const item of plan.milestones) {
    assert.ok(object(item) && typeof item.id === 'string' && item.id.length > 0 && !expected.has(item.id), 'Canonical milestone IDs must be unique.');
    assert.ok(typeof item.weight === 'number' && Number.isFinite(item.weight) && item.weight > 0, 'Canonical weights must be positive numbers.');
    expected.set(item.id, item.weight);
  }
  assert.equal([...expected.values()].reduce((sum, n) => sum + n, 0), 100, 'Canonical weights must total 100.');
  assert.ok(object(payload) && Array.isArray(payload.milestones), 'Production milestones are missing.');
  assert.equal(payload.milestones.length, expected.size, 'Production milestone count differs from the canonical plan.');
  const seen = new Set();
  let weights = 0, verifiedWeighted = 0, builtWeighted = 0;
  for (const item of payload.milestones) {
    assert.ok(object(item) && expected.has(item.id) && !seen.has(item.id), 'Production milestone IDs must be known and unique.');
    seen.add(item.id);
    assert.equal(item.weight, expected.get(item.id), `Incorrect weight for ${item.id}.`);
    assert.ok(percent(item.completion) && percent(item.implementationCompletion), `Invalid progress values for ${item.id}.`);
    assert.ok(item.implementationCompletion >= item.completion, `Built progress cannot be below verified progress for ${item.id}.`);
    assert.ok(statuses.has(item.status), `Invalid status for ${item.id}.`);
    weights += item.weight;
    verifiedWeighted += item.weight * item.completion / 100;
    builtWeighted += item.weight * item.implementationCompletion / 100;
  }
  const verified = Math.round(verifiedWeighted / weights * 100);
  const built = Math.round(builtWeighted / weights * 100);
  const summaries = {
    weightTotal: weights, completion: verified, verifiedCompletion: verified,
    implementationCompletion: built, builtAwaitingProof: built - verified,
    remainingToVerify: 100 - verified, notYetBuilt: 100 - built
  };
  for (const [key, value] of Object.entries(summaries)) {
    assert.equal(payload[key], value, `Production ${key} does not reconcile with its milestones.`);
  }
  return { contractValid: true, milestoneCount: seen.size, ...summaries,
    note: 'Response structure and arithmetic verified; no operational readiness or independent progress certification implied.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.ok(process.argv[2], 'Usage: node scripts/validate-production-progress.mjs <response.json>');
    const payload = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
    console.log(JSON.stringify(validateProductionProgress(payload), null, 2));
  } catch (error) {
    console.error(`Production progress contract failed: ${error.message}`);
    process.exitCode = 1;
  }
}
