import {
  authorizeRequest,
  persistenceConfig,
  persistenceClientFromEnv
} from '../lib/persistence.mjs';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return null;
}

function validateScan(payload) {
  if (!payload || typeof payload !== 'object') return 'json_body_required';
  if (!Array.isArray(payload.events)) return 'events_array_required';
  if (!payload.meta || typeof payload.meta !== 'object') return 'scan_meta_required';
  if (payload.events.length > 100) return 'too_many_events';
  if (Array.isArray(payload.meta.sourceChecks) && payload.meta.sourceChecks.length > 1000) return 'too_many_source_checks';
  const start = payload.meta.windowStart || payload.meta.coverageWindow?.start || payload.windowStart;
  const end = payload.meta.windowEnd || payload.meta.coverageWindow?.end || payload.windowEnd;
  if (!start || !end || Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) return 'valid_scan_window_required';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const config = persistenceConfig();
  if (!config.configured) {
    return send(res, 503, {
      error: 'database_not_configured',
      meaning: 'No scan was stored. The platform remains live-on-demand until the authorised database is connected.'
    });
  }
  if (!process.env.INGEST_SECRET || !authorizeRequest(req, process.env.INGEST_SECRET)) {
    return send(res, 401, { error: 'unauthorised' });
  }

  let payload;
  try { payload = body(req); }
  catch { return send(res, 400, { error: 'invalid_json' }); }
  const validationError = validateScan(payload);
  if (validationError) return send(res, 400, { error: validationError });

  try {
    const client = persistenceClientFromEnv();
    const result = await client.persistScan(payload, {
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || '',
      mode: payload?.meta?.mode || 'live-on-demand'
    });
    return send(res, 200, {
      ok: true,
      persistence: result,
      storedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('ABG Pulse persistence failed', error);
    return send(res, Number(error?.status) >= 400 ? Number(error.status) : 500, {
      error: 'scan_persistence_failed',
      detail: String(error?.message || error)
    });
  }
}
