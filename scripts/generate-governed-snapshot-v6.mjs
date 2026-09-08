import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performLiveScan } from '../api/scan.js';

const boundedInteger = (value, fallback, minimum, maximum) => {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
};

const boundedNumber = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
};

const now = new Date();
const lookbackDays = boundedInteger(process.env.SNAPSHOT_LOOKBACK_DAYS, 30, 1, 30);
const validForMinutes = boundedInteger(process.env.SNAPSHOT_VALID_FOR_MINUTES, 90, 15, 360);
const minimumSuccessRatio = boundedNumber(process.env.SNAPSHOT_MIN_SUCCESS_RATIO, 0.2, 0, 1);
const end = now;
const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
const outputPath = resolve(process.env.SNAPSHOT_OUTPUT || 'out/live-snapshot.json');
const manifestPath = resolve(process.env.SNAPSHOT_MANIFEST_OUTPUT || 'out/live-snapshot.manifest.json');

const window = {
  start: start.toISOString(),
  end: end.toISOString(),
  requestedStart: start.toISOString(),
  capped: false
};

const payload = await performLiveScan({ window, startedAt: now });
if (payload?.error) {
  throw new Error(`Live scan failed: ${payload.error}: ${payload.message || 'No detail supplied'}`);
}
if (!Array.isArray(payload?.events)) throw new Error('Live scan did not return an events array.');
if (!payload?.meta || typeof payload.meta !== 'object') throw new Error('Live scan metadata is missing.');
if (!Array.isArray(payload.meta.sourceChecks)) throw new Error('Live scan source-health detail is missing.');
if (!Number.isFinite(payload.meta.queryCount) || payload.meta.queryCount < 1) throw new Error('Live scan attempted no source checks.');
if (!Number.isFinite(payload.meta.successfulQueries)) throw new Error('Live scan successful-source count is missing.');

const successRatio = payload.meta.successfulQueries / payload.meta.queryCount;
if (successRatio < minimumSuccessRatio) {
  throw new Error(`Live scan success ratio ${successRatio.toFixed(3)} is below required ${minimumSuccessRatio.toFixed(3)}.`);
}
if (payload.meta.registryReconciled === false) throw new Error('ABG entity registry reconciliation failed.');

const generatedAt = now.toISOString();
const expiresAt = new Date(now.getTime() + validForMinutes * 60 * 1000).toISOString();
const snapshot = {
  schemaVersion: '1.0.0',
  generatedAt,
  expiresAt,
  source: {
    repository: process.env.GITHUB_REPOSITORY || 'NinjaRK/abg-pulse',
    commitSha: process.env.GITHUB_SHA || null,
    workflow: process.env.GITHUB_WORKFLOW || 'local',
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null
  },
  window: {
    start: window.start,
    end: window.end,
    lookbackDays
  },
  events: payload.events,
  entityUniverse: payload.entityUniverse || null,
  meta: {
    ...payload.meta,
    deliveryMode: 'governed-snapshot',
    snapshotGeneratedAt: generatedAt,
    snapshotExpiresAt: expiresAt,
    snapshotSuccessRatio: Number(successRatio.toFixed(4)),
    snapshotMinimumSuccessRatio: minimumSuccessRatio,
    sourceCommit: process.env.GITHUB_SHA || null,
    workflowRunId: process.env.GITHUB_RUN_ID || null
  }
};

const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
const digest = createHash('sha256').update(serialized).digest('hex');
const manifest = {
  schemaVersion: '1.0.0',
  generatedAt,
  expiresAt,
  sha256: digest,
  bytes: Buffer.byteLength(serialized),
  eventCount: snapshot.events.length,
  queryCount: snapshot.meta.queryCount,
  successfulQueries: snapshot.meta.successfulQueries,
  successRatio: snapshot.meta.snapshotSuccessRatio,
  registryReconciled: snapshot.meta.registryReconciled !== false,
  source: snapshot.source,
  window: snapshot.window
};

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(outputPath, serialized, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  outputPath,
  manifestPath,
  eventCount: manifest.eventCount,
  queryCount: manifest.queryCount,
  successfulQueries: manifest.successfulQueries,
  successRatio: manifest.successRatio,
  sha256: manifest.sha256,
  expiresAt
}, null, 2));
