import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/verify-persistence-health-build.yml', import.meta.url), 'utf8');

test('database verification has read-only repository access and cannot rewrite progress', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /contents: write|git\s+(?:push|commit|add)\b/);
  assert.doesNotMatch(workflow, /implementationCompletion|milestone\.evidence|writeFileSync\(path,/);
  assert.match(workflow, /git diff --exit-code HEAD -- data\/build-milestones\.json/);
  assert.match(workflow, /node --test tests\/progress-meter\.test\.mjs tests\/progress\.test\.mjs/);
});

test('database verification saves isolated proof without asserting production readiness', () => {
  assert.match(workflow, /environment: 'isolated_ci_postgresql_16'/);
  assert.match(workflow, /progressChanged: false/);
  assert.match(workflow, /productionDatabaseTested: false/);
  assert.match(workflow, /productionDatabaseConnected: null/);
  assert.match(workflow, /\/tmp\/persistence-build-verification\.json/);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /npm test\s+npm run check/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});
