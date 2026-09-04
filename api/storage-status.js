import { persistenceConfig, persistenceClientFromEnv } from '../lib/persistence.mjs';

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const config = persistenceConfig();
  if (!config.configured) {
    return send(res, 200, {
      status: 'not_connected',
      mode: 'live-on-demand',
      sharedHistory: false,
      corrections: false,
      crossDeviceWatching: false,
      auditTrail: false,
      meaning: 'The database schema and APIs are built, but no production database is authorised. This endpoint does not pretend local or demo data is persistent.'
    }, 'public, s-maxage=120, stale-while-revalidate=300');
  }
  try {
    const client = persistenceClientFromEnv();
    const status = await client.storageStatus();
    return send(res, 200, {
      status: 'connected',
      mode: 'persistent',
      sharedHistory: true,
      corrections: true,
      crossDeviceWatching: true,
      auditTrail: true,
      database: status,
      checkedAt: new Date().toISOString()
    }, 'public, s-maxage=60, stale-while-revalidate=180');
  } catch (error) {
    console.error('ABG Pulse storage status failed', error);
    return send(res, 503, {
      status: 'degraded',
      mode: 'persistent-unavailable',
      sharedHistory: false,
      meaning: 'The database is configured but unreachable or has not received the required schema. Do not rely on stored history until this recovers.',
      detail: String(error?.message || error)
    });
  }
}
