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
packageJson.version = '5.9.0';
for (const check of [
  'node --check lib/benchmark-matcher.mjs',
  'node --check scripts/update-source-health-baselines.mjs',
  'node --check scripts/run-daily-benchmark.mjs',
  'node --check api/source-health.js'
]) {
  if (!String(packageJson.scripts?.check || '').includes(check)) {
    packageJson.scripts.check = `${packageJson.scripts.check} && ${check}`;
  }
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const healthPath = 'api/health.js';
let health = readFileSync(healthPath, 'utf8');
health = replaceOnce(
  health,
  "const bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));",
  "const bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));\nconst sourceHealthBaselines = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-health-baselines.json', import.meta.url)), 'utf8'));",
  'source-health health load'
);
health = replaceOnce(
  health,
  "    databaseReachable,\n    entityUniverse:",
  "    operationalLearning: {\n      sourceHealthStatus: sourceHealthBaselines?._meta?.status || 'learning',\n      learnedSources: Number(sourceHealthBaselines?._meta?.learnedSourceCount || Math.max(0, Object.keys(sourceHealthBaselines || {}).length - 1)),\n      readySources: Number(sourceHealthBaselines?._meta?.readySourceCount || 0),\n      lastObservationAt: sourceHealthBaselines?._meta?.lastObservationAt || null,\n      warning: 'Source baselines detect abnormal silence; independent recall benchmarking remains required.'\n    },\n    databaseReachable,\n    entityUniverse:",
  'source-health health response'
);
writeFileSync(healthPath, health);

const dependabilityPath = 'api/dependability.js';
let dependability = readFileSync(dependabilityPath, 'utf8');
dependability = replaceOnce(
  dependability,
  "const ledger = JSON.parse(readFileSync(fileURLToPath(new URL('../data/dependability-ledger.json', import.meta.url)), 'utf8'));",
  "const ledger = JSON.parse(readFileSync(fileURLToPath(new URL('../data/dependability-ledger.json', import.meta.url)), 'utf8'));\nconst sourceHealth = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-health-baselines.json', import.meta.url)), 'utf8'));",
  'dependability source-health load'
);
dependability = replaceOnce(
  dependability,
  "    acceptanceGates: ledger.acceptanceGates,\n    referenceSet:",
  "    acceptanceGates: ledger.acceptanceGates,\n    sourceHealthLearning: {\n      status: sourceHealth?._meta?.status || 'learning',\n      learnedSources: Number(sourceHealth?._meta?.learnedSourceCount || Math.max(0, Object.keys(sourceHealth || {}).length - 1)),\n      readySources: Number(sourceHealth?._meta?.readySourceCount || 0),\n      lastObservationAt: sourceHealth?._meta?.lastObservationAt || null\n    },\n    referenceSet:",
  'dependability source-health response'
);
writeFileSync(dependabilityPath, dependability);

console.log('Operational source learning and benchmark instrumentation integrated.');
