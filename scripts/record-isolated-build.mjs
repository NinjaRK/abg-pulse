import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KINDS = new Set(['claim-persistence', 'editorial-corrections']);
export function isolatedBuildEvidence(kind, { env = process.env, now = new Date(), sourceBytes } = {}) {
  if (!KINDS.has(kind)) throw new TypeError('Unknown isolated build type.');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Invalid evidence clock.');
  if (!Buffer.isBuffer(sourceBytes) && typeof sourceBytes !== 'string') throw new TypeError('Original score-file bytes are required.');
  return {
    schemaVersion: 1, kind, recordedAt: now.toISOString(),
    environment: 'isolated_ci_postgresql_16',
    codeCommit: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') ? env.GITHUB_SHA : null,
    workflowRunId: /^\d+$/.test(env.GITHUB_RUN_ID || '') ? env.GITHUB_RUN_ID : null,
    workflowRunAttempt: /^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '') ? env.GITHUB_RUN_ATTEMPT : null,
    scoreFileSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    progressChanged: false, productionDatabaseTested: false, productionDatabaseConnected: null,
    caveat: 'This records an isolated CI test environment. Passing preceding steps is not production connectivity, independent factual verification or product acceptance. Repository writes and progress updates are not performed.'
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [kind, output] = process.argv.slice(2);
  const allowed = KINDS.has(kind) ? `/tmp/${kind}-build-verification.json` : null;
  if (!allowed || resolve(output || '') !== allowed) throw new TypeError('Evidence must use the fixed temporary artifact path.');
  const sourceBytes = readFileSync(new URL('../data/build-milestones.json', import.meta.url));
  const report = isolatedBuildEvidence(kind, { sourceBytes });
  writeFileSync(allowed, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
