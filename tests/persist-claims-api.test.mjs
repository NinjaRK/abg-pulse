import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  isIngestAuthorised,
  loadPublishedClaimGraph,
  suppliedIngestToken
} from '../api/persist-claims.js';

const graph = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-09-08T10:00:00.000Z',
  sourceCommit: 'abc123def456',
  quality: { publishable: true, unsupportedMaterialClaimCount: 0 },
  summary: { eventCount: 1, claimCount: 1, evidenceCount: 1 },
  eventSummaries: [{ eventId: 'event-1', claimIds: ['claim-1'], evidenceIds: ['evidence-1'] }],
  claims: [{ id: 'claim-1', eventId: 'event-1', kind: 'fact', text: 'A fact', supportStatus: 'supported', evidenceIds: ['evidence-1'] }],
  evidence: [{ id: 'evidence-1', eventId: 'event-1', url: 'https://official.example/evidence' }]
};

function fetchSequence(texts, statuses = []) {
  let index = 0;
  return async () => {
    const text = texts[index];
    const status = statuses[index] || 200;
    index += 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text
    };
  };
}

test('Bearer token and X-Ingest-Secret are both accepted inputs', () => {
  assert.equal(suppliedIngestToken({ headers: { authorization: 'Bearer top-secret' } }), 'top-secret');
  assert.equal(suppliedIngestToken({ headers: { 'x-ingest-secret': 'header-secret' } }), 'header-secret');
  assert.equal(suppliedIngestToken({ headers: {} }), '');
});

test('ingestion authorisation rejects missing and incorrect secrets', () => {
  assert.equal(isIngestAuthorised({ headers: { authorization: 'Bearer top-secret' } }, 'top-secret'), true);
  assert.equal(isIngestAuthorised({ headers: { authorization: 'Bearer wrong' } }, 'top-secret'), false);
  assert.equal(isIngestAuthorised({ headers: {} }, 'top-secret'), false);
  assert.equal(isIngestAuthorised({ headers: {} }, ''), false);
});

test('published graph loader verifies SHA-256, freshness and lineage', async () => {
  const graphText = `${JSON.stringify(graph)}\n`;
  const digest = createHash('sha256').update(graphText).digest('hex');
  const manifest = { sha256: digest, sourceCommit: graph.sourceCommit };
  const result = await loadPublishedClaimGraph({
    graphUrl: 'https://example.test/graph',
    manifestUrl: 'https://example.test/manifest',
    fetchImpl: fetchSequence([graphText, JSON.stringify(manifest)]),
    now: new Date('2026-09-08T11:00:00.000Z')
  });
  assert.equal(result.digest, digest);
  assert.equal(result.graph.sourceCommit, graph.sourceCommit);
  assert.equal(result.manifest.sourceCommit, graph.sourceCommit);
});

test('digest mismatch blocks database persistence before any write', async () => {
  const graphText = `${JSON.stringify(graph)}\n`;
  const manifest = { sha256: '0'.repeat(64), sourceCommit: graph.sourceCommit };
  await assert.rejects(() => loadPublishedClaimGraph({
    graphUrl: 'https://example.test/graph',
    manifestUrl: 'https://example.test/manifest',
    fetchImpl: fetchSequence([graphText, JSON.stringify(manifest)]),
    now: new Date('2026-09-08T11:00:00.000Z')
  }), (error) => error.code === 'claim_graph_digest_mismatch');
});

test('manifest and graph source-commit mismatch blocks persistence', async () => {
  const graphText = `${JSON.stringify(graph)}\n`;
  const digest = createHash('sha256').update(graphText).digest('hex');
  const manifest = { sha256: digest, sourceCommit: 'different-commit' };
  await assert.rejects(() => loadPublishedClaimGraph({
    graphUrl: 'https://example.test/graph',
    manifestUrl: 'https://example.test/manifest',
    fetchImpl: fetchSequence([graphText, JSON.stringify(manifest)]),
    now: new Date('2026-09-08T11:00:00.000Z')
  }), (error) => error.code === 'claim_graph_lineage_mismatch');
});

test('upstream graph retrieval failures remain explicit', async () => {
  await assert.rejects(() => loadPublishedClaimGraph({
    graphUrl: 'https://example.test/graph',
    manifestUrl: 'https://example.test/manifest',
    fetchImpl: fetchSequence(['unavailable', '{}'], [503, 200]),
    now: new Date('2026-09-08T11:00:00.000Z')
  }), (error) => error.code === 'claim_graph_fetch_failed' && error.retryable === true);
});
