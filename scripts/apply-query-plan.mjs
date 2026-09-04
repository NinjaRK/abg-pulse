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
  "import { fetchOfficialSource, auditOfficialRegistry } from '../official.mjs';",
  "import { fetchOfficialSource, auditOfficialRegistry } from '../official.mjs';\nimport { buildEntityQueryPlan } from '../lib/query-plan.mjs';",
  'scan query-plan import'
);
scan = replaceOnce(
  scan,
  "const queryGroups = JSON.parse(readFileSync(fileURLToPath(new URL('../config/queries.json', import.meta.url)), 'utf8'));\nconst officialSources = JSON.parse(readFileSync(fileURLToPath(new URL('../config/official-sources.json', import.meta.url)), 'utf8'));\nconst entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));",
  "const configuredQueryGroups = JSON.parse(readFileSync(fileURLToPath(new URL('../config/queries.json', import.meta.url)), 'utf8'));\nconst officialSources = JSON.parse(readFileSync(fileURLToPath(new URL('../config/official-sources.json', import.meta.url)), 'utf8'));\nconst entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));\nconst queryPlan = buildEntityQueryPlan({ entities, baseGroups: configuredQueryGroups });\nconst queryGroups = queryPlan.groups;",
  'scan query-group initialisation'
);
scan = replaceOnce(
  scan,
  "serviceVersion: '5.2.0',\n        queryCount: jobs.length,",
  "serviceVersion: '5.4.0',\n        queryPlan: { summary: queryPlan.summary, gates: queryPlan.gates, uncoveredEntities: queryPlan.uncoveredEntities },\n        queryCount: jobs.length,",
  'scan query-plan metadata'
);
writeFileSync(scanPath, scan);

const coveragePath = 'api/coverage.js';
let coverage = readFileSync(coveragePath, 'utf8');
coverage = replaceOnce(
  coverage,
  "import { buildCoverageAudit } from '../lib/coverage.mjs';",
  "import { buildCoverageAudit } from '../lib/coverage.mjs';\nimport { buildEntityQueryPlan } from '../lib/query-plan.mjs';",
  'coverage query-plan import'
);
coverage = replaceOnce(
  coverage,
  "const queryGroups = readJson('../config/queries.json');",
  "const configuredQueryGroups = readJson('../config/queries.json');\nconst queryPlan = buildEntityQueryPlan({ entities, baseGroups: configuredQueryGroups });\nconst queryGroups = queryPlan.groups;",
  'coverage query-group initialisation'
);
coverage = replaceOnce(
  coverage,
  "meaning: 'Configured coverage, not a claim that every material development was captured. Dependability is established only through the independent benchmark.',\n      ...audit",
  "meaning: 'Configured coverage, not a claim that every material development was captured. Dependability is established only through the independent benchmark.',\n      queryPlan: { summary: queryPlan.summary, gates: queryPlan.gates, uncoveredEntities: queryPlan.uncoveredEntities },\n      ...audit",
  'coverage query-plan response'
);
writeFileSync(coveragePath, coverage);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '5.4.0';
packageJson.scripts.check = [
  'node --check app.js',
  'node --check core.mjs',
  'node --check official.mjs',
  'node --check lib/query-plan.mjs',
  'node --check lib/coverage.mjs',
  'node --check lib/dependability.mjs',
  'node --check lib/source-health.mjs',
  'node --check lib/registry-diff.mjs',
  'node --check api/scan.js',
  'node --check api/events.js',
  'node --check api/ingest.js',
  'node --check api/social-ingest.js',
  'node --check api/health.js',
  'node --check api/progress.js',
  'node --check api/coverage.js',
  'node --check api/dependability.js',
  'node tests/validate-data.mjs'
].join(' && ');
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('Entity-complete query plan integrated into scan and coverage endpoints.');
