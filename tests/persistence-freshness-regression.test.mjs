import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/persistence-health.js';

const NOW = Date.parse('2026-09-08T08:30:00.000Z');
const MINUTE = 60_000;
const RLS = Object.fromEntries([
  'pulse_claim_graph_runs', 'pulse_events', 'pulse_evidence', 'pulse_claims',
  'pulse_claim_evidence', 'pulse_corrections', 'pulse_contradictions', 'pulse_audit_log'
].map((table) => [table, true]));

// Exercise the real API and RPC wrapper; replace only the external HTTP boundary.
async function invoke({ timestamp = new Date(NOW).toISOString(), threshold,
  override = {}, now = NOW, method = 'GET', rpcStatus = 200 } = {}) {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-not-a-real-credential',
    PERSISTENCE_MAX_ATTEMPTS: '1',
    PERSISTENCE_STALE_MINUTES: threshold
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const oldNow = Date.now;
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = String(value);
    }
    Date.now = () => now;
    globalThis.fetch = async () => ({
      ok: rpcStatus >= 200 && rpcStatus < 300,
      status: rpcStatus,
      text: async () => JSON.stringify({
        ok: true,
        latestRun: { id: 'run-1', ingested_at: timestamp },
        counts: { graph_runs: 1, audit_entries: 1 },
        rls: RLS,
        quality: { hasIngestedGraph: true, latestRunHasNoUnsupportedMaterialClaims: true, auditTrailPresent: true },
        ...override
      })
    });
    let result;
    const res = {
      statusCode: 200, headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      end(body) { result = { status: this.statusCode, headers: this.headers, body: JSON.parse(body) }; }
    };
    await handler({ method, headers: {} }, res);
    assert.ok(result, 'API must end the response');
    return result;
  } finally {
    globalThis.fetch = oldFetch;
    Date.now = oldNow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function degraded(result) {
  assert.equal(result.status, 503);
  assert.equal(result.body.operational, false);
}

test('future-dated ingestion cannot produce an operational result', async () => {
  const result = await invoke({ timestamp: new Date(NOW + 24 * 60 * MINUTE).toISOString() });
  degraded(result);
  assert.equal(result.body.freshness.reason, 'timestamp_in_future');
});

test('unparseable configuration cannot make a five-year-old record look fresh', async () => {
  const result = await invoke({ threshold: 'not-a-number', timestamp: '2020-01-01T00:00:00.000Z' });
  degraded(result);
  assert.equal(result.body.quality.freshnessConfigValid, false);
  assert.equal(result.body.freshness.reason, 'invalid_freshness_configuration');
});

for (const threshold of ['', ' ', 'NaN', 'Infinity', '-1', '0', '29', '1441', '180oops', '0xB4', '1e3', '30.5']) {
  test(`invalid freshness configuration fails closed: ${JSON.stringify(threshold)}`, async () => {
    const result = await invoke({ threshold });
    degraded(result);
    assert.equal(result.body.quality.freshnessConfigValid, false);
    assert.equal(result.body.quality.staleAfterMinutes, null);
  });
}

for (const threshold of ['30', '180', '1440', ' 180 ']) {
  test(`valid freshness threshold remains usable: ${JSON.stringify(threshold)}`, async () => {
    const result = await invoke({ threshold });
    assert.equal(result.status, 200);
    assert.equal(result.body.operational, true);
    assert.equal(result.body.quality.staleAfterMinutes, Number(threshold));
  });
}

test('omitted threshold uses the documented 180-minute default', async () => {
  const result = await invoke();
  assert.equal(result.status, 200);
  assert.equal(result.body.quality.staleAfterMinutes, 180);
});

test('a record exactly at the freshness boundary remains fresh', async () => {
  const result = await invoke({ threshold: '180', timestamp: new Date(NOW - 180 * MINUTE).toISOString() });
  assert.equal(result.status, 200);
});

test('one millisecond past the freshness boundary fails without rounding grace', async () => {
  const result = await invoke({ threshold: '180', timestamp: new Date(NOW - 180 * MINUTE - 1).toISOString() });
  degraded(result);
  assert.equal(result.body.freshness.reason, 'stale');
});

test('small documented clock skew is tolerated', async () => {
  const result = await invoke({ timestamp: new Date(NOW + MINUTE).toISOString() });
  assert.equal(result.status, 200);
  assert.equal(result.body.quality.graphAgeMinutes, 0);
});

test('clock skew beyond 60 seconds is rejected', async () => {
  degraded(await invoke({ timestamp: new Date(NOW + MINUTE + 1).toISOString() }));
});

for (const timestamp of [null, '', true, NOW, [], '2026-09-08T08:30:00', '2026-09-31T08:30:00Z', '2026-09-08T24:00:00Z', '2026-09-08T08:30:00+24:00']) {
  test(`invalid or ambiguous ingestion timestamp is rejected: ${JSON.stringify(timestamp)}`, async () => {
    const result = await invoke({ timestamp });
    degraded(result);
    assert.equal(result.body.quality.timestampValid, false);
  });
}

for (const timestamp of ['2026-09-08T14:00:00+05:30', '2026-09-08T03:00:00-05:30', '2026-09-08T08:30:00.000000+00:00']) {
  test(`valid zoned/Postgres timestamp remains supported: ${timestamp}`, async () => {
    assert.equal((await invoke({ timestamp })).status, 200);
  });
}

test('invalid calendar days are rejected rather than normalised', async () => {
  const result = await invoke({ timestamp: '2026-02-30T08:30:00Z', now: Date.parse('2026-03-02T08:30:00Z') });
  degraded(result);
});

test('a real leap day remains valid', async () => {
  assert.equal((await invoke({ timestamp: '2028-02-29T08:30:00Z', now: Date.parse('2028-02-29T08:30:00Z') })).status, 200);
});

test('successful health responses cannot reuse cached green status', async () => {
  const result = await invoke();
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('failed health responses also remain uncacheable', async () => {
  const result = await invoke({ override: { latestRun: null } });
  degraded(result);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('invalid RPC payload explicitly says operational=false', async () => {
  degraded(await invoke({ override: { ok: false } }));
});

test('missing RLS still blocks a fresh record', async () => {
  degraded(await invoke({ override: { rls: { ...RLS, pulse_claims: false } } }));
});

test('missing audit evidence still blocks a fresh record', async () => {
  degraded(await invoke({ override: { quality: { hasIngestedGraph: true, latestRunHasNoUnsupportedMaterialClaims: true, auditTrailPresent: false } } }));
});

test('RPC failure cannot turn into a healthy cached result', async () => {
  const result = await invoke({ rpcStatus: 503 });
  degraded(result);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('diagnostics do not include the test service credential', async () => {
  const result = await invoke();
  assert.equal(JSON.stringify(result).includes('test-only-service-role-not-a-real-credential'), false);
});
