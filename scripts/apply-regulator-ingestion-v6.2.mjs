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

let scan = readFileSync('api/scan.js', 'utf8');
scan = replaceOnce(
  scan,
  "import { buildBseJobs } from '../lib/bse-ingestion.mjs';",
  "import { buildBseJobs } from '../lib/bse-ingestion.mjs';\nimport { buildRegulatorJobs } from '../lib/regulator-ingestion.mjs';",
  'regulator scan import'
);
scan = replaceOnce(
  scan,
  "const bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));\nconst sourceHealthPayload",
  "const bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));\nconst regulatorConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/regulator-sources.json', import.meta.url)), 'utf8'));\nconst sourceHealthPayload",
  'regulator scan config load'
);
scan = replaceOnce(
  scan,
  "  const bse = buildBseJobs({ config: bseConfig, entities, window });\n  jobs.push(...tier0.jobs, ...bse.jobs);\n  jobs.tier0Validation = tier0.validation;\n  jobs.bseValidation = bse.validation;\n  return jobs;",
  "  const bse = buildBseJobs({ config: bseConfig, entities, window });\n  const regulator = buildRegulatorJobs({ config: regulatorConfig, window });\n  jobs.push(...tier0.jobs, ...bse.jobs, ...regulator.jobs);\n  jobs.tier0Validation = tier0.validation;\n  jobs.bseValidation = bse.validation;\n  jobs.regulatorValidation = regulator.validation;\n  return jobs;",
  'regulator job integration'
);
scan = replaceOnce(
  scan,
  "  const tier0Validation = jobs.tier0Validation;\n  const bseValidation = jobs.bseValidation;\n  try {",
  "  const tier0Validation = jobs.tier0Validation;\n  const bseValidation = jobs.bseValidation;\n  const regulatorValidation = jobs.regulatorValidation;\n  try {",
  'regulator validation capture'
);
scan = replaceOnce(
  scan,
  "serviceVersion: '6.0.0',\n        evidence:",
  "serviceVersion: '6.2.0',\n        regulator: { validation: regulatorValidation, configuredJobs: regulatorValidation?.sources || 0, attemptedJobs: jobs.filter((job) => String(job.id || '').startsWith('tier0:regulator:')).length },\n        evidence:",
  'regulator scan metadata'
);
writeFileSync('api/scan.js', scan);

let coverage = readFileSync('api/coverage.js', 'utf8');
coverage = replaceOnce(
  coverage,
  "import { validateBseConfig } from '../lib/bse-ingestion.mjs';",
  "import { validateBseConfig } from '../lib/bse-ingestion.mjs';\nimport { regulatorRegistryRecords, validateRegulatorConfig } from '../lib/regulator-ingestion.mjs';",
  'regulator coverage imports'
);
coverage = replaceOnce(
  coverage,
  "const bseConfig = readJson('../config/bse-sources.json');\nconst tier0Sources",
  "const bseConfig = readJson('../config/bse-sources.json');\nconst regulatorConfig = readJson('../config/regulator-sources.json');\nconst regulatorSources = regulatorRegistryRecords(regulatorConfig);\nconst regulatorValidation = validateRegulatorConfig(regulatorConfig);\nconst tier0Sources",
  'regulator coverage config load'
);
coverage = replaceOnce(
  coverage,
  "sourceRegistry: [...sourceRegistry, ...tier0Sources, ...bseSources]",
  "sourceRegistry: [...sourceRegistry, ...tier0Sources, ...bseSources, ...regulatorSources]",
  'regulator coverage source input'
);
coverage = replaceOnce(
  coverage,
  "bse: { validation: bseValidation, sources: bseSources },\n      ...audit",
  "bse: { validation: bseValidation, sources: bseSources },\n      regulators: { validation: regulatorValidation, sources: regulatorSources },\n      ...audit",
  'regulator coverage response'
);
writeFileSync('api/coverage.js', coverage);

let health = readFileSync('api/health.js', 'utf8');
health = replaceOnce(
  health,
  "const bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));",
  "const bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));\nconst regulatorConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/regulator-sources.json', import.meta.url)), 'utf8'));",
  'regulator health config load'
);
health = replaceOnce(
  health,
  "      bseInstruments: (bseConfig?.instruments || []).filter((item) => item.enabled !== false).length,\n      warning:",
  "      bseInstruments: (bseConfig?.instruments || []).filter((item) => item.enabled !== false).length,\n      regulatorSources: (regulatorConfig?.sources || []).filter((item) => item.enabled !== false).length,\n      warning:",
  'regulator health response'
);
writeFileSync('api/health.js', health);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
packageJson.version = '6.2.0';
const regulatorCheck = 'node --check lib/regulator-ingestion.mjs';
if (!String(packageJson.scripts?.check || '').includes(regulatorCheck)) packageJson.scripts.check = `${packageJson.scripts.check} && ${regulatorCheck}`;
writeFileSync('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

const releasePath = 'data/release.json';
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
release.version = '6.2.0';
release.releaseName = 'Direct regulator intelligence and exact-commit release gates';
if (!release.requiredAssertions.includes('Direct RBI, SEBI, CCI, IRDAI, TRAI, DoT and MCA source jobs are attempted and failures remain visible')) {
  release.requiredAssertions.push('Direct RBI, SEBI, CCI, IRDAI, TRAI, DoT and MCA source jobs are attempted and failures remain visible');
}
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.2.0 — Direct regulator intelligence\n\n- Added direct official publication checks for RBI, SEBI, CCI, IRDAI, TRAI, DoT and MCA.\n- Bot challenges, schema drift, missing dates and unexpected content types fail visibly rather than becoming false silence.\n- Regulator sources enter the Tier-0 source-health and coverage audits with explicit rights and cadence metadata.\n\n`;
if (!changelog.includes('## 6.2.0 — Direct regulator intelligence')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Direct regulator publication ingestion integrated into scan, coverage and health endpoints.');
