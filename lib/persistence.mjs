import { createHash, timingSafeEqual } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 4;

export class PersistenceError extends Error {
  constructor(code, message, { status = 500, retryable = false, detail = null } = {}) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

export function normalizeSupabaseUrl(value) {
  if (!value) throw new PersistenceError('database_not_configured', 'SUPABASE_URL is not configured.', { status: 503 });
  let url;
  try { url = new URL(String(value)); } catch { throw new PersistenceError('database_config_invalid', 'SUPABASE_URL is invalid.', { status: 503 }); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new PersistenceError('database_config_invalid', 'SUPABASE_URL must use HTTPS outside local development.', { status: 503 });
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export function persistenceConfigFromEnv(env = process.env) {
  const url = normalizeSupabaseUrl(env.SUPABASE_URL);
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRoleKey) throw new PersistenceError('database_not_configured', 'SUPABASE_SERVICE_ROLE_KEY is not configured.', { status: 503 });
  if (serviceRoleKey.length < 20) throw new PersistenceError('database_config_invalid', 'SUPABASE_SERVICE_ROLE_KEY is structurally invalid.', { status: 503 });
  return {
    url,
    serviceRoleKey,
    timeoutMs: boundedInteger(env.PERSISTENCE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 3_000, 60_000),
    maxAttempts: boundedInteger(env.PERSISTENCE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 8)
  };
}

export function claimGraphIdempotencyKey(graph, manifestSha256 = '') {
  const sourceCommit = String(graph?.sourceCommit || '').trim();
  const generatedAt = String(graph?.generatedAt || '').trim();
  if (!sourceCommit || !generatedAt) throw new PersistenceError('claim_graph_invalid', 'Claim graph requires sourceCommit and generatedAt.', { status: 400 });
  return createHash('sha256').update(`${sourceCommit}|${generatedAt}|${manifestSha256}`).digest('hex');
}

export function validatePersistableClaimGraph(graph, manifestSha256 = null) {
  if (!graph || typeof graph !== 'object') throw new PersistenceError('claim_graph_invalid', 'Claim graph must be an object.', { status: 400 });
  if (!Array.isArray(graph.claims) || !Array.isArray(graph.evidence) || !Array.isArray(graph.eventSummaries)) {
    throw new PersistenceError('claim_graph_invalid', 'Claim graph arrays are missing.', { status: 400 });
  }
  if (graph?.quality?.publishable !== true) throw new PersistenceError('claim_graph_unpublishable', 'Claim graph did not pass its publication gate.', { status: 409 });
  if (Number(graph?.quality?.unsupportedMaterialClaimCount || 0) !== 0) {
    throw new PersistenceError('unsupported_material_claims', 'Unsupported material claims block persistence.', { status: 409 });
  }
  if (!graph.sourceCommit || !graph.generatedAt) throw new PersistenceError('claim_graph_invalid', 'Claim graph provenance is incomplete.', { status: 400 });
  if (Number.isNaN(new Date(graph.generatedAt).getTime())) throw new PersistenceError('claim_graph_invalid', 'Claim graph generatedAt is invalid.', { status: 400 });
  if (manifestSha256 !== null && !/^[a-f0-9]{64}$/i.test(String(manifestSha256))) {
    throw new PersistenceError('manifest_invalid', 'Claim graph manifest SHA-256 is invalid.', { status: 400 });
  }
  const evidenceIds = new Set(graph.evidence.map((item) => item.id));
  const orphanReferences = graph.claims.flatMap((claim) => (claim.evidenceIds || [])
    .filter((id) => !evidenceIds.has(id))
    .map((evidenceId) => ({ claimId: claim.id, evidenceId })));
  if (orphanReferences.length) {
    throw new PersistenceError('claim_graph_orphan_evidence', 'Claim graph contains orphan evidence references.', {
      status: 409,
      detail: { orphanReferences: orphanReferences.slice(0, 20) }
    });
  }
  return {
    eventCount: graph.eventSummaries.length,
    claimCount: graph.claims.length,
    evidenceCount: graph.evidence.length,
    correctionCount: Array.isArray(graph.corrections) ? graph.corrections.length : 0,
    contradictionCount: Array.isArray(graph.contradictions) ? graph.contradictions.length : 0,
    idempotencyKey: claimGraphIdempotencyKey(graph, manifestSha256 || '')
  };
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function redact(value = '') {
  const text = String(value);
  return text.length <= 8 ? '[redacted]' : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2_000) }; }
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callSupabaseRpc({
  functionName,
  body,
  config = persistenceConfigFromEnv(),
  fetchImpl = fetch,
  sleep = delay,
  requestId = null
} = {}) {
  if (!/^[a-z0-9_]+$/i.test(String(functionName || ''))) throw new PersistenceError('rpc_invalid', 'RPC function name is invalid.', { status: 500 });
  const endpoint = `${config.url}/rest/v1/rpc/${functionName}`;
  let lastError = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          Prefer: 'return=representation',
          ...(requestId ? { 'X-Request-Id': requestId } : {})
        },
        body: JSON.stringify(body)
      });
      const payload = await parseResponse(response);
      if (response.ok) return { payload, attempt, endpoint, status: response.status };
      const message = payload?.message || payload?.hint || payload?.raw || `Supabase RPC returned HTTP ${response.status}.`;
      lastError = new PersistenceError('database_rpc_failed', message, {
        status: retryableStatus(response.status) ? 503 : 500,
        retryable: retryableStatus(response.status),
        detail: { httpStatus: response.status, attempt, functionName, requestId }
      });
      if (!lastError.retryable || attempt === config.maxAttempts) throw lastError;
    } catch (error) {
      if (error instanceof PersistenceError) {
        lastError = error;
        if (!error.retryable || attempt === config.maxAttempts) throw error;
      } else if (error?.name === 'AbortError') {
        lastError = new PersistenceError('database_timeout', `Database RPC timed out after ${config.timeoutMs}ms.`, {
          status: 503,
          retryable: true,
          detail: { attempt, functionName, requestId }
        });
        if (attempt === config.maxAttempts) throw lastError;
      } else {
        lastError = new PersistenceError('database_unreachable', String(error?.message || error), {
          status: 503,
          retryable: true,
          detail: { attempt, functionName, requestId }
        });
        if (attempt === config.maxAttempts) throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }
    const backoff = Math.min(8_000, 250 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 150));
    await sleep(backoff);
  }
  throw lastError || new PersistenceError('database_rpc_failed', 'Database RPC failed without detail.', { status: 503 });
}

