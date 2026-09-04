import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, pattern, replacement, label) {
  if (typeof pattern === 'string') {
    const count = source.split(pattern).length - 1;
    if (count === 0) {
      if (typeof replacement === 'string' && source.includes(replacement)) return source;
      throw new Error(`Could not locate ${label}.`);
    }
    if (count !== 1) throw new Error(`Refusing ambiguous ${label}: ${count} matches.`);
    return source.replace(pattern, replacement);
  }
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const count = [...source.matchAll(new RegExp(pattern.source, flags))].length;
  if (count === 0) throw new Error(`Could not locate ${label}.`);
  if (count !== 1) throw new Error(`Refusing ambiguous ${label}: ${count} matches.`);
  return source.replace(pattern, replacement);
}

const evidencePath = 'lib/evidence-chain.mjs';
let evidence = readFileSync(evidencePath, 'utf8');
evidence = replaceOnce(
  evidence,
  '  const articles = relevantArticles(cluster, event);',
  '  const articles = relevantArticles(cluster, event).slice(0, 20);',
  'evidence payload cap'
);
writeFileSync(evidencePath, evidence);

const scanPath = 'api/scan.js';
let scan = readFileSync(scanPath, 'utf8');
scan = replaceOnce(
  scan,
  "import { executeJobs } from '../lib/job-executor.mjs';",
  "import { executeJobs } from '../lib/job-executor.mjs';\nimport { applyEvidencePolicy } from '../lib/evidence-policy.mjs';\nimport { summarizeEvidenceChains } from '../lib/evidence-chain.mjs';",
  'evidence scan imports'
);
scan = replaceOnce(
  scan,
  /\.map\(\(cluster\) => deriveLiveEvent\(cluster, \{ entities, sources, now: startedAt \}\)\)/,
  `.map((cluster) => {
          const event = deriveLiveEvent(cluster, { entities, sources, now: startedAt });
          return event ? applyEvidencePolicy(event, cluster, { retrievedAt: startedAt }) : null;
        })`,
  'event evidence-policy mapping'
);
scan = replaceOnce(
  scan,
  /\)\)\.slice\(0, 60\);\n\s*const registryChecks/,
  `)).slice(0, 60);
    const evidenceSummary = summarizeEvidenceChains(events);
    const registryChecks`,
  'evidence summary insertion'
);
scan = replaceOnce(
  scan,
  /serviceVersion: '5\.[0-9]+\.0',\n\s*execution:/,
  "serviceVersion: '6.0.0',\n        evidence: evidenceSummary,\n        execution:",
  'evidence scan metadata'
);
writeFileSync(scanPath, scan);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '6.0.0';
for (const check of [
  'node --check lib/evidence-chain.mjs',
  'node --check lib/evidence-policy.mjs'
]) {
  if (!String(packageJson.scripts?.check || '').includes(check)) {
    packageJson.scripts.check = `${packageJson.scripts.check} && ${check}`;
  }
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.0.0 — Claim-level evidence chain\n\n- Every live event now carries canonical evidence records, content fingerprints and an evidence-chain hash.\n- Source-derived claims link back to evidence IDs; unsupported material claims are visible.\n- Numeric contradictions are surfaced as unresolved and forced into Watch.\n- Must Know now requires direct Tier-0 evidence or corroboration from two independent source origins.\n- Facts and unresolved source claims are separated by machine-readable policy metadata.\n\n`;
if (!changelog.includes('## 6.0.0 — Claim-level evidence chain')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Claim-level evidence chain and fail-closed publication policy integrated into the live scan.');
