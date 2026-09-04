import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performLiveScan } from '../api/scan.js';

function validDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid snapshot date: ${value}`);
  return date;
}

function boundedRatio(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export async function generateLiveSnapshot({
  now = validDate(process.env.SNAPSHOT_NOW),
  spanDays = Number(process.env.SNAPSHOT_SPAN_DAYS || 30),
  minimumSuccessRatio = boundedRatio(process.env.SNAPSHOT_MIN_SUCCESS_RATIO, 0.3),
  scan = performLiveScan
} = {}) {
  const end = validDate(now);
  const safeSpanDays = Number.isFinite(spanDays) ? Math.max(1, Math.min(30, spanDays)) : 30;
  const start = new Date(end.getTime() - safeSpanDays * 24 * 60 * 60 * 1000);
  const window = {
    start: start.toISOString(),
    end: end.toISOString(),
    requestedStart: start.toISOString(),
    capped: false
  };

  const payload = await scan({ window, startedAt: end });
  if (!payload || !Array.isArray(payload.events) || !payload.meta) {
    throw new Error('Live scan did not return a structurally valid payload.');
  }
  const queryCount = Number(payload.meta.queryCount || 0);
  const successfulQueries = Number(payload.meta.successfulQueries || 0);
  const successRatio = queryCount > 0 ? successfulQueries / queryCount : 0;
  if (queryCount < 1) throw new Error('Live scan attempted no source checks.');
  if (successRatio < minimumSuccessRatio) {
    throw new Error(`Snapshot rejected: only ${successfulQueries}/${queryCount} source checks succeeded (${Math.round(successRatio * 100)}%).`);
  }
  if (!Array.isArray(payload.meta.sourceChecks)) throw new Error('Live scan returned no source-health detail.');

  const generatedAt = end.toISOString();
  const snapshot = {
    schemaVersion: 1,
    serviceVersion: '6.0.0',
    generatedAt,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    source: {
      repository: process.env.GITHUB_REPOSITORY || 'NinjaRK/abg-pulse',
      commitSha: process.env.GITHUB_SHA || null,
      workflowRunId: process.env.GITHUB_RUN_ID || null,
      workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      trigger: process.env.GITHUB_EVENT_NAME || 'manual'
    },
    integrity: {
      algorithm: 'sha256',
      payloadHash: null
    },
    events: payload.events,
    entityUniverse: payload.entityUniverse || {},
    meta: {
      ...payload.meta,
      scannedAt: generatedAt,
      deliveryMode: 'governed-snapshot-source',
      successRatio: Math.round(successRatio * 10000) / 10000
    }
  };

  const unhashed = JSON.stringify(snapshot);
  snapshot.integrity.payloadHash = createHash('sha256').update(unhashed).digest('hex');
  return snapshot;
}

export async function writeLiveSnapshot(outputPath, options = {}) {
  const target = resolve(outputPath);
  const snapshot = await generateLiveSnapshot(options);
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
  return {
    target,
    generatedAt: snapshot.generatedAt,
    eventCount: snapshot.events.length,
    queryCount: snapshot.meta.queryCount,
    successfulQueries: snapshot.meta.successfulQueries,
    payloadHash: snapshot.integrity.payloadHash
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.argv[2] || 'live-snapshot.json';
  try {
    const result = await writeLiveSnapshot(outputPath);
    console.log(JSON.stringify({ status: 'published', ...result }, null, 2));
  } catch (error) {
    console.error(`ABG Pulse snapshot refresh failed: ${error?.stack || error}`);
    process.exitCode = 1;
  }
}
