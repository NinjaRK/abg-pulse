import { createHash, timingSafeEqual } from 'node:crypto';

function normalizeBaseUrl(value = '') {
  return String(value).trim().replace(/\/$/, '');
}

function json(value, fallback) {
  return value && typeof value === 'object' ? value : fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function string(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function persistenceConfig(env = process.env) {
  const url = normalizeBaseUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '');
  const serviceRoleKey = string(env.SUPABASE_SERVICE_ROLE_KEY || '');
  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
    ingestSecretConfigured: Boolean(env.INGEST_SECRET),
    editorSecretConfigured: Boolean(env.EDITOR_SECRET)
  };
}

export function constantTimeMatch(left = '', right = '') {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerToken(req = {}) {
  const raw = req.headers?.authorization || req.headers?.Authorization || '';
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function authorizeRequest(req, expectedSecret) {
  return constantTimeMatch(bearerToken(req), expectedSecret || '');
}

export function scanIdempotencyKey(scan = {}, commitSha = '') {
  const meta = json(scan.meta, {});
  const start = meta.windowStart || meta.coverageWindow?.start || scan.windowStart || '';
  const end = meta.windowEnd || meta.coverageWindow?.end || scan.windowEnd || '';
  const serviceVersion = meta.serviceVersion || scan.serviceVersion || '';
  const eventHashes = (Array.isArray(scan.events) ? scan.events : [])
    .map((event) => event?.evidenceChain?.chainHash || event?.id || '')
    .filter(Boolean)
    .sort();
  return createHash('sha256')
    .update(stableStringify({ start, end, commitSha, serviceVersion, eventHashes }))
    .digest('hex');
}

export function serializeScanForPersistence(scan = {}, {
  commitSha = process.env.VERCEL_GIT_COMMIT_SHA || '',
  mode = 'live-on-demand',
  idempotencyKey
} = {}) {
  const meta = json(scan.meta, {});
  const execution = json(meta.execution, {});
  const sourceHealth = json(meta.sourceHealth, {});
  const events = Array.isArray(scan.events) ? scan.events : [];
  const sourceChecks = Array.isArray(meta.sourceChecks) ? meta.sourceChecks : [];
  const startedAt = meta.startedAt || meta.scannedAt || new Date().toISOString();
  const completedAt = meta.completedAt || meta.scannedAt || new Date().toISOString();
  const windowStart = meta.windowStart || meta.coverageWindow?.start || scan.windowStart;
  const windowEnd = meta.windowEnd || meta.coverageWindow?.end || scan.windowEnd;
  if (!windowStart || !windowEnd) throw new Error('scan_window_missing');
  if (Number.isNaN(new Date(windowStart).getTime()) || Number.isNaN(new Date(windowEnd).getTime())) throw new Error('scan_window_invalid');
  if (!Array.isArray(events)) throw new Error('scan_events_invalid');

  const successfulQueries = number(meta.successfulQueries, sourceChecks.filter((check) => check.ok === true).length);
  const queryCount = number(meta.queryCount, sourceChecks.length);
  return {
    idempotencyKey: idempotencyKey || scanIdempotencyKey(scan, commitSha),
    status: successfulQueries === queryCount ? 'completed' : successfulQueries > 0 ? 'degraded' : 'failed',
    mode,
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    commitSha: commitSha || null,
    serviceVersion: meta.serviceVersion || null,
    queryCount,
    successfulQueries,
    rawArticleCount: number(meta.rawArticleCount),
    relevantArticleCount: number(meta.articleCount ?? meta.relevantArticleCount),
    registryReconciled: meta.registryReconciled ?? null,
    sourceHealth,
    sourceChecks: sourceChecks.map((check) => ({
      sourceId: check.sourceId || check.id || check.name || null,
      name: check.name || check.sourceId || check.id || null,
      provider: check.provider || null,
      tier: check.tier || null,
      authority: check.authority || null,
      entityId: check.entityId || null,
      status: check.status || (check.ok ? 'healthy' : 'failed'),
      ok: check.ok === true,
      itemCount: number(check.itemCount),
      durationMs: check.durationMs ?? null,
      attempts: number(check.attempts),
      schemaValidated: check.schemaValidated ?? null,
      emptyIsValid: check.emptyIsValid === true,
      silentFailure: check.silentFailure === true,
      deadlineSkipped: check.deadlineSkipped === true,
      error: check.error || null
    })),
    events,
    metadata: {
      execution,
      queryPlan: meta.queryPlan || null,
      tier0: meta.tier0 || null,
      bse: meta.bse || null,
      regulator: meta.regulator || null,
      evidence: meta.evidence || null,
      errors: meta.errors || scan.errors || []
    }
  };
}

async function readJsonResponse(response, operation) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = { raw: text }; }
  if (!response.ok) {
    const detail = body?.message || body?.error_description || body?.error || text || `HTTP ${response.status}`;
    const error = new Error(`${operation}_failed: ${detail}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function createPersistenceClient({
  url,
  serviceRoleKey,
  fetchImpl = fetch
} = {}) {
  const baseUrl = normalizeBaseUrl(url);
  if (!baseUrl || !serviceRoleKey) throw new Error('database_not_configured');
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  const rpc = async (name, args = {}) => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args)
    });
    return readJsonResponse(response, `rpc_${name}`);
  };

  const select = async (table, params = {}) => {
    const query = new URLSearchParams(params);
    const response = await fetchImpl(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?${query}`, {
      method: 'GET',
      headers: { ...headers, Prefer: 'count=exact' }
    });
    return readJsonResponse(response, `select_${table}`);
  };

  return {
    rpc,
    select,
    storageStatus: () => rpc('pulse_storage_status'),
    persistScan: (scan, options = {}) => rpc('pulse_persist_scan', { p_payload: serializeScanForPersistence(scan, options) }),
    recordCorrection: (payload) => rpc('pulse_record_correction', { p_payload: payload }),
    history: ({ start, end, classification, limit = 100, offset = 0 } = {}) => {
      const params = {
        select: '*',
        order: 'published_at.desc.nullslast,last_seen_at.desc',
        limit: String(Math.max(1, Math.min(250, number(limit, 100)))),
        offset: String(Math.max(0, number(offset, 0)))
      };
      if (start) params['last_seen_at'] = `gte.${new Date(start).toISOString()}`;
      if (end) params['last_seen_at'] = `${params['last_seen_at'] ? `${params['last_seen_at']},` : ''}lte.${new Date(end).toISOString()}`;
      if (classification) params.classification = `eq.${classification}`;
      return select('pulse_current_feed', params);
    }
  };
}

export function persistenceClientFromEnv(env = process.env, fetchImpl = fetch) {
  const config = persistenceConfig(env);
  if (!config.configured) throw new Error('database_not_configured');
  return createPersistenceClient({ url: config.url, serviceRoleKey: config.serviceRoleKey, fetchImpl });
}
