import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entities = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entities.json', import.meta.url)), 'utf8'));
const entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));
const officialLeadershipUrl = entityUniverse.sourceOfTruth.leadership;
const counts = {
  officialCompanies: entities.filter((entity) => entity.type === 'company' && entity.officialCompanyEntry === true).length,
  officialLeadership: entities.filter((entity) => entity.type === 'person' && entity.sourceUrl === officialLeadershipUrl).length,
  totalEntities: entities.length,
  stakeholders: entities.filter((entity) => entity.type === 'stakeholder').length
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const configured = {
    database: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    ingestion: Boolean(process.env.INGEST_SECRET),
    closedSocialListening: Boolean(process.env.SOCIAL_LISTENING_PROVIDER)
  };
  let databaseReachable = null;
  if (configured.database) {
    try {
      const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/events?select=id&limit=1`, {
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
      });
      databaseReachable = response.ok;
    } catch { databaseReachable = false; }
  }
  const universeReconciled = counts.officialCompanies === entityUniverse.officialCompanyEntries && counts.officialLeadership === entityUniverse.officialLeadershipEntries;
  return send(res, databaseReachable === false ? 503 : 200, {
    status: databaseReachable === false ? 'degraded' : 'ok',
    mode: configured.database ? 'persistent' : 'live-on-demand',
    deployment: {
      environment: process.env.VERCEL_ENV || process.env.VERCEL_TARGET_ENV || 'local',
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      commitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      projectId: process.env.VERCEL_PROJECT_ID || null,
      deploymentUrl: process.env.VERCEL_URL || null,
      productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || null
    },
    configured,
    databaseReachable,
    entityUniverse: { ...entityUniverse, actual: counts, reconciled: universeReconciled },
    publicSentiment: {
      openPublic: 'available when accessible public-conversation sources return qualifying samples',
      fullClosedPlatformCoverage: configured.closedSocialListening ? 'connected' : 'not connected'
    },
    time: new Date().toISOString()
  });
}
