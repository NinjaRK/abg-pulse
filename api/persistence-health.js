import {
  callSupabaseRpc,
  persistenceConfigFromEnv,
  safePersistenceDiagnostic
} from '../lib/persistence.mjs';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'private, max-age=30, stale-while-revalidate=60' : 'no-store');
  res.end(JSON.stringify(payload));
}

function unwrap(payload) {
  return Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const config = persistenceConfigFromEnv();
    const result = await callSupabaseRpc({
      functionName: 'pulse_persistence_health',
      body: {},
      config,
      requestId: `persistence-health-${Date.now()}`
    });
    const health = unwrap(result.payload);
    if (!health || health.ok !== true) {
      return send(res, 503, {
        status: 'degraded',
        error: 'persistence_health_invalid',
        message: 'Database returned an invalid persistence-health response.',
        persistence: safePersistenceDiagnostic(config)
      });
    }
    const latestRun = health.latestRun && typeof health.latestRun === 'object' ? health.latestRun : null;
    const graphAgeMinutes = latestRun?.ingested_at
      ? Math.max(0, Math.round((Date.now() - new Date(latestRun.ingested_at).getTime()) / 60_000))
      : null;
    const staleAfterMinutes = Math.max(30, Math.min(24 * 60, Number(process.env.PERSISTENCE_STALE_MINUTES || 180)));
    const stale = graphAgeMinutes === null || !Number.isFinite(graphAgeMinutes) || graphAgeMinutes > staleAfterMinutes;
    const rls = health.rls || {};
    const requiredTables = [
      'pulse_claim_graph_runs','pulse_events','pulse_evidence','pulse_claims',
      'pulse_claim_evidence','pulse_corrections','pulse_contradictions','pulse_audit_log'
    ];
    const rlsComplete = requiredTables.every((table) => rls[table] === true);
    const quality = {
      configured: true,
      reachable: true,
      hasIngestedGraph: health.quality?.hasIngestedGraph === true,
      latestRunHasNoUnsupportedMaterialClaims: health.quality?.latestRunHasNoUnsupportedMaterialClaims === true,
      auditTrailPresent: health.quality?.auditTrailPresent === true,
      rlsComplete,
      stale,
      graphAgeMinutes,
      staleAfterMinutes
    };
    const operational = Object.entries(quality)
      .filter(([key]) => !['graphAgeMinutes', 'staleAfterMinutes'].includes(key))
      .every(([key, value]) => key === 'stale' ? value === false : value === true);
    return send(res, operational ? 200 : 503, {
      status: operational ? 'operational' : 'degraded',
      operational,
      quality,
      latestRun,
      counts: health.counts || {},
      rls,
      checkedAt: new Date().toISOString(),
      persistence: safePersistenceDiagnostic(config),
      caveat: 'Operational means the database is reachable, recently ingested, protected by RLS and contains an audit trail. Backup restore is measured separately.'
    });
  } catch (error) {
    return send(res, Number(error?.status || 503), {
      status: error?.code === 'database_not_configured' ? 'not_configured' : 'unavailable',
      operational: false,
      error: error?.code || 'persistence_health_unavailable',
      message: String(error?.message || error),
      detail: error?.detail || null,
      checkedAt: new Date().toISOString()
    });
  }
}
