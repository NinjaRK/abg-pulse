const HOUR = 60 * 60 * 1000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function firstHeader(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function baseUrl(req) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || firstHeader(req, 'host');
  if (!host) throw new Error('deployment_host_unavailable');
  return host.startsWith('http') ? host.replace(/\/$/, '') : `https://${host.replace(/\/$/, '')}`;
}

function missingConfiguration() {
  return [
    !process.env.CRON_SECRET && 'CRON_SECRET',
    !process.env.INGEST_SECRET && 'INGEST_SECRET',
    !process.env.SUPABASE_URL && 'SUPABASE_URL',
    !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY'
  ].filter(Boolean);
}

function authorised(req) {
  const supplied = firstHeader(req, 'authorization');
  return Boolean(process.env.CRON_SECRET && supplied === `Bearer ${process.env.CRON_SECRET}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { status: 'rejected', error: 'method_not_allowed' });

  const missing = missingConfiguration();
  if (missing.length) {
    return send(res, 200, {
      status: 'not_configured',
      ran: false,
      missing,
      message: 'Scheduled ingestion remains dormant until its server-side secrets and persistent database are connected.'
    });
  }

  if (!authorised(req)) return send(res, 401, { status: 'rejected', error: 'unauthorised_cron_request' });

  const end = new Date();
  const start = new Date(end.getTime() - 2 * HOUR);
  const origin = baseUrl(req);
  const scanUrl = `${origin}/api/scan?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

  try {
    const scanResponse = await fetch(scanUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'ABGPulse-Cron/5.4' }
    });
    const scanText = await scanResponse.text();
    if (!scanResponse.ok) throw new Error(`scan_failed_${scanResponse.status}: ${scanText.slice(0, 400)}`);

    let scan;
    try { scan = JSON.parse(scanText); } catch { throw new Error('scan_returned_invalid_json'); }
    if (!Array.isArray(scan.events) || !scan.meta) throw new Error('scan_contract_invalid');

    const idempotencyKey = `scheduled-${String(scan.meta.scannedAt || end.toISOString()).slice(0, 16)}`;
    const ingestResponse = await fetch(`${origin}/api/ingest`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INGEST_SECRET}`,
        'X-Ingest-Secret': process.env.INGEST_SECRET,
        'X-ABG-Pulse-Ingest-Secret': process.env.INGEST_SECRET,
        'X-Idempotency-Key': idempotencyKey,
        'User-Agent': 'ABGPulse-Cron/5.4'
      },
      body: JSON.stringify({
        events: scan.events,
        meta: scan.meta,
        sourceChecks: scan.meta.sourceChecks || [],
        scannedAt: scan.meta.scannedAt || end.toISOString(),
        idempotencyKey
      })
    });
    const ingestText = await ingestResponse.text();
    if (!ingestResponse.ok) throw new Error(`ingest_failed_${ingestResponse.status}: ${ingestText.slice(0, 400)}`);

    let ingest = {};
    try { ingest = JSON.parse(ingestText); } catch { ingest = { raw: ingestText.slice(0, 400) }; }
    return send(res, 200, {
      status: 'ok',
      ran: true,
      scannedAt: scan.meta.scannedAt,
      windowStart: scan.meta.windowStart,
      windowEnd: scan.meta.windowEnd,
      checksAttempted: scan.meta.queryCount,
      checksSucceeded: scan.meta.successfulQueries,
      eventsFound: scan.events.length,
      idempotencyKey,
      ingest
    });
  } catch (error) {
    return send(res, 502, {
      status: 'failed',
      ran: true,
      error: String(error?.message || error),
      time: new Date().toISOString()
    });
  }
}
