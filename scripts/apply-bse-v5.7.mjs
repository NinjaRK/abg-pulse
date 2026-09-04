import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  return source.replace(before, after);
}

let scan = readFileSync('api/scan.js', 'utf8');
scan = replaceOnce(
  scan,
  "import { evaluateSourceHealth } from '../lib/source-health.mjs';",
  "import { evaluateSourceHealth } from '../lib/source-health.mjs';\nimport { buildBseJobs } from '../lib/bse-ingestion.mjs';",
  'BSE scan import'
);
scan = replaceOnce(
  scan,
  "const tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));\nconst sourceHealthPayload",
  "const tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));\nconst bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));\nconst sourceHealthPayload",
  'BSE scan config load'
);
scan = replaceOnce(
  scan,
  "  const tier0 = buildTier0Jobs({ config: tier0Config, entities, window });\n  jobs.push(...tier0.jobs);\n  jobs.tier0Validation = tier0.validation;\n  return jobs;",
  "  const tier0 = buildTier0Jobs({ config: tier0Config, entities, window });\n  const bse = buildBseJobs({ config: bseConfig, entities, window });\n  jobs.push(...tier0.jobs, ...bse.jobs);\n  jobs.tier0Validation = tier0.validation;\n  jobs.bseValidation = bse.validation;\n  return jobs;",
  'BSE job integration'
);
scan = replaceOnce(
  scan,
  "  const jobs = buildJobs(window);\n  const tier0Validation = jobs.tier0Validation;\n  try {",
  "  const jobs = buildJobs(window);\n  const tier0Validation = jobs.tier0Validation;\n  const bseValidation = jobs.bseValidation;\n  try {",
  'BSE validation capture'
);
scan = replaceOnce(
  scan,
  "serviceVersion: '5.6.0',\n        sourceHealth:",
  "serviceVersion: '5.7.0',\n        bse: { validation: bseValidation, configuredJobs: bseValidation?.instruments || 0, attemptedJobs: jobs.filter((job) => job.provider === 'BSE direct filing').length },\n        sourceHealth:",
  'BSE scan metadata'
);
writeFileSync('api/scan.js', scan);

let coverage = readFileSync('api/coverage.js', 'utf8');
coverage = replaceOnce(
  coverage,
  "import { validateTier0Config } from '../lib/tier0-ingestion.mjs';",
  "import { validateTier0Config } from '../lib/tier0-ingestion.mjs';\nimport { bseRegistryRecords } from '../lib/bse-registry.mjs';\nimport { validateBseConfig } from '../lib/bse-ingestion.mjs';",
  'BSE coverage imports'
);
coverage = replaceOnce(
  coverage,
  "const tier0Config = readJson('../config/tier0-sources.json');\nconst tier0Sources = tier0RegistryRecords(tier0Config);",
  "const tier0Config = readJson('../config/tier0-sources.json');\nconst bseConfig = readJson('../config/bse-sources.json');\nconst tier0Sources = tier0RegistryRecords(tier0Config);\nconst bseSources = bseRegistryRecords(bseConfig);\nconst bseValidation = validateBseConfig(bseConfig, entities);",
  'BSE coverage config load'
);
coverage = replaceOnce(
  coverage,
  "sourceRegistry: [...sourceRegistry, ...tier0Sources]",
  "sourceRegistry: [...sourceRegistry, ...tier0Sources, ...bseSources]",
  'BSE coverage source input'
);
coverage = replaceOnce(
  coverage,
  "tier0: { validation: tier0Validation, sources: tier0Sources },\n      ...audit",
  "tier0: { validation: tier0Validation, sources: tier0Sources },\n      bse: { validation: bseValidation, sources: bseSources },\n      ...audit",
  'BSE coverage response'
);
writeFileSync('api/coverage.js', coverage);

let health = readFileSync('api/health.js', 'utf8');
health = replaceOnce(
  health,
  "const tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));",
  "const tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));\nconst bseConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../config/bse-sources.json', import.meta.url)), 'utf8'));",
  'BSE health config load'
);
health = replaceOnce(
  health,
  "      secRegistrants: (tier0Config?.sec?.registrants || []).filter((item) => item.enabled !== false).length,\n      warning:",
  "      secRegistrants: (tier0Config?.sec?.registrants || []).filter((item) => item.enabled !== false).length,\n      bseInstruments: (bseConfig?.instruments || []).filter((item) => item.enabled !== false).length,\n      warning:",
  'BSE health response'
);
writeFileSync('api/health.js', health);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
packageJson.version = '5.7.0';
for (const check of ['node --check lib/bse-ingestion.mjs', 'node --check lib/bse-registry.mjs']) {
  if (!packageJson.scripts.check.includes(check)) packageJson.scripts.check = `${packageJson.scripts.check} && ${check}`;
}
writeFileSync('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
console.log('Direct BSE Tier-0 ingestion integrated into scan, coverage and health endpoints.');
