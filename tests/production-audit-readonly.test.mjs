import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public claim audit retains limited observations but cannot write product scores', () => {
  const source = read('.github/workflows/verify-claim-audit-production.yml');
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.match(source, /persist-credentials: false/);
  assert.doesNotMatch(source, /contents: write|git\s+(?:push|commit|add)\b|milestone\.(?:completion|implementationCompletion|evidence)/);
  assert.match(source, /git diff --exit-code HEAD -- data\/build-milestones\.json/);
  assert.match(source, /productionDatabaseWriteReadTested: false/);
  assert.match(source, /independentFactVerificationPerformed: false/);
  assert.match(source, /overallProductAccepted: false/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /correction_code.*!= '401'/);
});
