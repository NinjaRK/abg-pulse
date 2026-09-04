import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const payload = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-health-baselines.json', import.meta.url)), 'utf8'));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const { _meta = {}, ...sources } = payload;
  const rows = Object.entries(sources).map(([sourceId, row]) => ({
    sourceId,
    provider: row.provider || null,
    tier: row.tier || null,
    samples: Array.isArray(row.samples) ? row.samples.length : 0,
    typicalItems: Number(row.typicalItems || 0),
    minimumItems: Number(row.minimumItems || 0),
    reviewed: row.reviewed === true,
    emptyIsValid: row.emptyIsValid === true,
    lastObservedAt: row.lastObservedAt || null
  }));
  const minimumSamples = Number(_meta.minimumSamplesBeforeEnforcement || 5);
  const ready = rows.filter((row) => row.reviewed || row.samples >= minimumSamples);
  return send(res, 200, {
    status: rows.length > 0 && ready.length === rows.length ? 'ready' : 'learning',
    meaning: 'This measures whether each configured source has enough operating history to detect abnormal silence. It does not measure recall or prove that every story was found.',
    minimumSamplesBeforeEnforcement: minimumSamples,
    configuredSources: Number(_meta.configuredSourceCount || rows.length),
    learnedSources: rows.length,
    readySources: ready.length,
    readySourcePct: rows.length ? Math.round((ready.length / rows.length) * 1000) / 10 : 0,
    updatedAt: _meta.updatedAt || null,
    lastObservationAt: _meta.lastObservationAt || null,
    lastEvaluation: _meta.lastEvaluation || null,
    sources: rows
  });
}
