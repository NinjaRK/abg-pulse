import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  return source.replace(before, after);
}

const scanPath = 'api/scan.js';
let scan = readFileSync(scanPath, 'utf8');
scan = replaceOnce(
  scan,
  "import { buildEntityQueryPlan } from '../lib/query-plan.mjs';",
  "import { buildEntityQueryPlan } from '../lib/query-plan.mjs';\nimport { buildTier0Jobs } from '../lib/tier0-ingestion.mjs';",
  'Tier-0 scan import'
);
scan = replaceOnce(
  scan,
  "const officialSources = JSON.parse(readFileSync(fileURLToPath(new URL('../config/official-sources.json', import.meta.url)), 'utf8'));\nconst entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));",
  "const officialSources = JSON.parse(readFileSync(fileURLToPath(new URL('../config/official-sources.json', import.meta.url)), 'utf8'));\nconst tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));\nconst entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));",
  'Tier-0 scan config load'
);
scan = replaceOnce(
  scan,
  "  for (const source of officialSources) {\n    jobs.push({ provider: source.registrySource ? 'Official registry' : 'Official source', id: source.id, run: (signal) => source.registrySource ? auditOfficialRegistry(source, entities, signal) : fetchOfficialSource(source, signal) });\n  }\n  return jobs;",
  "  for (const source of officialSources) {\n    jobs.push({ provider: source.registrySource ? 'Official registry' : 'Official source', id: source.id, tier: source.tier || (source.registrySource ? 'tier0' : 'tier1'), authority: source.registrySource ? 'official-registry' : 'official-source', rightsStatus: source.rightsStatus || source.rights || null, entityId: source.entityId || null, run: (signal) => source.registrySource ? auditOfficialRegistry(source, entities, signal) : fetchOfficialSource(source, signal) });\n  }\n  const tier0 = buildTier0Jobs({ config: tier0Config, entities, window });\n  jobs.push(...tier0.jobs);\n  jobs.tier0Validation = tier0.validation;\n  return jobs;",
  'Tier-0 job integration'
);
scan = replaceOnce(
  scan,
  "  const jobs = buildJobs(window);\n  try {",
  "  const jobs = buildJobs(window);\n  const tier0Validation = jobs.tier0Validation;\n  try {",
  'Tier-0 validation capture'
);
scan = replaceOnce(
  scan,
  "        provider: jobs[index].provider,\n        ok: result.status === 'fulfilled',",
  "        provider: jobs[index].provider,\n        tier: jobs[index].tier || null,\n        authority: jobs[index].authority || null,\n        rightsStatus: jobs[index].rightsStatus || null,\n        entityId: jobs[index].entityId || null,\n        ok: result.status === 'fulfilled',",
  'Tier-0 source-check metadata'
);
scan = replaceOnce(
  scan,
  "serviceVersion: '5.4.0',\n        queryPlan:",
  "serviceVersion: '5.5.0',\n        tier0: { validation: tier0Validation, configuredJobs: tier0Validation?.configuredJobs || 0, attemptedJobs: jobs.filter((job) => job.tier === 'tier0').length },\n        queryPlan:",
  'Tier-0 scan metadata'
);
writeFileSync(scanPath, scan);

const coveragePath = 'api/coverage.js';
let coverage = readFileSync(coveragePath, 'utf8');
coverage = replaceOnce(
  coverage,
  "import { buildEntityQueryPlan } from '../lib/query-plan.mjs';",
  "import { buildEntityQueryPlan } from '../lib/query-plan.mjs';\nimport { tier0RegistryRecords } from '../lib/tier0-registry.mjs';\nimport { validateTier0Config } from '../lib/tier0-ingestion.mjs';",
  'Tier-0 coverage import'
);
coverage = replaceOnce(
  coverage,
  "const officialSources = readJson('../config/official-sources.json');\nconst configuredQueryGroups = readJson('../config/queries.json');",
  "const officialSources = readJson('../config/official-sources.json');\nconst tier0Config = readJson('../config/tier0-sources.json');\nconst tier0Sources = tier0RegistryRecords(tier0Config);\nconst tier0Validation = validateTier0Config(tier0Config, entities);\nconst configuredQueryGroups = readJson('../config/queries.json');",
  'Tier-0 coverage config load'
);
coverage = replaceOnce(
  coverage,
  "const audit = buildCoverageAudit({ entities, sourceRegistry, officialSources, queryGroups });",
  "const audit = buildCoverageAudit({ entities, sourceRegistry: [...sourceRegistry, ...tier0Sources], officialSources, queryGroups });",
  'Tier-0 coverage audit input'
);
coverage = replaceOnce(
  coverage,
  "queryPlan: { summary: queryPlan.summary, gates: queryPlan.gates, uncoveredEntities: queryPlan.uncoveredEntities },\n      ...audit",
  "queryPlan: { summary: queryPlan.summary, gates: queryPlan.gates, uncoveredEntities: queryPlan.uncoveredEntities },\n      tier0: { validation: tier0Validation, sources: tier0Sources },\n      ...audit",
  'Tier-0 coverage response'
);
writeFileSync(coveragePath, coverage);

const healthPath = 'api/health.js';
let health = readFileSync(healthPath, 'utf8');
health = replaceOnce(
  health,
  "const entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));",
  "const entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));\nconst tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));",
  'Tier-0 health config load'
);
health = replaceOnce(
  health,
  "    configured,\n    databaseReachable,",
  "    configured,\n    tier0: {\n      configured: true,\n      nseInstruments: (tier0Config?.nse?.instruments || []).filter((item) => item.enabled !== false).length,\n      secRegistrants: (tier0Config?.sec?.registrants || []).filter((item) => item.enabled !== false).length,\n      warning: 'Configured means the direct adapter is present. Live source health is reported by /api/scan and is not inferred from configuration.'\n    },\n    databaseReachable,",
  'Tier-0 health response'
);
writeFileSync(healthPath, health);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '5.5.0';
for (const check of [
  'node --check lib/tier0-ingestion.mjs',
  'node --check lib/tier0-registry.mjs'
]) {
  if (!packageJson.scripts.check.includes(check)) packageJson.scripts.check = `${packageJson.scripts.check} && ${check}`;
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('Direct NSE and SEC Tier-0 ingestion integrated into scan, coverage and health endpoints.');
