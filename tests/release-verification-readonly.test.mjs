import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isolatedBuildEvidence } from '../scripts/record-isolated-build.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflows = [
  ['verify-claim-persistence-build.yml', 'claim-persistence', ['tables=8', 'runs=1', 'claims=2', 'evidence=1', 'audits=2', 'blocked-request']],
  ['verify-editorial-corrections-build.yml', 'editorial-corrections', ['corrections=1', 'audits=1', 'bad-evidence-request', 'interpretation-request', 'correction-request-1']]
];
for (const [filename, kind, assertions] of workflows) {
  const source = read(`.github/workflows/${filename}`);
  test(`${kind}: both push and PR verification have no repository write capability`, () => {
    assert.match(source, /permissions:\s*\n\s+contents: read/);
    assert.match(source, /persist-credentials: false/);
    assert.doesNotMatch(source, /contents: write|git\s+(?:push|commit|add)\b|implementationCompletion|milestone\.evidence|writeFileSync\(path,/);
    assert.doesNotMatch(source, /continue-on-error:\s*true/);
    assert.match(source, /pull_request:[\s\S]*tests\/release-verification-readonly\.test\.mjs/);
  });
  test(`${kind}: evidence is written only after unchanged-score and full regression checks`, () => {
    assert.match(source, /npm test/);
    assert.match(source, /git diff --exit-code HEAD -- data\/build-milestones\.json/);
    assert.match(source, /node --test tests\/progress-meter\.test\.mjs tests\/progress\.test\.mjs tests\/progress-descriptions\.test\.mjs/);
    assert.ok(source.includes(`node scripts/record-isolated-build.mjs ${kind} /tmp/${kind}-build-verification.json`));
    assert.ok(source.includes(`            /tmp/${kind}-build-verification.json`));
    const block = source.split('- name: Record isolated test evidence')[1].split('- name: Upload')[0];
    assert.doesNotMatch(block, /\n\s+if:/);
    assert.match(source, /if: always\(\)[\s\S]*uses: actions\/upload-artifact@v4/);
  });
  test(`${kind}: original transactional, correction and rejection assertions remain`, () => {
    assert.match(source, /image: postgres:16/);
    assert.match(source, /PGHOST: 127\.0\.0\.1/);
    for (const text of assertions) assert.ok(source.includes(text), `Missing ${text}`);
    assert.match(source, /psql -v ON_ERROR_STOP=1/);
  });
  test(`${kind}: isolated reporting cannot claim production or change the input scores`, () => {
    const bytes = read('data/build-milestones.json');
    const env = { GITHUB_SHA:'a'.repeat(40), GITHUB_RUN_ID:'123', GITHUB_RUN_ATTEMPT:'2', SECRET:'never-include-this' };
    const report = isolatedBuildEvidence(kind,{sourceBytes:bytes,env,now:new Date('2026-09-18T09:00:00Z')});
    assert.equal(report.environment,'isolated_ci_postgresql_16');
    assert.equal(report.progressChanged,false);assert.equal(report.productionDatabaseTested,false);
    assert.equal(report.productionDatabaseConnected,null);
    assert.equal(report.codeCommit,env.GITHUB_SHA); assert.equal(report.workflowRunAttempt,'2');
    assert.match(report.scoreFileSha256,/^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(report).includes(env.SECRET));
    assert.equal(read('data/build-milestones.json'),bytes);
  });
}
test('artifact recorder rejects output into governed source', () => {
  const before = read('data/build-milestones.json');
  const p = spawnSync(process.execPath,['scripts/record-isolated-build.mjs','claim-persistence','data/build-milestones.json'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.notEqual(p.status,0);assert.match(p.stderr,/fixed temporary artifact path/);
  assert.equal(read('data/build-milestones.json'),before);
});
test('artifact recorder rejects unknown types and invalid clocks', () => {
  assert.throws(()=>isolatedBuildEvidence('production',{sourceBytes:'{}'}),/Unknown/);
  assert.throws(()=>isolatedBuildEvidence('claim-persistence',{sourceBytes:'{}',now:new Date('bad')}),/clock/);
});
