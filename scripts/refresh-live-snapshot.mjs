import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sealPayload, validateSourceCounts, positiveLimit, utcTime } from '../lib/data-integrity.mjs';
import { validateLiveSnapshot } from '../lib/live-snapshot.mjs';
import { performLiveScan } from '../api/scan.js';

function validDate(value, fallback = new Date()) {
  const date = value === undefined ? fallback : value instanceof Date ? new Date(value.getTime()) : new Date(utcTime(value));
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid snapshot date: ${value}`);
  return date;
}

export function writeCliResultAndExit(stream, payload, exitCode, exit = process.exit) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  stream.write(`${text}\n`, () => exit(exitCode));
}

export async function generateLiveSnapshot({
  now = validDate(process.env.SNAPSHOT_NOW),
  spanDays = Number(process.env.SNAPSHOT_SPAN_DAYS || 30),
  minimumSuccessRatio = positiveLimit(process.env.SNAPSHOT_MIN_SUCCESS_RATIO, 0.3, 'snapshot_coverage_config_invalid', 1),
  source = {
      repository: process.env.GITHUB_REPOSITORY || 'NinjaRK/abg-pulse',
      commitSha: process.env.GITHUB_SHA || null,
      workflowRunId: process.env.GITHUB_RUN_ID || null,
      workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      trigger: process.env.GITHUB_EVENT_NAME || 'manual'
  },
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
  minimumSuccessRatio = positiveLimit(minimumSuccessRatio, 0.3, 'snapshot_coverage_config_invalid', 1);
  const queryCount = payload.meta.queryCount;
  const successfulQueries = Number(payload.meta.successfulQueries || 0);
  const successRatio = validateSourceCounts(payload.meta, payload.events.length);
  if (queryCount < 1) throw new Error('Live scan attempted no source checks.');
  if (successRatio < minimumSuccessRatio) {
    throw new Error(`Snapshot rejected: only ${successfulQueries}/${queryCount} source checks succeeded (${Math.round(successRatio * 100)}%).`);
  }
  if (!Array.isArray(payload.meta.sourceChecks)) throw new Error('Live scan returned no source-health detail.');

  const generatedAt = end.toISOString();
  const snapshot = {
    schemaVersion: 1,
    serviceVersion: '6.1.0',
    generatedAt,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    source,
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

  const sealed = sealPayload(snapshot);
  validateLiveSnapshot(sealed, { minimumSuccessRatio });
  return sealed;
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
    // Some upstream fetch implementations can leave sockets alive even after an
    // AbortSignal fires. The file has already been atomically written, so flush
    // the result and terminate the CLI rather than letting orphan handles keep a
    // scheduled refresh open for several minutes.
    writeCliResultAndExit(process.stdout, { status: 'published', ...result }, 0);
  } catch (error) {
    writeCliResultAndExit(process.stderr, `ABG Pulse snapshot refresh failed: ${error?.stack || error}`, 1);
  }
}
