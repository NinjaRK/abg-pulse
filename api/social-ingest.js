function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validObservation(observation) {
  if (!observation || typeof observation !== 'object') return false;
  if (!observation.eventId || !observation.platform || !observation.sourceUrl) return false;
  if (!/^https?:\/\//i.test(observation.sourceUrl)) return false;
  const tone = asFiniteNumber(observation.toneScore);
  if (tone === null || tone < -100 || tone > 100) return false;
  const engagement = asFiniteNumber(observation.engagementCount);
  if (engagement !== null && engagement < 0) return false;
  if (observation.publishedAt && Number.isNaN(new Date(observation.publishedAt).getTime())) return false;
  return true;
}

export function observationRow(observation, observedAt = new Date().toISOString()) {
  return {
    event_id: String(observation.eventId), source_url: String(observation.sourceUrl), platform: String(observation.platform),
    published_at: observation.publishedAt ? new Date(observation.publishedAt).toISOString() : null, observed_at: observedAt,
    tone_score: Math.round(Number(observation.toneScore)),
    engagement_count: asFiniteNumber(observation.engagementCount) === null ? null : Math.round(Number(observation.engagementCount)),
    language_code: observation.languageCode ? String(observation.languageCode) : null,
    accessible_publicly: observation.accessiblePublicly !== false,
    metadata: observation.metadata && typeof observation.metadata === 'object' ? observation.metadata : {}
  };
}

export function aggregateObservations(observations = []) {
  const valid = observations.filter((item) => Number.isFinite(Number(item.tone_score)));
  if (!valid.length) return { score: null, sampleSize: 0, channelCount: 0, confidence: 'unavailable' };
  const platforms = new Set(valid.map((item) => String(item.platform || 'unknown').toLowerCase()));
  let totalWeight = 0, weightedScore = 0;
  for (const item of valid) {
    const engagement = Math.max(0, Number(item.engagement_count || 0));
    const weight = Math.max(1, Math.min(8, 1 + Math.log2(1 + engagement)));
    totalWeight += weight; weightedScore += Number(item.tone_score) * weight;
  }
  const sampleSize = valid.length, channelCount = platforms.size;
  const confidence = sampleSize >= 25 && channelCount >= 2 ? 'high' : sampleSize >= 8 ? 'medium' : 'low';
  return { score: Math.round(weightedScore / Math.max(1, totalWeight)), sampleSize, channelCount, confidence };
}

async function restFetch(base, key, path, options = {}) {
  const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const expectedSecret = process.env.SOCIAL_INGEST_SECRET || process.env.INGEST_SECRET;
  if (!expectedSecret) return send(res, 503, { error: 'social_ingestion_not_configured' });
  if (req.headers['x-social-ingest-secret'] !== expectedSecret && req.headers['x-ingest-secret'] !== expectedSecret) return send(res, 401, { error: 'unauthorised' });
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return send(res, 503, { error: 'database_not_configured' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch { return send(res, 400, { error: 'invalid_json' }); }
  const input = Array.isArray(body.observations) ? body.observations : [];
  const rejected = input.filter((item) => !validObservation(item)).map((item, index) => item?.sourceUrl || `observation-${index + 1}`);
  const accepted = input.filter(validObservation).slice(0, 1000);
  if (!accepted.length) return send(res, 422, { error: 'no_valid_observations', rejected });
  const observedAt = new Date().toISOString(), rows = accepted.map((item) => observationRow(item, observedAt));
  try {
    await restFetch(base, key, 'public_conversation_observations?on_conflict=event_id,source_url', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    const eventIds = [...new Set(rows.map((row) => row.event_id))].slice(0, 100), aggregates = [];
    for (const eventId of eventIds) {
      const response = await restFetch(base, key, `public_conversation_observations?select=tone_score,platform,engagement_count&event_id=eq.${encodeURIComponent(eventId)}&limit=5000`);
      const aggregate = aggregateObservations(await response.json());
      aggregates.push({ eventId, ...aggregate });
      await restFetch(base, key, `events?id=eq.${encodeURIComponent(eventId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ public_sentiment_score: aggregate.score, public_sentiment_sample_size: aggregate.sampleSize, public_sentiment_channel_count: aggregate.channelCount, public_sentiment_confidence: aggregate.confidence, updated_at: observedAt }) });
    }
    return send(res, 200, { accepted: accepted.length, rejected, eventCount: eventIds.length, aggregates, ingestedAt: observedAt, coverageNote: 'Scores reflect only observations supplied by connected, authorised sources. They do not imply universal platform coverage.' });
  } catch (error) { return send(res, 502, { error: 'social_database_write_failed', message: String(error?.message || error) }); }
}
