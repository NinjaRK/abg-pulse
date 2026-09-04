import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceChain, attachEvidenceChain, summarizeEvidenceChains } from '../lib/evidence-chain.mjs';

const event = { id: 'event-1', title: 'UltraTech acquires Example Cement' };

test('direct exchange filing confirms an event and preserves evidence provenance', () => {
  const cluster = { articles: [{
    title: 'UltraTech Cement acquires 51% stake in Example Cement for ₹3,954 crore',
    description: 'The board approved the transaction on Thursday.',
    url: 'https://www.nseindia.com/disclosure/123?utm_source=test',
    publishedAt: '2026-09-03T10:00:00Z',
    provider: 'NSE direct filing feed',
    sourceTier: 'tier0',
    official: true,
    channel: 'official-filing',
    entityId: 'ultratech-cement',
    rightsStatus: 'metadata-and-link'
  }] };
  const chain = buildEvidenceChain(event, cluster, { retrievedAt: '2026-09-03T11:00:00Z' });
  assert.equal(chain.verification.status, 'confirmed');
  assert.equal(chain.tier0EvidenceCount, 1);
  assert.equal(chain.evidence[0].url, 'https://www.nseindia.com/disclosure/123');
  assert.equal(chain.evidence[0].rightsStatus, 'metadata-and-link');
  assert.ok(chain.claimGroups.some((claim) => claim.supported));
  assert.match(chain.evidenceHash, /^[a-f0-9]{64}$/);
  assert.match(chain.chainHash, /^[a-f0-9]{64}$/);
});

test('two independent publishers corroborate a material claim', () => {
  const title = 'Hindalco reports quarterly revenue of ₹58,000 crore';
  const chain = buildEvidenceChain(event, { articles: [
    { title, url: 'https://publisher-a.example/story', sourceName: 'Publisher A', publishedAt: '2026-09-03T10:00:00Z' },
    { title, url: 'https://publisher-b.example/story', sourceName: 'Publisher B', publishedAt: '2026-09-03T10:30:00Z' }
  ] });
  assert.equal(chain.verification.status, 'corroborated');
  assert.equal(chain.independentSourceCount, 2);
  assert.equal(chain.unsupportedMaterialClaims.length, 0);
  assert.ok(chain.claimGroups.every((claim) => claim.supported));
});

test('syndicated copies from one origin do not count as independent corroboration', () => {
  const title = 'Aditya Birla Capital plans to raise ₹1,000 crore';
  const chain = buildEvidenceChain(event, { articles: [
    { title, url: 'https://site-a.example/story', originalPublisher: 'Wire Service', publishedAt: '2026-09-03T10:00:00Z' },
    { title, url: 'https://site-b.example/reprint', originalPublisher: 'Wire Service', publishedAt: '2026-09-03T10:05:00Z' }
  ] });
  assert.equal(chain.independentSourceCount, 1);
  assert.equal(chain.verification.status, 'single-source');
  assert.ok(chain.unsupportedMaterialClaims.length >= 1);
});

test('closely related claims with different numeric anchors are flagged as unresolved', () => {
  const chain = buildEvidenceChain(event, { articles: [
    { title: 'Company will invest ₹1,000 crore in the new plant', url: 'https://a.example/one', sourceName: 'A', publishedAt: '2026-09-03T10:00:00Z' },
    { title: 'Company will invest ₹1,500 crore in the new plant', url: 'https://b.example/two', sourceName: 'B', publishedAt: '2026-09-03T10:10:00Z' }
  ] });
  assert.equal(chain.contradictions.length, 1);
  assert.equal(chain.contradictions[0].status, 'unresolved');
  assert.equal(chain.verification.status, 'disputed');
});

test('tracking parameters do not create duplicate evidence', () => {
  const chain = buildEvidenceChain(event, { articles: [
    { title: 'Same story', url: 'https://a.example/story?utm_source=x', sourceName: 'A' },
    { title: 'Same story', url: 'https://a.example/story?utm_source=y', sourceName: 'A' }
  ] });
  assert.equal(chain.evidenceCount, 1);
});

test('attachment exposes supported source-derived claims on the event', () => {
  const attached = attachEvidenceChain(event, { articles: [{
    title: 'Novelis files an 8-K with the SEC',
    url: 'https://www.sec.gov/Archives/example.htm',
    sourceTier: 'tier0',
    official: true,
    publishedAt: '2026-09-03T12:00:00Z'
  }] });
  assert.equal(attached.verificationStatus, 'confirmed');
  assert.ok(Array.isArray(attached.claims));
  assert.ok(attached.claims[0].evidence.length >= 1);
  const summary = summarizeEvidenceChains([attached]);
  assert.equal(summary.confirmedEvents, 1);
  assert.equal(summary.eventsWithEvidence, 1);
});
