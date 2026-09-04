import { filterEventsByWindow } from '../core.mjs';

export const DEFAULT_LIVE_SNAPSHOT_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/live-snapshot.json';
export const DEFAULT_SNAPSHOT_STALE_MINUTES = 90;

export class SnapshotError extends Error {
  constructor(code, message, status = 503, detail = {}) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function headerValue(req, name) {
  const headers = req?.headers || {};
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(direct)) return direct[0] || '';
  return String(direct || '');
}

export function liveSnapshotUrl(env = process.env) {
  return String(env.LIVE_SNAPSHOT_URL || DEFAULT_LIVE_SNAPSHOT_URL).trim();
}

export function shouldUseGovernedSnapshot(req = {}, env = process.env) {
  const explicit = String(env.ABG_SCAN_MODE || '').trim().toLowerCase();
  if (explicit === 'live' || explicit === 'fanout') return false;
  if (explicit === 'snapshot') return true;
  return String(env.VERCEL_ENV || env.VERCEL_TARGET_ENV || '').toLowerCase() === 'production';
}

export function isAuthorisedFullScan(req = {}, env = process.env) {
  const configured = String(env.SNAPSHOT_REFRESH_SECRET || '').trim();
  if (!configured) return false;
  const supplied = headerValue(req, 'x-abg-refresh-secret');
  return supplied.length > 0 && supplied === configured;
}

export function snapshotAgeMinutes(snapshot, now = new Date()) {
  const generatedAt = validDate(snapshot?.generatedAt);
  const current = validDate(now);
  if (!generatedAt || !current) return Number.POSITIVE_INFINITY;
  return Math.max(0, (current.getTime() - generatedAt.getTime()) / 60000);
}

export function validateLiveSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new SnapshotError('snapshot_invalid', 'The governed snapshot is not a JSON object.', 502);
  }
  if (Number(snapshot.schemaVersion) !== 1) {
    throw new SnapshotError('snapshot_schema_unsupported', `Unsupported snapshot schema: ${snapshot.schemaVersion ?? 'missing'}.`, 502);
  }
  if (!validDate(snapshot.generatedAt)) {
    throw new SnapshotError('snapshot_generated_at_missing', 'The governed snapshot has no valid generatedAt timestamp.', 502);
  }
  if (!validDate(snapshot.windowStart) || !validDate(snapshot.windowEnd)) {
    throw new SnapshotError('snapshot_window_invalid', 'The governed snapshot coverage window is invalid.', 502);
  }
  if (new Date(snapshot.windowStart) >= new Date(snapshot.windowEnd)) {
    throw new SnapshotError('snapshot_window_invalid', 'The governed snapshot coverage window is reversed.', 502);
  }
  if (!Array.isArray(snapshot.events)) {
    throw new SnapshotError('snapshot_events_missing', 'The governed snapshot has no events array.', 502);
  }
  if (!snapshot.meta || typeof snapshot.meta !== 'object' || Array.isArray(snapshot.meta)) {
    throw new SnapshotError('snapshot_meta_missing', 'The governed snapshot has no source-health metadata.', 502);
  }
  if (!Number.isFinite(Number(snapshot.meta.queryCount)) || Number(snapshot.meta.queryCount) < 1) {
    throw new SnapshotError('snapshot_checks_missing', 'The governed snapshot records no source checks.', 502);
  }
  if (!Number.isFinite(Number(snapshot.meta.successfulQueries))) {
    throw new SnapshotError('snapshot_success_count_missing', 'The governed snapshot has no successful-source count.', 502);
  }
  if (!Array.isArray(snapshot.meta.sourceChecks)) {
    throw new SnapshotError('snapshot_source_health_missing', 'The governed snapshot has no source-health detail.', 502);
  }
  const minimumSuccessRatio = Number(options.minimumSuccessRatio ?? 0.2);
  const successRatio = Number(snapshot.meta.successfulQueries) / Number(snapshot.meta.queryCount);
  if (successRatio < minimumSuccessRatio) {
    throw new SnapshotError(
      'snapshot_source_coverage_too_low',
      `Only ${snapshot.meta.successfulQueries}/${snapshot.meta.queryCount} source checks succeeded.`,
      503,
      { successRatio }
    );
  }
  return snapshot;
}

