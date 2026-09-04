import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const release = JSON.parse(readFileSync(fileURLToPath(new URL('../data/release.json', import.meta.url)), 'utf8'));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  return send(res, 200, {
    status: 'release-gated',
    meaning: 'Vercel Ready is necessary but not sufficient. The exact production commit must pass every listed assertion in the external verification workflow.',
    release,
    deployment: {
      environment: process.env.VERCEL_ENV || process.env.VERCEL_TARGET_ENV || 'local',
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      commitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || null
    },
    verificationWorkflow: 'https://github.com/NinjaRK/abg-pulse/actions/workflows/verify-production-release.yml'
  });
}
