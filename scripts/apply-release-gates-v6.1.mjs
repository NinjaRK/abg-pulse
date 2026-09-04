import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Refusing ambiguous ${label}: ${count} matches.`);
  return source.replace(before, after);
}

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '6.1.0';
const releaseCheck = 'node --check api/release.js';
if (!String(packageJson.scripts?.check || '').includes(releaseCheck)) {
  packageJson.scripts.check = `${packageJson.scripts.check} && ${releaseCheck}`;
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const healthPath = 'api/health.js';
let health = readFileSync(healthPath, 'utf8');
health = replaceOnce(
  health,
  "const sourceHealthBaselines = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-health-baselines.json', import.meta.url)), 'utf8'));",
  "const sourceHealthBaselines = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-health-baselines.json', import.meta.url)), 'utf8'));\nconst release = JSON.parse(readFileSync(fileURLToPath(new URL('../data/release.json', import.meta.url)), 'utf8'));",
  'release health load'
);
health = replaceOnce(
  health,
  "    status: databaseReachable === false ? 'degraded' : 'ok',\n    mode:",
  "    status: databaseReachable === false ? 'degraded' : 'ok',\n    release: { version: release.version, name: release.releaseName, exactCommitGate: true },\n    mode:",
  'release health response'
);
writeFileSync(healthPath, health);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.1.0 — Exact-commit production release gate\n\n- Production is accepted only when the exact Git SHA is live and every trust endpoint passes.\n- The release verifier checks entity coverage, Tier-0 ingestion, source health, bounded execution, claim evidence, Must Know policy and honest dependability status.\n- Verification evidence receives SHA-256 fingerprints and is retained for 90 days.\n- Vercel \"Ready\" alone is no longer treated as proof of a healthy intelligence release.\n\n`;
if (!changelog.includes('## 6.1.0 — Exact-commit production release gate')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Exact-commit production release gate integrated.');
