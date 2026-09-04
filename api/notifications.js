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

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  const config = persistenceConfig();
  if (!config.configured) {
    return send(res, 503, {
      error: 'database_not_configured',
      meaning: 'Notification deduplication requires persistent storage. No notification is sent without an idempotent ledger.'
    });
  }
  if (!process.env.INGEST_SECRET || !authorizeRequest(req, process.env.INGEST_SECRET)) {
    return send(res, 401, { error: 'unauthorised' });
  }

  const client = persistenceClientFromEnv();
  try {
    if (req.method === 'GET') {
      const limit = Math.max(1, Math.min(5000, Number(first(req.query?.limit) || 1000)));
      const keys = await client.rpc('pulse_recent_notification_keys', { p_limit: limit });
      return send(res, 200, { notificationKeys: Array.isArray(keys) ? keys : [], count: Array.isArray(keys) ? keys.length : 0 });
    }

    const payload = parseBody(req);
    if (req.method === 'POST') {
      if (!Array.isArray(payload.changes) || payload.changes.length > 100) return send(res, 400, { error: 'valid_changes_array_required' });
      const invalid = payload.changes.find((change) => change.notificationEligible === true && (!change.notificationKey || !(change.eventId || change.event?.id)));
      if (invalid) return send(res, 400, { error: 'eligible_change_missing_key_or_event' });
      const result = await client.rpc('pulse_reserve_notifications', {
        p_changes: payload.changes,
        p_destination: String(payload.destination || 'webhook').slice(0, 100)
      });
      return send(res, 200, result);
    }

    if (req.method === 'PATCH') {
      if (!String(payload.notificationKey || '').trim()) return send(res, 400, { error: 'notification_key_required' });
      if (!['sent','failed','suppressed'].includes(String(payload.status || ''))) return send(res, 400, { error: 'invalid_notification_status' });
      const result = await client.rpc('pulse_mark_notification', {
        p_notification_key: String(payload.notificationKey),
        p_status: String(payload.status),
        p_response: payload.response && typeof payload.response === 'object' ? payload.response : null,
        p_error: payload.error ? String(payload.error).slice(0, 2000) : null
      });
      return send(res, 200, result);
    }

    return send(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    console.error('ABG Pulse notification ledger failed', error);
    return send(res, Number(error?.status) >= 400 ? Number(error.status) : 500, {
      error: 'notification_ledger_failed',
      detail: String(error?.message || error)
    });
  }
}
