import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/persistence-health.js';

const requiredRls = {
  pulse_claim_graph_runs: true,
  pulse_events: true,
  pulse_evidence: true,
  pulse_claims: true,
  pulse_claim_evidence: true,
  pulse_corrections: true,
  pulse_contradictions: true,
  pulse_audit_log: true
};

function invoke(req = { method: 'GET', headers: {} }) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { resolve({ statusCode: this.statusCode, headers: this.headers, body: JSON.parse(body) }); }
    };
    handler(req, response);
  });
}

async function withEnvironment(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function rpcResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

test('persistence health is operational only with recent audited and RLS-protected data', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => rpcResponse({
    ok: true,
    latestRun: {
      id: 'run-1',
      source_commit: 'abc123',
      ingested_at: new Date().toISOString(),
      unsupported_material_claim_count: 0
    },
    counts: { graph_runs: 1, events: 3, claims: 5, evidence: 4, corrections: 1, audit_entries: 2 },
    rls: requiredRls,
    quality: {
      hasIngestedGraph: true,
      latestRunHasNoUnsupportedMaterialClaims: true,
      auditTrailPresent: true
    }
  });
  try {
    const result = await withEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-with-sufficient-length',
      PERSISTENCE_STALE_MINUTES: '180'
    }, () => invoke());
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.status, 'operational');
    assert.equal(result.body.operational, true);
    assert.equal(result.body.quality.rlsComplete, true);
    assert.equal(result.body.quality.stale, false);
    assert.equal(JSON.stringify(result.body).includes('service-role-key-with-sufficient-length'), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('missing database configuration is reported honestly', async () => {
  const result = await withEnvironment({
    SUPABASE_URL: null,
    SUPABASE_SERVICE_ROLE_KEY: null
  }, () => invoke());
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.status, 'not_configured');
  assert.equal(result.body.operational, false);
  assert.equal(result.body.error, 'database_not_configured');
});

test('missing RLS protection degrades health even when the database is reachable', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => rpcResponse({
    ok: true,
    latestRun: { id: 'run-1', ingested_at: new Date().toISOString() },
    counts: { graph_runs: 1, audit_entries: 1 },
    rls: { ...requiredRls, pulse_claims: false },
    quality: {
      hasIngestedGraph: true,
      latestRunHasNoUnsupportedMaterialClaims: true,
      auditTrailPresent: true
    }
  });
  try {
    const result = await withEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-with-sufficient-length'
    }, () => invoke());
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.status, 'degraded');
    assert.equal(result.body.quality.rlsComplete, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('stale persisted graphs degrade health rather than being silently accepted', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => rpcResponse({
    ok: true,
    latestRun: { id: 'run-1', ingested_at: '2020-01-01T00:00:00.000Z' },
    counts: { graph_runs: 1, audit_entries: 1 },
    rls: requiredRls,
    quality: {
      hasIngestedGraph: true,
      latestRunHasNoUnsupportedMaterialClaims: true,
      auditTrailPresent: true
    }
  });
  try {
    const result = await withEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-with-sufficient-length',
      PERSISTENCE_STALE_MINUTES: '30'
    }, () => invoke());
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.quality.stale, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('unsupported methods are rejected', async () => {
  const result = await invoke({ method: 'POST', headers: {} });
  assert.equal(result.statusCode, 405);
  assert.equal(result.body.error, 'method_not_allowed');
});
