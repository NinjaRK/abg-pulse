import { createHash, randomUUID } from 'node:crypto';
import { validateClaimEvidenceGraph } from './claims.js';
import {
  PersistenceError,
  persistClaimGraph,
  persistenceConfigFromEnv,
  safePersistenceDiagnostic,
  secureTokenEqual
} from '../lib/persistence.mjs';

const DEFAULT_GRAPH_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/data/claim-evidence.json';
const DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/data/claim-evidence.manifest.json';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function header(req, name) {
  const value = req?.headers?.[String(name).toLowerCase()] ?? req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function suppliedIngestToken(req) {
  const authorization = String(header(req, 'authorization') || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(header(req, 'x-ingest-secret') || '').trim();
}

export function isIngestAuthorised(req, expected = process.env.INGEST_SECRET) {
  return secureTokenEqual(expected, suppliedIngestToken(req));
}

function requestId(req) {
  const supplied = String(header(req, 'x-request-id') || '').trim();
  return supplied && supplied.length <= 200 ? supplied : randomUUID();
}

function parseBody(req) {
  if (req?.body === undefined || req?.body === null || req?.body === '') return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new PersistenceError('request_too_large', 'Persistence request exceeds 8 MB.', { status: 413 });
  try { return JSON.parse(text); } catch { throw new PersistenceError('request_invalid', 'Persistence request body is not valid JSON.', { status: 400 }); }
}

async function fetchText(url, { timeoutMs = 30_000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ABG-Pulse/1.0 claim persistence' }
    });
    if (!response.ok) throw new PersistenceError('claim_graph_fetch_failed', `${url} returned HTTP ${response.status}.`, { status: 503, retryable: true });
    return await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') throw new PersistenceError('claim_graph_fetch_timeout', `${url} timed out.`, { status: 503, retryable: true });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadPublishedClaimGraph({
  graphUrl = process.env.CLAIM_EVIDENCE_URL || DEFAULT_GRAPH_URL,
  manifestUrl = process.env.CLAIM_EVIDENCE_MANIFEST_URL || DEFAULT_MANIFEST_URL,
  fetchImpl = fetch,
  now = new Date()
} = {}) {
  const [graphText, manifestText] = await Promise.all([
    fetchText(graphUrl, { fetchImpl }),
    fetchText(manifestUrl, { fetchImpl })
  ]);
  let graph;
  let manifest;
  try {
    graph = JSON.parse(graphText);
    manifest = JSON.parse(manifestText);
  } catch {
    throw new PersistenceError('claim_graph_invalid', 'Published claim graph or manifest is not valid JSON.', { status: 503 });
  }
  const digest = createHash('sha256').update(graphText).digest('hex');
  if (digest !== manifest.sha256) {
    throw new PersistenceError('claim_graph_digest_mismatch', 'Published claim graph does not match its integrity manifest.', {
      status: 503,
      detail: { calculated: digest, declared: manifest.sha256 || null }
    });
  }
  validateClaimEvidenceGraph(graph, {
    now,
    staleAfterMinutes: Math.max(30, Math.min(24 * 60, Number(process.env.CLAIM_EVIDENCE_STALE_MINUTES || 240)))
  });
  if (manifest.sourceCommit && graph.sourceCommit !== manifest.sourceCommit) {
    throw new PersistenceError('claim_graph_lineage_mismatch', 'Claim graph and manifest source commits do not match.', { status: 503 });
  }
  return { graph, manifest, digest };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const config = persistenceConfigFromEnv();
      return send(res, 200, {
        status: 'configured',
        persistence: safePersistenceDiagnostic(config),
        writeEndpoint: 'POST /api/persist-claims',
        authentication: 'Bearer INGEST_SECRET or X-Ingest-Secret',
        guarantees: [
          'Transactional database function',
          'Idempotent graph-run key',
          'Zero unsupported material claims required',
          'Orphan evidence references rejected',
          'Original claims retained when corrections are appended'
        ]
      });
    } catch (error) {
      return send(res, Number(error?.status || 503), {
        status: 'not_configured',
        error: error?.code || 'database_not_configured',
        message: String(error?.message || error),
        persistence: { configured: false }
      });
    }
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const expectedSecret = String(process.env.INGEST_SECRET || '');
  if (!expectedSecret) return send(res, 503, { error: 'ingestion_not_configured', message: 'INGEST_SECRET is not configured.' });
  if (!isIngestAuthorised(req, expectedSecret)) return send(res, 401, { error: 'unauthorised', message: 'A valid ingestion secret is required.' });

  const id = requestId(req);
  try {
    const body = parseBody(req);
    let graph = body.graph;
    let manifestSha256 = body.manifestSha256 || null;
    let source = 'request-body';
    if (!graph) {
      const published = await loadPublishedClaimGraph();
      graph = published.graph;
      manifestSha256 = published.manifest.sha256;
      source = 'published-live-data';
    } else {
      validateClaimEvidenceGraph(graph, {
        staleAfterMinutes: Math.max(30, Math.min(24 * 60, Number(process.env.CLAIM_EVIDENCE_STALE_MINUTES || 240)))
      });
    }
    const config = persistenceConfigFromEnv();
    const result = await persistClaimGraph({
      graph,
      manifestSha256,
      actor: String(body.actor || 'authenticated-ingestion'),
      requestId: id,
      config
    });
    return send(res, 200, {
      ...result,
      source,
      persistedAt: new Date().toISOString()
    });
  } catch (error) {
    return send(res, Number(error?.status || 500), {
      error: error?.code || 'claim_persistence_failed',
      message: String(error?.message || error),
      detail: error?.detail || null,
      requestId: id,
      retryable: Boolean(error?.retryable),
      persisted: false
    });
  }
}
