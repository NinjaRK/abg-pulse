import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvidencePolicy } from '../lib/evidence-policy.mjs';

const event = {
  id: 'event-1',
  title: 'Material transaction announced',
  classification: 'Must Know',
  intelligence: { classification: 'Must Know', materiality: 88 }
};

test('keeps Tier-0 confirmed material development in Must Know', () => {
  const result = applyEvidencePolicy(event, { articles: [{
    title: 'Company announces ₹1,000 crore acquisition',
    url: 'https://www.nseindia.com/filing/1',
    sourceTier: 'tier0',
    official: true,
    publishedAt: '2026-09-03T10:00:00Z'
  }] });
  assert.equal(result.intelligence.classification, 'Must Know');
  assert.equal(result.evidencePolicy.mustKnowEligible, true);
  assert.equal(result.verificationStatus, 'confirmed');
});

test('downgrades a material single-source report from Must Know to Watch', () => {
  const result = applyEvidencePolicy(event, { articles: [{
    title: 'Company may announce ₹1,000 crore acquisition',
    url: 'https://single-source.example/story',
    sourceName: 'Single Source',
    publishedAt: '2026-09-03T10:00:00Z'
  }] });
  assert.equal(result.intelligence.classification, 'Watch');
  assert.equal(result.evidencePolicy.mustKnowEligible, false);
  assert.match(result.intelligence.verificationPolicyReason, /Tier-0|independent/);
});

test('two independent sources can retain Must Know eligibility', () => {
  const title = 'Company announces ₹1,000 crore acquisition';
  const result = applyEvidencePolicy(event, { articles: [
    { title, url: 'https://source-a.example/story', sourceName: 'A', publishedAt: '2026-09-03T10:00:00Z' },
    { title, url: 'https://source-b.example/story', sourceName: 'B', publishedAt: '2026-09-03T10:10:00Z' }
  ] });
  assert.equal(result.intelligence.classification, 'Must Know');
  assert.equal(result.evidencePolicy.mustKnowEligible, true);
});

test('numeric conflict forces Watch even with two sources', () => {
  const result = applyEvidencePolicy(event, { articles: [
    { title: 'Company announces ₹1,000 crore acquisition', url: 'https://a.example/story', sourceName: 'A' },
    { title: 'Company announces ₹1,500 crore acquisition', url: 'https://b.example/story', sourceName: 'B' }
  ] });
  assert.equal(result.intelligence.classification, 'Watch');
  assert.equal(result.evidencePolicy.disputed, true);
});

test('no evidence cannot remain Must Know', () => {
  const result = applyEvidencePolicy(event, { articles: [] });
  assert.equal(result.intelligence.classification, 'Other');
  assert.equal(result.evidencePolicy.noEvidence, true);
});
