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

const reorderAuth = (path, secretName) => {
  let source = readFileSync(path, 'utf8');
  const configBlock = `  const config = persistenceConfig();\n  if (!config.configured)`;
  const authBlock = `  if (!process.env.${secretName} || !authorizeRequest(req, process.env.${secretName})) {\n    return send(res, 401, { error: 'unauthorised' });\n  }`;
  const configIndex = source.indexOf(configBlock);
  const authIndex = source.indexOf(authBlock);
  if (configIndex < 0 || authIndex < 0) throw new Error(`Could not locate auth/config blocks in ${path}`);
  if (authIndex < configIndex) return;
  source = source.replace(`${authBlock}\n`, '');
  source = source.replace(configBlock, `${authBlock}\n  const config = persistenceConfig();\n  if (!config.configured)`);
  writeFileSync(path, source);
};

reorderAuth('api/persist.js', 'INGEST_SECRET');
reorderAuth('api/corrections.js', 'EDITOR_SECRET');
reorderAuth('api/notifications.js', 'INGEST_SECRET');

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '6.5.0';
for (const check of [
  'node --check lib/material-change.mjs',
  'node --check api/material-changes.js',
  'node --check api/notifications.js'
]) {
  if (!String(packageJson.scripts?.check || '').includes(check)) packageJson.scripts.check = `${packageJson.scripts.check} && ${check}`;
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const vercelPath = 'vercel.json';
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
vercel.functions = vercel.functions || {};
vercel.functions['api/material-changes.js'] = { maxDuration: 15 };
vercel.functions['api/notifications.js'] = { maxDuration: 15 };
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);

const releasePath = 'data/release.json';
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
release.version = '6.5.0';
release.releaseName = 'Silent-unless-material notification intelligence';
for (const endpoint of ['/api/material-changes', '/api/notifications']) {
  if (!release.requiredEndpoints.includes(endpoint)) release.requiredEndpoints.push(endpoint);
}
for (const assertion of [
  'Routine source-count growth, syndication and headline rewrites do not trigger notifications',
  'New and updated notifications require verified material change and a deterministic unseen notification key',
  'Disputed material changes are held for review instead of automatically delivered',
  'Every delivery attempt is recorded as reserved, sent, failed or suppressed',
  'Notification orchestration has no Gmail or Outlook dependency'
]) {
  if (!release.requiredAssertions.includes(assertion)) release.requiredAssertions.push(assertion);
}
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);

const healthPath = 'api/health.js';
let health = readFileSync(healthPath, 'utf8');
health = replaceOnce(
  health,
  "    persistence: {",
  "    notificationIntelligence: {\n      changeDetection: true,\n      duplicateSuppression: true,\n      deliveryLedger: configured.database,\n      scheduledOrchestration: false,\n      endpoints: { evaluate: '/api/material-changes', ledger: '/api/notifications' },\n      warning: configured.database ? 'The engine and idempotent ledger are available; scheduled delivery begins only after an authorised n8n workflow and webhook are connected.' : 'Notification delivery remains disabled until persistent storage is authorised.'\n    },\n    persistence: {",
  'notification health status'
);
writeFileSync(healthPath, health);

const workflowPath = '.github/workflows/verify-production-release.yml';
let workflow = readFileSync(workflowPath, 'utf8');
workflow = workflow.replace(
  "          if (meta.serviceVersion !== '6.0.0') throw new Error(`Expected scan service 6.0.0; received ${meta.serviceVersion}`);",
  "          const [scanMajor, scanMinor] = String(meta.serviceVersion || '0.0.0').split('.').map(Number);\n          if (scanMajor < 6 || (scanMajor === 6 && scanMinor < 2)) throw new Error(`Expected scan service 6.2.0 or later; received ${meta.serviceVersion}`);"
);
workflow = replaceOnce(
  workflow,
  "          if (meta.bse?.validation?.valid !== true) throw new Error('BSE Tier-0 configuration failed validation.');",
  "          if (meta.bse?.validation?.valid !== true) throw new Error('BSE Tier-0 configuration failed validation.');\n          if (meta.regulator?.validation?.valid !== true || meta.regulator?.attemptedJobs !== 8) throw new Error('Direct regulator configuration or job execution is incomplete.');",
  'regulator production gate'
);
workflow = replaceOnce(
  workflow,
  "          printf '%s' \"$history_code\" > evidence/history.code",
  "          printf '%s' \"$history_code\" > evidence/history.code\n          material_unauth_code=$(curl -L -sS --max-time 30 -o evidence/material-changes-unauth.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{\"currentEvents\":[],\"previousEvents\":[]}' \"$PRODUCTION_URL/api/material-changes\" || true)\n          notification_unauth_code=$(curl -L -sS --max-time 30 -o evidence/notifications-unauth.json -w '%{http_code}' \"$PRODUCTION_URL/api/notifications\" || true)\n          printf '%s' \"$material_unauth_code\" > evidence/material-changes-unauth.code\n          printf '%s' \"$notification_unauth_code\" > evidence/notifications-unauth.code",
  'notification auth evidence capture'
);
workflow = replaceOnce(
  workflow,
  "      - name: Verify transparency and honest objective status",
  `      - name: Verify notification endpoints fail closed without credentials
        shell: bash
        run: |
          set -euo pipefail
          material_code=$(cat evidence/material-changes-unauth.code)
          notification_code=$(cat evidence/notifications-unauth.code)
          [ "$material_code" = "401" ] || { echo "Material-change endpoint returned $material_code without auth"; exit 1; }
          [ "$notification_code" = "401" ] || { echo "Notification ledger returned $notification_code without auth"; exit 1; }
          grep -q 'unauthorised' evidence/material-changes-unauth.json
          grep -q 'unauthorised' evidence/notifications-unauth.json

      - name: Verify transparency and honest objective status`,
  'notification production auth gate'
);
writeFileSync(workflowPath, workflow);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.5.0 — Silent-unless-material notification intelligence\n\n- Added explicit new-versus-material-update comparison using priority, verification, authoritative evidence, supported claims, numbers, action posture, contradictions and lifecycle.\n- Source-count growth, syndication and headline rewrites alone are suppressed.\n- Added an idempotent notification ledger that reserves deterministic keys before delivery and records every outcome.\n- Added an importable n8n scan → compare → persist → reserve → deliver → record loop with no Gmail or Outlook dependency.\n- Disputed developments remain in review rather than becoming automatic alerts.\n\n`;
if (!changelog.includes('## 6.5.0 — Silent-unless-material notification intelligence')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Material-change evaluation, idempotent delivery ledger and n8n alert loop integrated.');
