import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeRequest,
  constantTimeMatch,
  createPersistenceClient,
  persistenceConfig,
  scanIdempotencyKey,
  serializeScanForPersistence
} from '../lib/persistence.mjs';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

const scan = {
  events: [{
    id: 'event-1',
    title: 'Official event',
    evidenceChain: { chainHash: 'chain-1', evidence: [{ id: 'ev-1' }] }
  }],
  meta: {
    serviceVersion: '6.3.0',
    windowStart: '2026-09-03T00:00:00Z',
    windowEnd: '2026-09-04T00:00:00Z',
    scannedAt: '2026-09-04T00:01:00Z',
    queryCount: 3,
    successfulQueries: 2,
    rawArticleCount: 20,
    articleCount: 6,
    registryReconciled: true,
    sourceHealth: { summary: { explicitFailures: 1 } },
    sourceChecks: [
      { name: 'nse:GRASIM', provider: 'NSE', tier: 'tier0', ok: true, itemCount: 1, attempts: 1, durationMs: 200, schemaValidated: true, emptyIsValid: true },
      { name: 'news', provider: 'News', tier: 'tier1', ok: false, itemCount: 0, attempts: 2, durationMs: 900, error: 'timeout' }
    ]
  }
};

test('database configuration is explicit and never inferred from a partial credential', () => {
  assert.equal(persistenceConfig({}).configured, false);
  assert.equal(persistenceConfig({ SUPABASE_URL: 'https://example.supabase.co' }).configured, false);
  assert.equal(persistenceConfig({ SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'secret' }).configured, true);
  assert.equal(persistenceConfig({ SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'secret' }).url, 'https://example.supabase.co');
});

test('bearer secrets use constant-time equality and fail closed', () => {
  assert.equal(constantTimeMatch('same-secret', 'same-secret'), true);
  assert.equal(constantTimeMatch('same-secret', 'wrong'), false);
  assert.equal(constantTimeMatch('', ''), false);
  assert.equal(authorizeRequest({ headers: { authorization: 'Bearer same-secret' } }, 'same-secret'), true);
  assert.equal(authorizeRequest({ headers: {} }, 'same-secret'), false);
});

test('scan serialization preserves source failures and evidence-rich events', () => {
  const payload = serializeScanForPersistence(scan, { commitSha: 'abc123' });
  assert.equal(payload.status, 'degraded');
  assert.equal(payload.queryCount, 3);
  assert.equal(payload.successfulQueries, 2);
  assert.equal(payload.sourceChecks.length, 2);
  assert.equal(payload.sourceChecks[1].error, 'timeout');
  assert.equal(payload.events[0].evidenceChain.chainHash, 'chain-1');
  assert.equal(payload.windowStart, '2026-09-03T00:00:00.000Z');
  assert.match(payload.idempotencyKey, /^[a-f0-9]{64}$/);
});

test('idempotency key is stable across event ordering and changes with evidence', () => {
  const other = {
    ...scan,
    events: [
      { id: 'event-2', evidenceChain: { chainHash: 'chain-2' } },
      scan.events[0]
    ]
  };
  const reordered = { ...other, events: [...other.events].reverse() };
  assert.equal(scanIdempotencyKey(other, 'sha'), scanIdempotencyKey(reordered, 'sha'));
  assert.notEqual(scanIdempotencyKey(scan, 'sha'), scanIdempotencyKey(other, 'sha'));
});

test('missing or invalid scan window is rejected before network access', () => {
  assert.throws(() => serializeScanForPersistence({ events: [], meta: {} }), /scan_window_missing/);
  assert.throws(() => serializeScanForPersistence({ events: [], meta: { windowStart: 'bad', windowEnd: 'bad' } }), /scan_window_invalid/);
});

test('persistScan calls the atomic database RPC with service-role authentication', async () => {
  let request;
  const client = createPersistenceClient({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ ok: true, eventsPersisted: 1 });
    }
  });
  const result = await client.persistScan(scan, { commitSha: 'abc123' });
  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://example.supabase.co/rest/v1/rpc/pulse_persist_scan');
  assert.equal(request.options.headers.apikey, 'service-secret');
  const body = JSON.parse(request.options.body);
  assert.equal(body.p_payload.events.length, 1);
});

test('Supabase errors preserve status and never look like successful persistence', async () => {
  const client = createPersistenceClient({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: async () => response({ message: 'schema missing' }, 404)
  });
  await assert.rejects(client.storageStatus(), (error) => error.status === 404 && /schema missing/.test(error.message));
});

test('history query applies bounded pagination, classification and a proper period conjunction', async () => {
  let requestedUrl;
  const client = createPersistenceClient({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: async (url) => { requestedUrl = url; return response([]); }
  });
  await client.history({
    start: '2026-09-01T00:00:00Z',
    end: '2026-09-02T00:00:00Z',
    classification: 'Must Know',
    limit: 999,
    offset: -10
  });
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get('limit'), '250');
  assert.equal(url.searchParams.get('offset'), '0');
  assert.equal(url.searchParams.get('classification'), 'eq.Must Know');
  assert.equal(url.searchParams.get('and'), '(last_seen_at.gte.2026-09-01T00:00:00.000Z,last_seen_at.lte.2026-09-02T00:00:00.000Z)');
});
