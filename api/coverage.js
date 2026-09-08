import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCoverageAudit } from '../lib/coverage.mjs';

// Keep every runtime asset path literal. Vercel traces serverless-function files
// statically; a generic readJson(path) helper can build successfully while the
// JSON files are omitted from the deployed function bundle.
const entities = JSON.parse(readFileSync(
  fileURLToPath(new URL('../data/entities.json', import.meta.url)),
  'utf8'
));
const sourceRegistry = JSON.parse(readFileSync(
  fileURLToPath(new URL('../data/source-registry.json', import.meta.url)),
  'utf8'
));
const officialSources = JSON.parse(readFileSync(
  fileURLToPath(new URL('../config/official-sources.json', import.meta.url)),
  'utf8'
));
const queryGroups = JSON.parse(readFileSync(
  fileURLToPath(new URL('../config/queries.json', import.meta.url)),
  'utf8'
));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const audit = buildCoverageAudit({ entities, sourceRegistry, officialSources, queryGroups });
    return send(res, 200, {
      status: Object.values(audit.gates).every(Boolean) ? 'complete' : 'gaps_visible',
      meaning: 'Configured coverage, not a claim that every material development was captured. Dependability is established only through the independent benchmark.',
      ...audit
    });
  } catch (error) {
    return send(res, 500, {
      status: 'error',
      error: 'coverage_audit_failed',
      detail: String(error?.message || error)
    });
  }
}
