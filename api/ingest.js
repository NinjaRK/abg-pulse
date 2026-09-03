function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function validEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (!event.id || !event.headline || !event.summary || !event.whyItMatters) return false;
  if (!['must', 'watch', 'other'].includes(event.bucket)) return false;
  if (!['confirmed', 'strong', 'developing'].includes(event.status)) return false;
  if (!Array.isArray(event.sources) || event.sources.length < 1) return false;
  return event.sources.every((source) => source?.url && /^https?:\/\//i.test(source.url));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const expectedSecret = process.env.INGEST_SECRET;
  if (!expectedSecret) return send(res, 503, { error: 'ingestion_not_configured' });
  if (req.headers['x-ingest-secret'] !== expectedSecret) return send(res, 401, { error: 'unauthorised' });

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return send(res, 503, { error: 'database_not_configured' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const input = Array.isArray(body.events) ? body.events : [];
  const rejected = input.filter((event) => !validEvent(event)).map((event) => event?.id || 'unknown');
  const accepted = input.filter(validEvent).slice(0, 250);
  if (!accepted.length) return send(res, 422, { error: 'no_valid_events', rejected });

  const now = new Date().toISOString();
  const rows = accepted.map((event) => {
    const intelligence = event.intelligence || {};
    const sourceDates = event.sources
      .map((source) => source?.publishedAt)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));
    const firstReportedAt = sourceDates.length
      ? new Date(Math.min(...sourceDates.map((value) => value.getTime()))).toISOString()
      : (event.publishedAt || now);
    return {
      id: event.id,
      headline: event.headline,
      bucket: event.bucket,
      status: event.status,
      lifecycle: event.lifecycle || (event.status === 'confirmed' ? 'confirmed' : 'developing'),
      category: event.category || 'Corporate',
      summary: event.summary,
      why_it_matters: event.whyItMatters,
      materiality_score: Number.isFinite(intelligence.materiality) ? intelligence.materiality : null,
      certainty_score: Number.isFinite(intelligence.certainty) ? intelligence.certainty : null,
      momentum_score: Number.isFinite(intelligence.momentum) ? intelligence.momentum : null,
      sentiment_score: Number.isFinite(intelligence.mediaTone) ? intelligence.mediaTone : (Number.isFinite(intelligence.sentiment) ? intelligence.sentiment : null),
      media_tone_score: Number.isFinite(intelligence.mediaTone) ? intelligence.mediaTone : (Number.isFinite(intelligence.sentiment) ? intelligence.sentiment : null),
      public_sentiment_score: Number.isFinite(intelligence.publicSentiment?.score) ? intelligence.publicSentiment.score : null,
      public_sentiment_sample_size: Number.isFinite(intelligence.publicSentiment?.sampleSize) ? intelligence.publicSentiment.sampleSize : 0,
      public_sentiment_channel_count: Number.isFinite(intelligence.publicSentiment?.channelCount) ? intelligence.publicSentiment.channelCount : 0,
      public_sentiment_confidence: ['unavailable','low','medium','high'].includes(intelligence.publicSentiment?.confidence) ? intelligence.publicSentiment.confidence : 'unavailable',
      reputation_impact_score: Number.isFinite(intelligence.reputationImpact) ? intelligence.reputationImpact : null,
      narrative_alignment_score: Number.isFinite(intelligence.narrativeAlignment) ? intelligence.narrativeAlignment : null,
      source_count: event.sourceCount || event.sources.length,
      first_reported_at: firstReportedAt,
      published_at: event.publishedAt || now,
      updated_at: event.updatedAt || now,
      is_published: true,
      payload: event
    };
  });

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/events?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    return send(res, 200, { accepted: accepted.length, rejected, ingestedAt: now });
  } catch (error) {
    return send(res, 502, { error: 'database_write_failed', message: String(error?.message || error) });
  }
}
