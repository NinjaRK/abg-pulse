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

const vercelPath = 'vercel.json';
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
vercel.rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
if (!vercel.rewrites.some((rule) => rule.source === '/trust')) {
  vercel.rewrites.push({ source: '/trust', destination: '/trust.html' });
}
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '6.3.0';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const releasePath = 'data/release.json';
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
release.version = '6.3.0';
release.releaseName = 'World-class transparent Trust Centre';
for (const endpoint of ['/trust', '/api/release']) {
  if (!release.requiredEndpoints.includes(endpoint)) release.requiredEndpoints.push(endpoint);
}
for (const assertion of [
  'Trust Centre distinguishes operational status from proven dependability',
  'Trust Centre exposes Job Meter, source-health learning, coverage gaps and proof streak without requiring technical interpretation'
]) {
  if (!release.requiredAssertions.includes(assertion)) release.requiredAssertions.push(assertion);
}
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);

const workflowPath = '.github/workflows/verify-production-release.yml';
let workflow = readFileSync(workflowPath, 'utf8');
workflow = replaceOnce(
  workflow,
  "          curl -L -fS --retry 3 --retry-delay 5 --max-time 120 \"$PRODUCTION_URL/api/scan\" -o evidence/scan.json",
  "          curl -L -fS --retry 3 --retry-delay 5 --max-time 60 \"$PRODUCTION_URL/trust\" -o evidence/trust.html\n          curl -L -fS --retry 3 --retry-delay 5 --max-time 60 \"$PRODUCTION_URL/api/release\" -o evidence/release.json\n          curl -L -fS --retry 3 --retry-delay 5 --max-time 120 \"$PRODUCTION_URL/api/scan\" -o evidence/scan.json",
  'Trust Centre production capture'
);
workflow = replaceOnce(
  workflow,
  "      - name: Verify governed universe and deployment provenance",
  `      - name: Verify Trust Centre clarity and release endpoint
        shell: bash
        run: |
          set -euo pipefail
          grep -qi "Can I trust today’s brief?" evidence/trust.html
          grep -qi "What remains unproven" evidence/trust.html
          grep -qi "Do not rely on silence" evidence/trust.html
          node --input-type=module <<'NODE'
          import { readFileSync } from 'node:fs';
          const release = JSON.parse(readFileSync('evidence/release.json', 'utf8'));
          if (release.status !== 'release-gated') throw new Error('Release endpoint is not fail-closed.');
          if (release?.release?.version !== '6.3.0') throw new Error(\`Expected release 6.3.0; received \${release?.release?.version}\`);
          if (!release?.release?.requiredEndpoints?.includes('/trust')) throw new Error('Release manifest does not govern /trust.');
          NODE

      - name: Verify governed universe and deployment provenance`,
  'Trust Centre production verification'
);
writeFileSync(workflowPath, workflow);

const healthPath = 'api/health.js';
let health = readFileSync(healthPath, 'utf8');
health = replaceOnce(
  health,
  "    release: { version: release.version, name: release.releaseName, exactCommitGate: true },",
  "    release: { version: release.version, name: release.releaseName, exactCommitGate: true, trustCentre: '/trust' },",
  'Trust Centre health link'
);
writeFileSync(healthPath, health);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.3.0 — World-class transparent Trust Centre\n\n- Added a mobile-first Trust Centre at /trust.\n- Separates operational health, configured coverage, source-baseline readiness and 30-day dependability proof.\n- Shows objective gaps and source blind spots instead of hiding them.\n- Defines Must Know, Watch, Media Tone and Observed Public Sentiment in plain language.\n- Production release verification now tests the Trust Centre and release manifest.\n\n`;
if (!changelog.includes('## 6.3.0 — World-class transparent Trust Centre')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Trust Centre integrated into production routing, health and exact-commit release gates.');
