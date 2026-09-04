import {
  authorizeRequest,
  persistenceConfig,
  persistenceClientFromEnv
} from '../lib/persistence.mjs';

const TYPES = new Set(['clarification','correction','retraction','source_update','classification_change']);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return null;
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') return 'json_body_required';
  if (!String(payload.eventId || '').trim()) return 'event_id_required';
  if (!TYPES.has(String(payload.type || '').trim())) return 'invalid_correction_type';
  if (String(payload.reason || '').trim().length < 8) return 'reason_too_short';
  if (String(payload.reason || '').length > 2000) return 'reason_too_long';
  if (payload.replacementText && String(payload.replacementText).length > 4000) return 'replacement_too_long';
  if (payload.evidenceIds && !Array.isArray(payload.evidenceIds)) return 'evidence_ids_must_be_array';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const config = persistenceConfig();
  if (!config.configured) return send(res, 503, { error: 'database_not_configured' });
  if (!process.env.EDITOR_SECRET || !authorizeRequest(req, process.env.EDITOR_SECRET)) {
    return send(res, 401, { error: 'unauthorised' });
  }

  let payload;
  try { payload = parseBody(req); }
  catch { return send(res, 400, { error: 'invalid_json' }); }
  const validationError = validate(payload);
  if (validationError) return send(res, 400, { error: validationError });

  try {
    const client = persistenceClientFromEnv();
    const result = await client.recordCorrection({
      eventId: String(payload.eventId).trim(),
      claimId: payload.claimId ? String(payload.claimId).trim() : null,
      type: String(payload.type).trim(),
      reason: String(payload.reason).trim(),
      replacementText: payload.replacementText ? String(payload.replacementText).trim() : null,
      evidenceIds: Array.isArray(payload.evidenceIds) ? payload.evidenceIds.map(String) : [],
      requestedBy: payload.requestedBy ? String(payload.requestedBy).trim() : null,
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
    });
    return send(res, 202, {
      ok: true,
      correction: result,
      meaning: 'A correction request was recorded. It does not alter published facts until the governed approval and propagation step is completed.'
    });
  } catch (error) {
    console.error('ABG Pulse correction request failed', error);
    return send(res, Number(error?.status) >= 400 ? Number(error.status) : 500, {
      error: 'correction_request_failed',
      detail: String(error?.message || error)
    });
  }
}
