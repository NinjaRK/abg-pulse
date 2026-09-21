import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAuthoritativeWave, validateSourceRegistry } from '../lib/authoritative-sources.mjs';

const registryPath = fileURLToPath(new URL('../config/authoritative-sources-wave1.json', import.meta.url));
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
validateSourceRegistry(registry);

const now = new Date();
const lookbackHours = Math.max(1, Math.min(24 * 30, Number.parseInt(process.env.AUTHORITATIVE_LOOKBACK_HOURS || '168', 10)));
const end = now.toISOString();
const start = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000).toISOString();
const sourceIds = process.env.AUTHORITATIVE_SOURCE_IDS
  ? process.env.AUTHORITATIVE_SOURCE_IDS.split(',').map((value) => value.trim()).filter(Boolean)
  : null;
const timeoutMs = Math.max(3_000, Math.min(30_000, Number.parseInt(process.env.AUTHORITATIVE_TIMEOUT_MS || '12000', 10)));
const minimumSuccessRatio = Math.max(0, Math.min(1, Number(process.env.AUTHORITATIVE_MIN_SUCCESS_RATIO || '0.25')));
const outputPath = resolve(process.env.AUTHORITATIVE_OUTPUT || 'out/authoritative-wave1.json');
const manifestPath = resolve(process.env.AUTHORITATIVE_MANIFEST_OUTPUT || 'out/authoritative-wave1.manifest.json');

const result = await fetchAuthoritativeWave(registry, { start, end, sourceIds, timeoutMs });
const successRatio = result.sourceCount ? result.successfulSourceCount / result.sourceCount : 0;
const criticalIds = ['sec-novelis', 'nse-abg-listed', 'bse-abg-listed'];
const criticalChecks = result.sourceChecks.filter((check) => criticalIds.includes(check.sourceId));
const criticalSuccesses = criticalChecks.filter((check) => check.ok).length;

if (!result.sourceCount) throw new Error('No authoritative sources were selected.');
if (successRatio < minimumSuccessRatio) {
  throw new Error(`Authoritative source success ratio ${successRatio.toFixed(3)} is below ${minimumSuccessRatio.toFixed(3)}.`);
}
if (!sourceIds && criticalSuccesses < 1) {
  throw new Error('SEC, NSE and BSE all failed; direct disclosure refresh is not trustworthy enough to publish.');
}

const payload = {
  schemaVersion: '1.0.0',
  generatedAt: now.toISOString(),
  source: {
    repository: process.env.GITHUB_REPOSITORY || 'NinjaRK/abg-pulse',
    commitSha: process.env.GITHUB_SHA || null,
    workflow: process.env.GITHUB_WORKFLOW || 'local',
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null
  },
  registry: {
    version: registry.version,
    updatedAt: registry.updatedAt,
    purpose: registry.purpose
  },
  quality: {
    minimumSuccessRatio,
    successRatio: Number(successRatio.toFixed(4)),
    criticalSourceIds: criticalIds,
    criticalSourcesChecked: criticalChecks.length,
    criticalSourcesSucceeded: criticalSuccesses,
    publishable: true
  },
  ...result
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const sha256 = createHash('sha256').update(serialized).digest('hex');
const manifest = {
  schemaVersion: '1.0.0',
  generatedAt: payload.generatedAt,
  sha256,
  bytes: Buffer.byteLength(serialized),
  window: payload.window,
  sourceCount: payload.sourceCount,
  successfulSourceCount: payload.successfulSourceCount,
  failedSourceCount: payload.failedSourceCount,
  successRatio: payload.quality.successRatio,
  recordCount: payload.recordCount,
  criticalSourcesSucceeded: criticalSuccesses,
  source: payload.source
};

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(outputPath, serialized, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(manifest, null, 2));
