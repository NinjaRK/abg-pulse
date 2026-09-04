import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, pattern, replacement, label) {
  const matches = typeof pattern === 'string'
    ? source.split(pattern).length - 1
    : [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
  if (matches === 0) {
    if (typeof replacement === 'string' && source.includes(replacement)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  if (matches > 1) throw new Error(`Refusing ambiguous ${label}: ${matches} matches.`);
  return source.replace(pattern, replacement);
}

const scanPath = 'api/scan.js';
let scan = readFileSync(scanPath, 'utf8');
scan = replaceOnce(
  scan,
  "import { evaluateSourceHealth } from '../lib/source-health.mjs';",
  "import { evaluateSourceHealth } from '../lib/source-health.mjs';\nimport { executeJobs } from '../lib/job-executor.mjs';",
  'scan-executor import'
);
scan = replaceOnce(
  scan,
  /const settled = await Promise\.allSettled\(jobs\.map\(\(job\) => runWithTimeout\(job\.run, [^)]*\)\)\);/,
  `const execution = await executeJobs(jobs, {
      concurrency: Math.max(4, Math.min(48, Number(process.env.SCAN_CONCURRENCY || 28))),
      timeoutMs: Math.max(3000, Math.min(20000, Number(process.env.SCAN_SOURCE_TIMEOUT_MS || 10000))),
      maxAttempts: 2,
      retryDelayMs: 180,
      deadlineMs: Math.max(20000, Math.min(55000, Number(process.env.SCAN_DEADLINE_MS || 50000)))
    });
    const settled = execution.results;`,
  'Promise.allSettled scan execution'
);
scan = replaceOnce(
  scan,
  "        durationMs: null,\n        ok: result.status === 'fulfilled',",
  "        durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,\n        attempts: Number(result.attempts || 0),\n        deadlineSkipped: result.deadlineSkipped === true,\n        ok: result.status === 'fulfilled',",
  'source-check execution metadata'
);
scan = replaceOnce(
  scan,
  "serviceVersion: '5.7.0',\n        bse:",
  "serviceVersion: '5.8.0',\n        execution: execution.meta,\n        bse:",
  'scan version and execution metadata'
);
writeFileSync(scanPath, scan);

const tier0Path = 'lib/tier0-ingestion.mjs';
let tier0 = readFileSync(tier0Path, 'utf8');
tier0 = replaceOnce(
  tier0,
  "    if (!nseSessionPromise) nseSessionPromise = establishNseSession(nseConfig, fetchImpl, signal);\n    return nseSessionPromise;",
  `    if (!nseSessionPromise) {
      nseSessionPromise = establishNseSession(nseConfig, fetchImpl, signal)
        .catch((error) => {
          nseSessionPromise = null;
          throw error;
        });
    }
    return nseSessionPromise;`,
  'NSE session retry cache'
);
writeFileSync(tier0Path, tier0);

const vercelPath = 'vercel.json';
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
if (!vercel.functions?.['api/scan.js']) throw new Error('Vercel scan function configuration is missing.');
vercel.functions['api/scan.js'].maxDuration = 60;
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '5.8.0';
const executorCheck = 'node --check lib/job-executor.mjs';
if (!String(packageJson.scripts?.check || '').includes(executorCheck)) {
  packageJson.scripts.check = `${packageJson.scripts.check} && ${executorCheck}`;
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('Bounded scan executor integrated with retries, deadlines and source timing evidence.');
