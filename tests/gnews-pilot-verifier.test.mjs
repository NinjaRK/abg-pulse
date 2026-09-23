import test from 'node:test';
import assert from 'node:assert/strict';
import { runGNewsPilot } from '../scripts/verify-gnews-pilot.mjs';

const queryPlan = {
  schemaVersion: 1,
  queries: [
    { id: 'cement', group: 'cement-building', query: '"UltraTech Cement"' },
    { id: 'metals', group: 'metals-aluminium', query: 'Hindalco OR Novelis' }
  ]
};

test('GNews live-pilot verifier deduplicates candidates, assesses relevance and emits metadata only', async () => {
  const key = 'fake-live-pilot-secret';
  const output = await runGNewsPilot({
    apiKey: key,
    now: new Date('2026-09-23T10:00:00Z'),
    queryPlan,
    concurrency: 2,
    fetchImpl: async (url) => {
      const q = new URL(url).searchParams.get('q');
      const article = {
        title: 'UltraTech Cement announces new capacity investment',
        description: 'UltraTech Cement announced a major capacity expansion.',
        content: q.includes('UltraTech')
          ? 'Synthetic test body one.'
          : 'Synthetic test body two.',
        url: 'https://example.com/shared-story',
        publishedAt: '2026-09-23T09:00:00Z',
        source: { name: 'Example', url: 'https://example.com', country: 'in' }
      };
      return { ok: true, status: 200, json: async () => ({ totalArticles: 1, articles: [article] }) };
    }
  });
  assert.equal(output.queryCount, 2);
  assert.equal(output.successfulQueries, 2);
  assert.equal(output.uniqueArticleCount, 1);
  assert.equal(output.relevantArticleCount, 1);
  assert.deepEqual(output.candidates[0].queryIds.sort(), ['cement', 'metals']);
  assert.equal('content' in output.candidates[0], false);
  assert.equal(JSON.stringify(output).includes(key), false);
  assert.equal(JSON.stringify(output).includes('Synthetic test body'), false);
});

test('GNews live-pilot verifier keeps provider failures explicit', async () => {
  let calls = 0;
  const output = await runGNewsPilot({
    apiKey: 'fake-key',
    now: new Date('2026-09-23T10:00:00Z'),
    queryPlan,
    concurrency: 1,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: true, status: 200, json: async () => ({ totalArticles: 0, articles: [] }) };
      return { ok: false, status: 429 };
    }
  });
  assert.equal(output.successfulQueries, 1);
  assert.equal(output.failedQueries, 1);
  assert.equal(output.coverageStatus, 'provider_checks_failed');
  assert.equal(output.failures[0].errorCode, 'gnews_rate_limited');
});