export function filterLiveSnapshot(snapshot, window, options = {}) {
  validateLiveSnapshot(snapshot, options);
  const requestedStart = validDate(window?.start);
  const requestedEnd = validDate(window?.end);
  if (!requestedStart || !requestedEnd || requestedStart >= requestedEnd) {
    throw new SnapshotError('requested_window_invalid', 'The requested news window is invalid.', 400);
  }

  const coverageStart = new Date(snapshot.windowStart);
  const coverageEnd = new Date(snapshot.windowEnd);
  const coverageComplete = requestedStart >= coverageStart && requestedEnd <= coverageEnd;
  if (!coverageComplete && options.requireCompleteWindow !== false) {
    throw new SnapshotError(
      'snapshot_window_incomplete',
      'The governed snapshot does not fully cover the requested period.',
      503,
      {
        requestedStart: requestedStart.toISOString(),
        requestedEnd: requestedEnd.toISOString(),
        snapshotWindowStart: coverageStart.toISOString(),
        snapshotWindowEnd: coverageEnd.toISOString()
      }
    );
  }

  const now = validDate(options.now) || new Date();
  const ageMinutes = snapshotAgeMinutes(snapshot, now);
  const staleAfterMinutes = Number(options.staleAfterMinutes ?? DEFAULT_SNAPSHOT_STALE_MINUTES);
  if (ageMinutes > staleAfterMinutes) {
    throw new SnapshotError(
      'snapshot_stale',
      `The governed snapshot is ${Math.round(ageMinutes)} minutes old; the limit is ${staleAfterMinutes} minutes.`,
      503,
      { ageMinutes, staleAfterMinutes, generatedAt: snapshot.generatedAt }
    );
  }

  const events = filterEventsByWindow(snapshot.events, {
    start: requestedStart.toISOString(),
    end: requestedEnd.toISOString()
  });

  return {
    events,
    entityUniverse: snapshot.entityUniverse || {},
    meta: {
      ...snapshot.meta,
      scannedAt: snapshot.generatedAt,
      deliveryMode: 'governed-snapshot',
      serviceVersion: snapshot.meta.serviceVersion || snapshot.serviceVersion || '6.0.0',
      eventCount: events.length,
      snapshot: {
        schemaVersion: snapshot.schemaVersion,
        generatedAt: snapshot.generatedAt,
        ageMinutes: Math.round(ageMinutes * 10) / 10,
        staleAfterMinutes,
        fresh: true,
        sourceCommit: snapshot.source?.commitSha || null,
        sourceWorkflowRun: snapshot.source?.workflowRunId || null,
        sourceRepository: snapshot.source?.repository || null,
        windowStart: snapshot.windowStart,
        windowEnd: snapshot.windowEnd,
        coverageComplete
      },
      windowStart: requestedStart.toISOString(),
      windowEnd: requestedEnd.toISOString(),
      requestedWindowStart: window.requestedStart || requestedStart.toISOString(),
      windowCapped: Boolean(window.capped)
    }
  };
}

export async function loadLiveSnapshot({
  url = liveSnapshotUrl(),
  fetchImpl = globalThis.fetch,
  window,
  now = new Date(),
  staleAfterMinutes = DEFAULT_SNAPSHOT_STALE_MINUTES,
  minimumSuccessRatio = 0.2,
  requireCompleteWindow = true,
  timeoutMs = 12000
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new SnapshotError('snapshot_fetch_unavailable', 'No fetch implementation is available.', 500);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'ABGPulse/6.0 governed-snapshot-reader'
      }
    });
    if (!response?.ok) {
      throw new SnapshotError('snapshot_unavailable', `Snapshot request failed with HTTP ${response?.status ?? 'unknown'}.`, 503);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new SnapshotError('snapshot_json_invalid', `Snapshot JSON could not be parsed: ${error?.message || error}.`, 502);
    }
    return filterLiveSnapshot(payload, window, {
      now,
      staleAfterMinutes,
      minimumSuccessRatio,
      requireCompleteWindow
    });
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    const aborted = error?.name === 'AbortError';
    throw new SnapshotError(
      aborted ? 'snapshot_timeout' : 'snapshot_fetch_failed',
      aborted ? `Snapshot request exceeded ${timeoutMs} ms.` : String(error?.message || error),
      503
    );
  } finally {
    clearTimeout(timer);
  }
}
