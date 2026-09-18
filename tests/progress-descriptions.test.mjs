import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import progressHandler from '../api/progress.js';

const plan = JSON.parse(readFileSync(new URL('../data/build-milestones.json', import.meta.url), 'utf8'));
const byId = new Map(plan.milestones.map(row => [row.id, row]));
const checkpoint = plan.programme.evidenceCheckpoint;
const scoreBaseline = [
  ['M1',15,50,75,'in_progress'], ['M2',12,70,75,'in_progress'],
  ['M3',15,30,45,'in_progress'], ['M4',15,25,45,'blocked'],
  ['M5',16,45,65,'in_progress'], ['M6',10,80,85,'in_progress'],
  ['M7',7,10,20,'blocked'], ['M8',10,0,5,'not_started']
];
async function response() {
  const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
  await progressHandler({ method:'GET' },res);
  assert.equal(res.statusCode,200);
  return res.body;
}

test('T1.2 preserves every original milestone ID, weight, score and parent state', () => {
  assert.deepEqual(plan.milestones.map(m => [m.id,m.weight,m.completion,m.implementationCompletion,m.status]),scoreBaseline);
  assert.equal(plan.milestones.reduce((n,m)=>n+m.weight,0),100);
});
test('T1.2 preserves the agreed quantitative acceptance targets', () => {
  assert.deepEqual(plan.programme.qualityGates, { briefingMedianSeconds:60, criticalEventRecallPct:100,
    highMaterialityWeightedRecallPct:98, unsupportedMaterialClaims:0, silentTier0Outages:0 });
});
test('active descriptions and flags name the current safeguard work, not the previous source sprint', () => {
  assert.deepEqual(plan.programme.activeMilestoneIds,['M1','M5']);
  assert.deepEqual(plan.milestones.filter(m=>m.active).map(m=>m.id),['M1','M5']);
  assert.match(plan.programme.currentSprint.name,/claim-support, freshness and integrity/i);
});
test('retained score dates and readiness limitations remain explicit', () => {
  assert.equal(plan.measurement.recordedScoresAsOf,'2026-09-04T08:00:00.000Z');
  assert.match(plan.measurement.scoreCaveat,/not a current production-health/i);
  assert.match(plan.programme.currentSprint.objective,/not a current readiness verdict/i);
});
test('description date does not masquerade as a new production observation', () => {
  assert.equal(checkpoint.descriptionUpdatedAt,plan.updatedAt);
  assert.equal(checkpoint.latestRetainedProductionObservationAt,'2026-09-17T08:48:54.000Z');
  assert.ok(Date.parse(plan.updatedAt)>Date.parse(checkpoint.latestRetainedProductionObservationAt));
  assert.equal(checkpoint.observedProductionCommit,'17d669f3e66806922e51b05d29f13f9c35fe95cd');
  assert.match(checkpoint.caveat,/not a new live probe/i);
});
test('CI-tested safeguards are not relabelled as production verified', () => {
  assert.equal(checkpoint.safeguardEvidenceCommit,'9ec41dede51307d92406d87b4aea8c2a1ab53d39');
  assert.equal(checkpoint.safeguardEvidenceState,'implemented_ci_tested_production_verification_pending');
  assert.equal(checkpoint.productionReadiness,'not_established');
  assert.notEqual(checkpoint.observedProductionCommit,checkpoint.safeguardEvidenceCommit);
});
test('the closed Vercel action is excluded from unresolved API dependencies', async () => {
  const body=await response();
  const route=body.resources.externalDependencies.find(x=>x.name==='Existing Vercel Git deployment route');
  assert.equal(route.currentState,'resolved');
  assert.ok(!body.activeDependencies.some(x=>x.name===route.name));
  assert.match(route.ownerAction,/None for the completed/i);
});
test('the intended database stays unconnected and unrelated-project substitution is forbidden', () => {
  const db=plan.resources.externalDependencies.find(x=>x.name==='Existing ABG Pulse Production database');
  assert.equal(db.currentState,'not_connected');
  assert.match(db.ownerAction,/kzqymboxilxvdgacwypy/);
  assert.match(db.ownerAction,/do not use BuiltNotBorn or create a duplicate/);
  assert.match(byId.get('M4').evidence.join(' '),/isolated PostgreSQL/i);
  assert.match(byId.get('M4').evidence.join(' '),/did not connect the production database/i);
});
test('obsolete mandatory resume, rebase and duplicate provider setup instructions stay removed', () => {
  const actions=plan.milestones.map(m=>m.nextAction).concat(plan.resources.externalDependencies.map(x=>x.ownerAction)).join(' ');
  assert.doesNotMatch(actions,/Resume the ABG Pulse Vercel project|after Vercel resumes|Rebase the governed snapshot|Authorise n8n|Add the dual progress meter/i);
  assert.match(actions,/existing automation before selecting or purchasing/i);
});
test('handoff is release verification first and existing-database inspection second', () => {
  assert.equal(checkpoint.nextTask,'T1.3');
  assert.equal(checkpoint.afterSafeguardRelease,'T2.1');
  assert.match(byId.get('M1').nextAction,/T1\.3/);
  assert.match(byId.get('M4').nextAction,/T2\.1/);
  assert.equal(checkpoint.trackerUrl,'https://github.com/NinjaRK/abg-pulse/issues/19');
});
test('progress API exposes dated programme evidence without changing 40/55 scores', async () => {
  const body=await response();
  assert.deepEqual(body.programme.evidenceCheckpoint,checkpoint);
  assert.equal(body.verifiedCompletion,40);assert.equal(body.implementationCompletion,55);
  assert.equal(body.builtAwaitingProof,15);assert.equal(body.remainingToVerify,60);
  assert.deepEqual(body.activeMilestones.map(m=>m.id),['M1','M5']);
});
test('full quality, user acceptance, security and the actual trial remain outstanding', () => {
  assert.match(byId.get('M5').evidence.join(' '),/not statement verification/i);
  assert.match(byId.get('M6').evidence.join(' '),/used fixtures/i);
  assert.match(byId.get('M7').evidence.join(' '),/have not been assigned/i);
  assert.equal(byId.get('M8').status,'not_started');
  assert.match(byId.get('M8').nextAction,/only after T7\.5/i);
  assert.match(byId.get('M8').evidence.join(' '),/no qualifying 30-day proof/i);
});
