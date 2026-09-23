import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GNEWS_QUERY_MAX_CHARS,
  GNEWS_ESSENTIAL_MAX_ARTICLES,
  GNewsError,
  buildGNewsUrl,
  fetchGNewsQuery,
  mapGNewsArticle,
  validateGNewsQueryPlan
} from '../lib/gnews.mjs';
import { assessArticleSignal, formatLiveArticle } from '../core.mjs';

const plan = JSON.parse(readFileSync(new URL('../config/gnews-query-plan.json', import.meta.url), 'utf8'));
const window = { start: '2026-09-22T00:00:00.000Z', end: '2026-09-23T00:00:00.000Z' };

test('GNews pilot query plan is explicit, unique and within provider query length', () => {
  validateGNewsQueryPlan(plan);
  assert.ok(plan.queries.length >= 20);
  assert.ok(plan.queries.every((item) => item.query.length <= GNEWS_QUERY_MAX_CHARS));
  assert.equal(new Set(plan.queries.map((item) => item.id)).size, plan.queries.length);
});

test('GNews request keeps the credential out of the URL and preserves the exact time window', () => {
  const url = buildGNewsUrl(plan.queries[0], window);
  assert.equal(url.origin, 'https://gnews.io');
  assert.equal(url.pathname, '/api/v4/search');
  assert.equal(url.searchParams.get('from'), window.start);
  assert.equal(url.searchParams.get('to'), window.end);
  assert.equal(url.searchParams.get('max'), String(GNEWS_ESSENTIAL_MAX_ARTICLES));
  assert.equal(url.searchParams.get('sortby'), 'publishedAt');
  assert.equal(url.searchParams.get('in'), 'title,description,content');
  assert.equal(url.searchParams.has('apikey'), false);
});

test('GNews fetch authenticates by header, maps articles and exposes pagination saturation', async () => {
  let seen;
  const result = await fetchGNewsQuery(plan.queries[3], {
    apiKey: 'test-secret-not-real',
    window,
    fetchImpl: async (url, options) => {
      seen = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          totalArticles: 31,
          articles: [{
            title: 'UltraTech Cement announces capacity expansion',
            description: 'UltraTech Cement announced a capacity expansion.',
            content: 'Full article content supplied by the licensed provider.',
            url: 'https://publisher.example/ultratech-expansion',
            image: null,
            publishedAt: '2026-09-22T08:00:00Z',
            lang: 'en',
            source: { name: 'Example Business News', url: 'https://publisher.example', country: 'in' }
          }]
        })
      };
    }
  });
  assert.equal(new URL(seen.url).searchParams.has('apikey'), false);
  assert.equal(seen.options.headers['X-Api-Key'], 'test-secret-not-real');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].provider, 'GNews');
  assert.equal(result.items[0].queryGroup, 'cement-building');
  assert.equal(result.items[0].domain, 'publisher.example');
  assert.equal(result.totalArticles, 31);
  assert.equal(result.saturated, true);
});

test('GNews keeps stories with nullable fields instead of silently losing coverage', () => {
  const item = mapGNewsArticle({
    title: 'Hindalco update',
    description: null,
    content: null,
    url: 'https://example.com/hindalco',
    publishedAt: '2026-09-22T09:00:00Z',
    lang: 'en',
    source: { name: 'Example', url: 'https://example.com', country: 'in' }
  }, { id: 'metals-aluminium', group: 'metals-aluminium' });
  assert.equal(item.description, '');
  assert.equal(item.content, '');
  assert.equal(item.sourceName, 'Example');
});

test('GNews fails closed when no credential is configured', async () => {
  await assert.rejects(
    () => fetchGNewsQuery(plan.queries[0], { apiKey: '', window, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    (error) => error instanceof GNewsError && error.code === 'gnews_not_configured'
  );
});

test('GNews distinguishes quota/auth style failures without leaking the key', async () => {
  await assert.rejects(
    () => fetchGNewsQuery(plan.queries[0], {
      apiKey: 'top-secret-key',
      window,
      fetchImpl: async () => ({ ok: false, status: 403 })
    }),
    (error) => error instanceof GNewsError
      && error.code === 'gnews_forbidden_or_quota'
      && !error.message.includes('top-secret-key')
  );
});

test('GNews Essential pilot refuses accidental over-page-size requests', () => {
  assert.throws(() => buildGNewsUrl(plan.queries[0], window, { max: 26 }), /Essential pilot/);
});

test('GNews full text survives provider mapping for bounded internal analysis', () => {
  const entities = JSON.parse(readFileSync(new URL('../data/entities.json', import.meta.url), 'utf8'));
  const sources = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));
  const mapped = mapGNewsArticle({
    title: 'UltraTech Cement update',
    description: null,
    content: 'UltraTech Cement announced a major capacity investment and commissioned a new plant.',
    url: 'https://publisher.example/ultratech-update',
    publishedAt: '2026-09-22T10:00:00Z',
    source: { name: 'Example Business News', url: 'https://publisher.example', country: 'in' }
  }, { id: 'cement-building', group: 'cement-building' });
  const formatted = formatLiveArticle(mapped);
  assert.match(formatted.content, /capacity investment/i);
  assert.equal(assessArticleSignal(formatted, entities, sources).includeAsNews, true);
});

test('scheduled GNews participation stays inside the Essential base-call budget', () => {
  const workflow = readFileSync(new URL('../.github/workflows/refresh-live-snapshot.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '7 \* \* \* \*'/);
  assert.match(workflow, /cron: '37 \* \* \* \*'/);
  assert.match(workflow, /GNEWS_API_KEY:.*secrets\.GNEWS_API_KEY/);
  assert.match(workflow, /github\.event\.schedule == '7 \* \* \* \*'/);
  assert.ok(plan.queries.length * 24 < 1000);
});
