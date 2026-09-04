import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/cron-scan.js';

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value || ''); }
  };
}

function saveEnv() {
  return { ...process.env };
}

function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}

test('scheduled ingestion remains safely dormant before configuration', async () => {
  const saved = saveEnv();
  try {
    delete process.env.CRON_SECRET;
    delete process.env.INGEST_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = responseCapture();
    await handler({ method: 'GET', headers: { host: 'example.test' } }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.status, 'not_configured');
    assert.equal(body.ran, false);
    assert.ok(body.missing.includes('CRON_SECRET'));
  } finally { restoreEnv(saved); }
});

test('configured scheduled ingestion rejects the wrong bearer secret', async () => {
  const saved = saveEnv();
  try {
    process.env.CRON_SECRET = 'correct';
    process.env.INGEST_SECRET = 'ingest';
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'role';
    const res = responseCapture();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong', host: 'example.test' } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'unauthorised_cron_request');
  } finally { restoreEnv(saved); }
});

test('configured scheduled ingestion scans then submits an idempotent payload', async () => {
  const saved = saveEnv();
  const originalFetch = global.fetch;
  try {
    process.env.CRON_SECRET = 'correct';
    process.env.INGEST_SECRET = 'ingest';
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'role';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pulse.test';
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/scan')) return new Response(JSON.stringify({ events: [{ id: 'event-1' }], meta: { scannedAt: '2026-09-04T05:30:00.000Z', windowStart: 'a', windowEnd: 'b', queryCount: 10, successfulQueries: 9, sourceChecks: [] } }), { status: 200 });
      return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
    };
    const res = responseCapture();
    await handler({ method: 'GET', headers: { authorization: 'Bearer correct', host: 'ignored.test' } }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.status, 'ok');
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /^https:\/\/pulse\.test\/api\/scan/);
    assert.equal(calls[1].options.headers['X-Ingest-Secret'], 'ingest');
    assert.match(calls[1].options.headers['X-Idempotency-Key'], /^scheduled-/);
    assert.equal(JSON.parse(calls[1].options.body).events.length, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(saved);
  }
});
