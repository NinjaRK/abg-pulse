const DEFAULT_STATUS_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/data/deployment-status.json';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=30, stale-while-revalidate=120' : 'no-store');
  res.end(JSON.stringify(payload));
}

export function validateDeploymentStatus(payload, { now = new Date(), staleAfterHours = 24 } = {}) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('Deployment status is not an object.'), { code: 'deployment_status_invalid' });
  if (!payload.observedAt || Number.isNaN(new Date(payload.observedAt).getTime())) throw Object.assign(new Error('Deployment observation time is invalid.'), { code: 'deployment_status_invalid' });
  if (!['healthy', 'failed', 'pending'].includes(payload.state)) throw Object.assign(new Error(`Unknown deployment state: ${payload.state}`), { code: 'deployment_status_invalid' });
  const ageHours = Math.max(0, (now.getTime() - new Date(payload.observedAt).getTime()) / 3_600_000);
  return {
    ageHours: Number(ageHours.toFixed(2)),
    stale: ageHours > staleAfterHours,
    staleAfterHours
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = process.env.DEPLOYMENT_STATUS_URL || DEFAULT_STATUS_URL;
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ABG-Pulse/1.0 deployment observer' }
    });
    if (!response.ok) throw Object.assign(new Error(`Deployment status returned HTTP ${response.status}.`), { code: 'deployment_status_http_error' });
    const payload = await response.json();
    const freshness = validateDeploymentStatus(payload, {
      staleAfterHours: Math.max(1, Math.min(168, Number(process.env.DEPLOYMENT_STATUS_STALE_HOURS || 24)))
    });
    return send(res, 200, {
      ...payload,
      freshness,
      interpretation: {
        healthy: 'The most recently observed Vercel event reported a ready, successful or promoted deployment.',
        failed: 'The most recently observed Vercel event reported a failed, blocked, errored or cancelled deployment.',
        pending: 'The most recently observed deployment is not yet terminal.',
        caveat: 'This records observed deployment events. Endpoint health and exact-commit verification remain separate gates.'
      }
    });
  } catch (error) {
    return send(res, 503, {
      error: error?.code || (error?.name === 'AbortError' ? 'deployment_status_timeout' : 'deployment_status_unavailable'),
      message: String(error?.message || error),
      state: 'unknown',
      failedClosed: true,
      checkedAt: new Date().toISOString()
    });
  } finally {
    clearTimeout(timeout);
  }
}
