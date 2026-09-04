import { detectMaterialChanges } from '../lib/material-change.mjs';
import { authorizeRequest } from '../lib/persistence.mjs';

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

export default function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!process.env.INGEST_SECRET || !authorizeRequest(req, process.env.INGEST_SECRET)) {
    return send(res, 401, { error: 'unauthorised' });
  }
  let payload;
  try { payload = parseBody(req); }
  catch { return send(res, 400, { error: 'invalid_json' }); }
  if (!payload || !Array.isArray(payload.currentEvents) || !Array.isArray(payload.previousEvents)) {
    return send(res, 400, { error: 'current_and_previous_event_arrays_required' });
  }
  if (payload.currentEvents.length > 100 || payload.previousEvents.length > 500) {
    return send(res, 413, { error: 'event_comparison_limit_exceeded' });
  }
  if (payload.previouslyNotifiedKeys && (!Array.isArray(payload.previouslyNotifiedKeys) || payload.previouslyNotifiedKeys.length > 5000)) {
    return send(res, 400, { error: 'invalid_previously_notified_keys' });
  }
  try {
    const result = detectMaterialChanges({
      currentEvents: payload.currentEvents,
      previousEvents: payload.previousEvents,
      previouslyNotifiedKeys: payload.previouslyNotifiedKeys || [],
      options: payload.options && typeof payload.options === 'object' ? payload.options : {}
    });
    return send(res, 200, result);
  } catch (error) {
    console.error('ABG Pulse material-change evaluation failed', error);
    return send(res, 500, { error: 'material_change_evaluation_failed', detail: String(error?.message || error) });
  }
}
