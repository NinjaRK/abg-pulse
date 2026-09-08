const DEFAULT_SNAPSHOT_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/data/authoritative-wave1.json';
const DEFAULT_STALE_MINUTES = 120;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60, stale-while-revalidate=180' : 'no-store');
  res.end(JSON.stringify(payload));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function queryValue(req, key) {
  const value = req?.query?.[key];
  if (Array.isArray(value)) return value[0];
  if (value !== undefined) return value;
  try {
    return new URL(req.url, 'https://abg-pulse.local').searchParams.get(key);
  } catch {
    return null;
  }
}

function requestedWindow(req, now = new Date()) {
  const startQuery = queryValue(req, 'start');
  const endQuery = queryValue(req, 'end');
  const hours = boundedNumber(queryValue(req, 'hours'), 24, 1, 24 * 30);
  const end = endQuery ? new Date(endQuery) : now;
  const start = startQuery ? new Date(startQuery) : new Date(end.getTime() - hours * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    const error = new Error('The requested authoritative-source time window is invalid.');
    error.code = 'invalid_window';
    error.status = 400;
    throw error;
  }
  const earliest = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: (start < earliest ? earliest : start).toISOString(),
    end: end.toISOString(),
    capped: start < earliest
  };
}

function selectedSourceIds(req) {
  const raw = queryValue(req, 'sources') || queryValue(req, 'source');
  if (!raw) return null;
  return new Set(String(raw).split(',').map((value) => value.trim()).filter(Boolean));
}

export function filterAuthoritativeRecords(records, { start, end, sourceIds = null, includeUndated = false } = {}) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return (Array.isArray(records) ? records : []).filter((record) => {
    if (sourceIds && !sourceIds.has(record.sourceId)) return false;
    if (!record.publishedAt) return includeUndated;
    const time = new Date(record.publishedAt).getTime();
    return Number.isFinite(time) && time >= startMs && time <= endMs;
  });
}

export function validateAuthoritativeSnapshot(payload, { now = new Date(), staleAfterMinutes = DEFAULT_STALE_MINUTES } = {}) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('Authoritative snapshot is not an object.'), { code: 'snapshot_invalid' });
  if (!Array.isArray(payload.records)) throw Object.assign(new Error('Authoritative snapshot has no records array.'), { code: 'snapshot_invalid' });
  if (!Array.isArray(payload.sourceChecks)) throw Object.assign(new Error('Authoritative snapshot has no source checks.'), { code: 'snapshot_invalid' });
  if (!payload.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) throw Object.assign(new Error('Authoritative snapshot generation time is invalid.'), { code: 'snapshot_invalid' });
  if (payload.quality?.publishable !== true) throw Object.assign(new Error('Authoritative snapshot did not pass its publication gate.'), { code: 'snapshot_unpublishable' });
  const ageMinutes = Math.max(0, (now.getTime() - new Date(payload.generatedAt).getTime()) / 60000);
  if (ageMinutes > staleAfterMinutes) {
    throw Object.assign(new Error(`Authoritative snapshot is ${Math.round(ageMinutes)} minutes old; limit is ${staleAfterMinutes}.`), {
      code: 'snapshot_stale',
      detail: { ageMinutes: Number(ageMinutes.toFixed(1)), staleAfterMinutes }
    });
  }
  return { ageMinutes: Number(ageMinutes.toFixed(1)), staleAfterMinutes };
}

export async function loadAuthoritativeSnapshot({ fetchImpl = fetch, url = process.env.AUTHORITATIVE_SNAPSHOT_URL || DEFAULT_SNAPSHOT_URL, timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ABG-Pulse/1.0 authoritative snapshot reader' }
    });
    if (!response.ok) throw Object.assign(new Error(`Authoritative snapshot returned HTTP ${response.status}.`), { code: 'snapshot_http_error', detail: { status: response.status } });
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Authoritative snapshot request timed out.'), { code: 'snapshot_timeout' });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const now = new Date();
    const window = requestedWindow(req, now);
    const sourceIds = selectedSourceIds(req);
    const includeUndated = ['1', 'true', 'yes'].includes(String(queryValue(req, 'includeUndated') || '').toLowerCase());
    const staleAfterMinutes = boundedNumber(process.env.AUTHORITATIVE_SNAPSHOT_STALE_MINUTES, DEFAULT_STALE_MINUTES, 30, 24 * 60);
    const payload = await loadAuthoritativeSnapshot();
    const freshness = validateAuthoritativeSnapshot(payload, { now, staleAfterMinutes });
    const records = filterAuthoritativeRecords(payload.records, { ...window, sourceIds, includeUndated });
    const selectedChecks = sourceIds
      ? payload.sourceChecks.filter((check) => sourceIds.has(check.sourceId))
      : payload.sourceChecks;
    return send(res, 200, {
      records,
      meta: {
        deliveryMode: 'governed-authoritative-snapshot',
        generatedAt: payload.generatedAt,
        ageMinutes: freshness.ageMinutes,
        staleAfterMinutes: freshness.staleAfterMinutes,
        windowStart: window.start,
        windowEnd: window.end,
        windowCapped: window.capped,
        recordCount: records.length,
        sourceCount: selectedChecks.length,
        successfulSourceCount: selectedChecks.filter((check) => check.ok).length,
        failedSourceCount: selectedChecks.filter((check) => !check.ok).length,
        sourceChecks: selectedChecks,
        sourceCommit: payload?.source?.commitSha || null,
        workflowRunId: payload?.source?.workflowRunId || null,
        rights: 'Official public filing and publication metadata; source documents remain at the originating authority.'
      }
    });
  } catch (error) {
    return send(res, Number(error?.status || 503), {
      error: error?.code || 'authoritative_snapshot_unavailable',
      message: String(error?.message || error),
      detail: error?.detail || null,
      records: [],
      meta: {
        deliveryMode: 'governed-authoritative-snapshot',
        failedClosed: true,
        checkedAt: new Date().toISOString()
      }
    });
  }
}
