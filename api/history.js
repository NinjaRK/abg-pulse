import { persistenceConfig, persistenceClientFromEnv } from '../lib/persistence.mjs';

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classification(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (raw === 'mustknow') return 'Must Know';
  if (raw === 'watch') return 'Watch';
  if (raw === 'other') return 'Other';
  return null;
}

function publicEvent(row = {}) {
  if (row.current_payload && typeof row.current_payload === 'object') {
    return {
      ...row.current_payload,
      id: row.id,
      title: row.title || row.current_payload.title,
      classification: row.classification,
      verificationStatus: row.verification_status,
      publishedAt: row.published_at || row.current_payload.publishedAt,
      lastSeenAt: row.last_seen_at || row.current_payload.lastSeenAt,
      persistence: {
        sourceCount: row.source_count,
        independentSourceCount: row.independent_source_count,
        tier0EvidenceCount: row.tier0_evidence_count,
        unsupportedMaterialClaimCount: row.unsupported_material_claim_count,
        contradictionCount: row.contradiction_count
      }
    };
  }
  return row;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const config = persistenceConfig();
  if (!config.configured) {
    return send(res, 503, {
      error: 'database_not_configured',
      mode: 'live-on-demand',
      meaning: 'Shared event history is unavailable. No cached or demonstration story is presented as current.'
    });
  }

  const start = validDate(first(req.query?.start));
  const end = validDate(first(req.query?.end));
  const bucket = classification(first(req.query?.classification));
  const limit = Math.max(1, Math.min(250, Number(first(req.query?.limit) || 100)));
  const offset = Math.max(0, Number(first(req.query?.offset) || 0));
  if (first(req.query?.start) && !start) return send(res, 400, { error: 'invalid_start' });
  if (first(req.query?.end) && !end) return send(res, 400, { error: 'invalid_end' });
  if (start && end && new Date(end) < new Date(start)) return send(res, 400, { error: 'end_before_start' });
  if (first(req.query?.classification) && !bucket) return send(res, 400, { error: 'invalid_classification' });

  try {
    const client = persistenceClientFromEnv();
    const rows = await client.history({ start, end, classification: bucket, limit, offset });
    return send(res, 200, {
      mode: 'persistent',
      period: { start, end },
      classification: bucket,
      count: Array.isArray(rows) ? rows.length : 0,
      events: Array.isArray(rows) ? rows.map(publicEvent) : [],
      generatedAt: new Date().toISOString()
    }, 'public, s-maxage=60, stale-while-revalidate=300');
  } catch (error) {
    console.error('ABG Pulse history failed', error);
    return send(res, Number(error?.status) >= 400 ? Number(error.status) : 500, {
      error: 'history_unavailable',
      detail: String(error?.message || error)
    });
  }
}
