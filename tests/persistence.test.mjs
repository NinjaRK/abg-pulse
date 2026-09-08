import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PersistenceError,
  callSupabaseRpc,
  claimGraphIdempotencyKey,
  normalizeSupabaseUrl,
  persistClaimGraph,
  persistenceConfigFromEnv,
  safePersistenceDiagnostic,
  secureTokenEqual,
  validatePersistableClaimGraph
} from '../lib/persistence.mjs';

const graph = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-09-08T10:00:00.000Z',
  sourceCommit: 'abc123def456',
  quality: { publishable: true, unsupportedMaterialClaimCount: 0 },
  eventSummaries: [{ eventId: 'event-1', claimIds: ['claim-1'], evidenceIds: ['evidence-1'] }],
  claims: [{
    id: 'claim-1',
    eventId: 'event-1',
    entityIds: ['company-a'],
    kind: 'fact',
    text: 'Company A filed a disclosure.',
    normalizedText: 'company a filed a disclosure',
    supportStatus: 'supported',
    evidenceIds: ['evidence-1']
  }],
  evidence: [{ id: 'evidence-1', eventId: 'event-1', authority: 'Official Exchange', url: 'https://exchange.example/disclosure', tier: 0 }],
  corrections: [],
  contradictions: []
};

const config = {
  url: 'https://example.supabase.co',
  serviceRoleKey: 'service-role-key-with-sufficient-length',
  timeoutMs: 2_000,
  maxAttempts: 3
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => payload === undefined ? '' : JSON.stringify(payload)
  };
}

test('Supabase URL normalisation requires HTTPS outside local development', () => {
  assert.equal(normalizeSupabaseUrl('https://example.supabase.co/'), 'https://example.supabase.co');
  assert.equal(normalizeSupabaseUrl('http://localhost:54321/'), 'http://localhost:54321');
  assert.throws(() => normalizeSupabaseUrl('http://example.supabase.co'), (error) => error.code === 'database_config_invalid');
});

test('persistence configuration fails closed when secrets are absent', () => {
  assert.throws(() => persistenceConfigFromEnv({ SUPABASE_URL: 'https://example.supabase.co' }), (error) => error.code === 'database_not_configured' && error.status === 503);
  assert.throws(() => persistenceConfigFromEnv({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'short' }), (error) => error.code === 'database_config_invalid');
});

test('claim graph validation rejects unsupported material claims and orphan evidence', () => {
  assert.throws(() => validatePersistableClaimGraph({ ...graph, quality: { publishable: false, unsupportedMaterialClaimCount: 1 } }), (error) => error.code === 'claim_graph_unpublishable');
  assert.throws(() => validatePersistableClaimGraph({
    ...graph,
    claims: [{ ...graph.claims[0], evidenceIds: ['missing'] }]
  }), (error) => error.code === 'claim_graph_orphan_evidence');
});

test('claim graph idempotency key is stable and manifest-sensitive', () => {
  const first = claimGraphIdempotencyKey(graph, 'a'.repeat(64));
  const second = claimGraphIdempotencyKey(JSON.parse(JSON.stringify(graph)), 'a'.repeat(64));
  const different = claimGraphIdempotencyKey(graph, 'b'.repeat(64));
  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.equal(first.length, 64);
});

test('Supabase RPC sends service credentials only in protected headers', async () => {
  let request;
  const result = await callSupabaseRpc({
    functionName: 'pulse_ingest_claim_graph',
    body: { p_graph: graph },
    config,
    requestId: 'request-1',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, { ok: true });
    },
    sleep: async () => {}
  });
  assert.equal(result.attempt, 1);
  assert.match(request.url, /\/rest\/v1\/rpc\/pulse_ingest_claim_graph$/);
  assert.equal(request.options.headers.apikey, config.serviceRoleKey);
  assert.equal(request.options.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
  assert.equal(request.options.headers['X-Request-Id'], 'request-1');
  assert.equal(request.options.body.includes(config.serviceRoleKey), false);
});

test('retryable database failures back off and recover', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await callSupabaseRpc({
    functionName: 'pulse_ingest_claim_graph',
    body: { p_graph: graph },
    config,
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? response(503, { message: 'Temporary outage' }) : response(200, { ok: true });
    },
    sleep: async (ms) => sleeps.push(ms)
  });
  assert.equal(result.attempt, 3);
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every((ms) => ms >= 250));
});

test('non-retryable database errors stop immediately', async () => {
  let calls = 0;
  await assert.rejects(() => callSupabaseRpc({
    functionName: 'pulse_ingest_claim_graph',
    body: { p_graph: graph },
    config,
    fetchImpl: async () => {
      calls += 1;
      return response(400, { message: 'Invalid payload' });
    },
    sleep: async () => {}
  }), (error) => error instanceof PersistenceError && error.code === 'database_rpc_failed' && error.retryable === false);
  assert.equal(calls, 1);
});

test('persistClaimGraph calls the transactional RPC with an idempotent request', async () => {
  let body;
  const result = await persistClaimGraph({
    graph,
    manifestSha256: 'a'.repeat(64),
    actor: 'test-actor',
    config,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response(200, { ok: true, runId: 'run-1' });
    },
    sleep: async () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.claimCount, 1);
  assert.equal(body.p_actor, 'test-actor');
  assert.equal(body.p_manifest_sha256, 'a'.repeat(64));
  assert.equal(body.p_request_id, result.requestId);
  assert.equal(result.database.result.runId, 'run-1');
  assert.equal(result.database.endpoint.includes(config.serviceRoleKey), false);
});

test('secret comparison is constant-time compatible and rejects empty values', () => {
  assert.equal(secureTokenEqual('same-secret', 'same-secret'), true);
  assert.equal(secureTokenEqual('same-secret', 'wrong-secret'), false);
  assert.equal(secureTokenEqual('', ''), false);
  assert.equal(secureTokenEqual('short', 'shorter'), false);
});

test('persistence diagnostics never expose the service-role key', () => {
  const diagnostic = safePersistenceDiagnostic(config);
  assert.equal(diagnostic.configured, true);
  assert.equal(diagnostic.urlHost, 'example.supabase.co');
  assert.equal(JSON.stringify(diagnostic).includes(config.serviceRoleKey), false);
  assert.match(diagnostic.keyFingerprint, /…/);
});
