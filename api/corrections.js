import { randomUUID } from 'node:crypto';
import {
  PersistenceError,
  callSupabaseRpc,
  persistenceConfigFromEnv,
  safePersistenceDiagnostic,
  secureTokenEqual
} from '../lib/persistence.mjs';

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

function query(req, key) {
  const value = req?.query?.[key];
  if (Array.isArray(value)) return value[0];
  if (value !== undefined) return value;
  try { return new URL(req.url, 'https://abg-pulse.local').searchParams.get(key); } catch { return null; }
}

export function suppliedEditorialToken(req) {
  const authorization = String(header(req, 'authorization') || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(header(req, 'x-editorial-secret') || header(req, 'x-ingest-secret') || '').trim();
}

export function isEditorialAuthorised(req, env = process.env) {
  const expected = String(env.EDITORIAL_SECRET || env.INGEST_SECRET || '');
  return secureTokenEqual(expected, suppliedEditorialToken(req));
}

export function editorialActor(req, body = {}) {
  const actor = String(header(req, 'x-editor-id') || body.actor || '').trim();
  if (!actor) throw new PersistenceError('editor_required', 'An accountable editor identifier is required.', { status: 400 });
  if (actor.length > 200) throw new PersistenceError('editor_invalid', 'Editor identifier exceeds 200 characters.', { status: 400 });
  return actor;
}

function parseBody(req) {
  if (req?.body === undefined || req?.body === null || req?.body === '') return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
  if (Buffer.byteLength(text) > 256 * 1024) throw new PersistenceError('request_too_large', 'Correction request exceeds 256 KB.', { status: 413 });
  try { return JSON.parse(text); } catch { throw new PersistenceError('request_invalid', 'Correction request body is not valid JSON.', { status: 400 }); }
}

function cleanEvidenceIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PersistenceError('evidence_invalid', 'evidenceIds must be an array.', { status: 400 });
  const ids = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  if (ids.some((id) => id.length > 200)) throw new PersistenceError('evidence_invalid', 'An evidence identifier exceeds 200 characters.', { status: 400 });
  return ids;
}

function requestId(req) {
  const supplied = String(header(req, 'x-request-id') || '').trim();
  return supplied && supplied.length <= 200 ? supplied : randomUUID();
}

function unwrap(payload) {
  return Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed' });
  if (!isEditorialAuthorised(req)) return send(res, 401, { error: 'unauthorised', message: 'A valid editorial secret is required.' });

  const id = requestId(req);
  try {
    const config = persistenceConfigFromEnv();
    if (req.method === 'GET') {
      const claimId = String(query(req, 'claimId') || '').trim();
      if (!claimId) throw new PersistenceError('claim_id_required', 'claimId is required.', { status: 400 });
      if (claimId.length > 200) throw new PersistenceError('claim_id_invalid', 'claimId exceeds 200 characters.', { status: 400 });
      const result = await callSupabaseRpc({
        functionName: 'pulse_get_claim_history',
        body: { p_claim_id: claimId },
        config,
        requestId: id
      });
      return send(res, 200, {
        ok: true,
        claimId,
        history: unwrap(result.payload),
        requestId: id,
        persistence: safePersistenceDiagnostic(config),
        readAt: new Date().toISOString()
      });
    }

    const body = parseBody(req);
    const claimId = String(body.claimId || '').trim();
    const correctionText = String(body.correctionText || '').trim();
    const reason = String(body.reason || 'Correction supplied').trim();
    if (!claimId) throw new PersistenceError('claim_id_required', 'claimId is required.', { status: 400 });
    if (claimId.length > 200) throw new PersistenceError('claim_id_invalid', 'claimId exceeds 200 characters.', { status: 400 });
    if (!correctionText) throw new PersistenceError('correction_text_required', 'correctionText is required.', { status: 400 });
    if (correctionText.length > 10_000) throw new PersistenceError('correction_text_invalid', 'correctionText exceeds 10,000 characters.', { status: 400 });
    if (reason.length > 2_000) throw new PersistenceError('correction_reason_invalid', 'reason exceeds 2,000 characters.', { status: 400 });
    const evidenceIds = cleanEvidenceIds(body.evidenceIds);
    const actor = editorialActor(req, body);
    const result = await callSupabaseRpc({
      functionName: 'pulse_apply_correction',
      body: {
        p_claim_id: claimId,
        p_correction_text: correctionText,
        p_evidence_ids: evidenceIds,
        p_reason: reason || 'Correction supplied',
        p_actor: actor,
        p_request_id: id
      },
      config,
      requestId: id
    });
    return send(res, 200, {
      ok: true,
      correction: unwrap(result.payload),
      requestId: id,
      persistence: safePersistenceDiagnostic(config),
      instruction: 'The original claim remains in the audit history. Consumers should display the latest correction as current text.',
      correctedAt: new Date().toISOString()
    });
  } catch (error) {
    const postgresCode = error?.detail?.postgresCode || null;
    const notFound = postgresCode === 'P0002' || /claim not found/i.test(String(error?.message || ''));
    return send(res, notFound ? 404 : Number(error?.status || 500), {
      error: error?.code || 'correction_operation_failed',
      message: String(error?.message || error),
      detail: error?.detail || null,
      requestId: id,
      retryable: Boolean(error?.retryable),
      corrected: false
    });
  }
}