export async function persistClaimGraph({
  graph,
  manifestSha256 = null,
  actor = 'claim-evidence-ingestor',
  requestId = null,
  config,
  fetchImpl,
  sleep
} = {}) {
  const validation = validatePersistableClaimGraph(graph, manifestSha256);
  const effectiveRequestId = requestId || validation.idempotencyKey;
  const result = await callSupabaseRpc({
    functionName: 'pulse_ingest_claim_graph',
    body: {
      p_graph: graph,
      p_manifest_sha256: manifestSha256,
      p_actor: actor,
      p_request_id: effectiveRequestId
    },
    config,
    fetchImpl,
    sleep,
    requestId: effectiveRequestId
  });
  const payload = Array.isArray(result.payload) && result.payload.length === 1 ? result.payload[0] : result.payload;
  return {
    ok: true,
    idempotencyKey: validation.idempotencyKey,
    requestId: effectiveRequestId,
    attempt: result.attempt,
    httpStatus: result.status,
    counts: validation,
    database: {
      result: payload,
      endpoint: result.endpoint.replace(/\/rest\/v1\/rpc\/.+$/, '/rest/v1/rpc/[redacted]')
    }
  };
}

export function secureTokenEqual(expected, supplied) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(supplied || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function safePersistenceDiagnostic(config) {
  return {
    configured: Boolean(config?.url && config?.serviceRoleKey),
    urlHost: config?.url ? new URL(config.url).hostname : null,
    keyFingerprint: config?.serviceRoleKey ? redact(createHash('sha256').update(config.serviceRoleKey).digest('hex')) : null,
    timeoutMs: config?.timeoutMs || null,
    maxAttempts: config?.maxAttempts || null
  };
}
