import test from 'node:test';
import assert from 'node:assert/strict';
import eventsHandler from '../api/events.js';
import healthHandler from '../api/health.js';
import ingestHandler from '../api/ingest.js';

function mockResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { this.body = String(value); },
    json() { return JSON.parse(this.body); },
    headers
  };
}

test('events route stays live-only without database configuration and never serves demo data', async () => {
  const req = { method: 'GET', headers: {} };
  const res = mockResponse();
  await eventsHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.meta.mode, 'live-on-demand');
  assert.equal(body.meta.persistentHistory, false);
  assert.deepEqual(body.events, []);
  assert.equal(body.entityUniverse.officialCompanyEntries, 42);
});

test('events route rejects unsupported methods', async () => {
  const res = mockResponse();
  await eventsHandler({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('health route reports live-on-demand mode and a reconciled entity universe', async () => {
  const res = mockResponse();
  await healthHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.configured.database, false);
  assert.equal(body.mode, 'live-on-demand');
  assert.equal(body.entityUniverse.actual.officialCompanies, 42);
  assert.equal(body.entityUniverse.actual.officialLeadership, 40);
  assert.equal(body.entityUniverse.reconciled, true);
  assert.equal(body.publicSentiment.fullClosedPlatformCoverage, 'not connected');
});

test('ingestion fails closed when no secret is configured', async () => {
  const res = mockResponse();
  await ingestHandler({ method: 'POST', headers: {}, body: { events: [] } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'ingestion_not_configured');
});


test('ingestion writes a schema-complete event row', async () => {
  const previous = {
    INGEST_SECRET: process.env.INGEST_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: global.fetch
  };
  process.env.INGEST_SECRET = 'test-secret';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 201, text: async () => '' };
  };
  try {
    const event = {
      id: 'test-event',
      headline: 'Aditya Birla Capital expands a verified business line',
      summary: 'Aditya Birla Capital announced a verified expansion through an official company source. The event record is deliberately long enough to represent a real executive summary while remaining supported by source evidence and keeping interpretation separate from the reported facts in the underlying publication.',
      whyItMatters: 'The move broadens the company’s addressable market while preserving an auditable distinction between reported fact and strategic interpretation.',
      bucket: 'must', status: 'confirmed', category: 'Strategy',
      publishedAt: '2026-08-31T08:00:00.000Z', updatedAt: '2026-08-31T09:00:00.000Z',
      sources: [{ name: 'ABCL', url: 'https://www.adityabirlacapital.com/example', tier: 0, publishedAt: '2026-08-31T07:30:00.000Z' }],
      sourceCount: 1,
      intelligence: { materiality: 80, certainty: 95, momentum: 40, sentiment: 12, mediaTone: 12, publicSentiment: { score: 24, sampleSize: 11, channelCount: 2, confidence: 'medium' }, reputationImpact: 18, narrativeAlignment: 92 }
    };
    const res = mockResponse();
    await ingestHandler({ method: 'POST', headers: { 'x-ingest-secret': 'test-secret' }, body: { events: [event] } }, res);
    assert.equal(res.statusCode, 200);
    const rows = JSON.parse(captured.options.body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].summary, event.summary);
    assert.equal(rows[0].why_it_matters, event.whyItMatters);
    assert.equal(rows[0].lifecycle, 'confirmed');
    assert.equal(rows[0].materiality_score, 80);
    assert.equal(rows[0].source_count, 1);
    assert.equal(rows[0].media_tone_score, 12);
    assert.equal(rows[0].public_sentiment_score, 24);
    assert.equal(rows[0].public_sentiment_sample_size, 11);
    assert.equal(rows[0].public_sentiment_channel_count, 2);
    assert.equal(rows[0].public_sentiment_confidence, 'medium');
    assert.equal(rows[0].first_reported_at, '2026-08-31T07:30:00.000Z');
    assert.match(captured.url, /rest\/v1\/events\?on_conflict=id$/);
  } finally {
    if (previous.INGEST_SECRET === undefined) delete process.env.INGEST_SECRET; else process.env.INGEST_SECRET = previous.INGEST_SECRET;
    if (previous.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.SUPABASE_URL;
    if (previous.SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = previous.fetch;
  }
});
