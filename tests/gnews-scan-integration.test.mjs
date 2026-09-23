import test from 'node:test';
import assert from 'node:assert/strict';
import { performLiveScan } from '../api/scan.js';

const window = {
  start: '2026-09-22T00:00:00.000Z',
  end: '2026-09-23T00:00:00.000Z',
  requestedStart: '2026-09-22T00:00:00.000Z',
  capped: false
};

test('live scan adds GNews only when configured, never exposes the key, and reports saturated queries', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GNEWS_API_KEY;
  const secret = 'integration-test-secret-not-real';
  let gnewsCalls = 0;
  const gnewsUrls = [];
  const gnewsHeaders = [];

  process.env.GNEWS_API_KEY = secret;
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.startsWith('https://gnews.io/api/v4/search')) {
      gnewsCalls += 1;
      const callNumber = gnewsCalls;
      gnewsUrls.push(value);
      gnewsHeaders.push(options.headers || {});
      return {
        ok: true,
        status: 200,
        json: async () => ({
          totalArticles: callNumber === 1 ? 26 : 0,
          articles: []
        })
      };
    }
    if (value.includes('api.gdeltproject.org')) {
      return { ok: true, status: 200, json: async () => ({ articles: [] }) };
    }
    if (value.includes('news.google.com/rss/search')) {
      return { ok: true, status: 200, text: async () => '<?xml version="1.0"?><rss><channel></channel></rss>' };
    }
    if (value.includes('reddit.com/search.rss')) {
      return { ok: true, status: 200, text: async () => '<?xml version="1.0"?><feed></feed>' };
    }
    return {
      ok: true,
      status: 200,
      url: value,
      text: async () => '<!doctype html><html><body><main><h1>Newsroom</h1></main></body></html>',
      headers: { get: () => 'text/html' }
    };
  };

  try {
    const payload = await performLiveScan({ window, startedAt: new Date(window.end) });
    assert.equal(payload.meta.gnews.enabled, true);
    assert.equal(gnewsCalls, payload.meta.gnews.planQueryCount);
    assert.equal(payload.meta.gnews.checksRun, payload.meta.gnews.planQueryCount);
    assert.equal(payload.meta.gnews.checksSucceeded, payload.meta.gnews.planQueryCount);
    assert.equal(payload.meta.gnews.saturatedQueries.length, 1);
    assert.ok(payload.meta.gnews.saturatedQueries[0].startsWith('gnews:'));
    assert.ok(payload.meta.sourceChecks.some((check) => check.provider === 'GNews' && check.status === 'degraded'));
    assert.ok(gnewsUrls.every((value) => !value.includes(secret) && !new URL(value).searchParams.has('apikey')));
    assert.ok(gnewsHeaders.every((headers) => headers['X-Api-Key'] === secret));
    assert.ok(!JSON.stringify(payload).includes(secret));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GNEWS_API_KEY;
    else process.env.GNEWS_API_KEY = previousKey;
  }
});
