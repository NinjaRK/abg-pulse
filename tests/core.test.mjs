import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeText,
  jaccardSimilarity,
  matchEntities,
  clusterArticles,
  mediaTone,
  materialityScore,
  certaintyScore,
  momentumScore,
  predictImportance,
  classifyBucket,
  narrativeDriftScore,
  formatLiveArticle,
  deriveLiveEvent,
  dedupeEvents,
  sortEvents,
  articleAgeHours,
  isFreshArticle,
  sourceTier,
  resolvePeriodWindow,
  previousPeriodWindow,
  eventOccursInWindow,
  filterEventsByWindow,
  observedPublicSentiment,
  assessArticleSignal,
  attachRelatedPublicConversation
} from '../core.mjs';

const entities = JSON.parse(readFileSync(new URL('../data/entities.json', import.meta.url)));
const sources = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url)));

test('normalizeText removes markup-like punctuation and normalises case', () => {
  assert.equal(normalizeText('  Aditya  BÍRLA &amp; Group!  '), 'aditya birla and group');
});

test('title similarity recognises syndicated rewrites', () => {
  const similarity = jaccardSimilarity(
    'Hindalco commissions India first superfine PPT ATH plant',
    'Hindalco opens India’s first superfine precipitated ATH facility'
  );
  assert.ok(similarity >= 0.45, `similarity was ${similarity}`);
});

test('entity resolution maps aliases to canonical ABG entities', () => {
  const matches = matchEntities('Kumar Mangalam Birla speaks at the Vodafone Idea AGM', entities);
  const ids = new Set(matches.map((match) => match.id));
  assert.ok(ids.has('kmb'));
  assert.ok(ids.has('vi'));
});

test('short ambiguous aliases are not blindly matched', () => {
  const matches = matchEntities('VI is a common Roman numeral', entities);
  assert.equal(matches.some((match) => match.id === 'vi'), false);
});

test('source registry gives official domains the strongest tier', () => {
  assert.equal(sourceTier('hindalco.com', sources), 0);
  assert.equal(sourceTier('reuters.com', sources), 1);
});

test('article clustering collapses same-event coverage', () => {
  const articles = [
    { title: 'Vodafone Idea plans 5G expansion to 450 cities', url: 'https://a.example/1', publishedAt: '2026-08-28T10:00:00Z' },
    { title: 'Vi targets 450 cities as 5G rollout accelerates', url: 'https://b.example/2', publishedAt: '2026-08-28T09:00:00Z' },
    { title: 'Hindalco commissions specialty alumina plant', url: 'https://c.example/3', publishedAt: '2026-08-28T08:00:00Z' }
  ];
  const clusters = clusterArticles(articles, entities);
  assert.equal(clusters.length, 2);
});

test('media tone remains entity-neutral and bounded', () => {
  assert.ok(mediaTone('Strong growth and record profit') > 0);
  assert.ok(mediaTone('Fraud probe and regulatory penalty') < 0);
  assert.ok(mediaTone('neutral statement') <= 100);
});

test('materiality rises for promoter-level capital allocation', () => {
  const kmb = entities.find((entity) => entity.id === 'kmb');
  const score = materialityScore({
    text: 'Kumar Mangalam Birla confirms a billion-dollar acquisition and financing plan',
    entities: [kmb], sourceCount: 5, sourceTierValue: 0
  });
  assert.ok(score >= 85, `score was ${score}`);
});

test('certainty distinguishes official filing from exploratory report', () => {
  const official = certaintyScore({ text: 'Company disclosed the completed transaction in an exchange filing', sourceCount: 1, sourceTierValue: 0, official: true });
  const exploratory = certaintyScore({ text: 'Sources said the company may be exploring talks', sourceCount: 1, sourceTierValue: 3, official: false });
  assert.ok(official > exploratory + 25);
});

test('momentum rewards recency and source diversity', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  const score = momentumScore({ now, articles: [
    { url: 'https://one.example/a', domain: 'one.example', publishedAt: '2026-08-28T11:40:00Z' },
    { url: 'https://two.example/b', domain: 'two.example', publishedAt: '2026-08-28T10:40:00Z' },
    { url: 'https://three.example/c', domain: 'three.example', publishedAt: '2026-08-28T09:40:00Z' }
  ] });
  assert.ok(score >= 60, `score was ${score}`);
});

test('importance prediction is probabilistic and ordered by horizon', () => {
  const prediction = predictImportance({ materiality: 88, momentum: 79, certainty: 70, sourceCount: 8, seniority: 4, narrativeRisk: 65 });
  assert.ok(prediction.p6 <= prediction.p72);
  assert.ok(prediction.p24 >= 60);
  assert.ok(['PREPARE', 'ACT NOW'].includes(prediction.posture));
});

test('bucket classifier separates Must Know, Watch and Other', () => {
  assert.equal(classifyBucket({ materiality: 90, certainty: 82, momentum: 40, p24: 70 }), 'must');
  assert.equal(classifyBucket({ materiality: 60, certainty: 45, momentum: 55, p24: 58 }), 'watch');
  assert.equal(classifyBucket({ materiality: 24, certainty: 75, momentum: 18, p24: 20 }), 'other');
});

test('narrative drift detects personality-led ownership simplification', () => {
  const matches = matchEntities('Ananya Birla bought RCB', entities);
  const result = narrativeDriftScore({
    headline: 'Ananya Birla bought RCB',
    officialFrame: 'An ABG-led consortium acquired RCB and Aryaman Vikram Birla was named chairman',
    entityMatches: matches,
    sourceCount: 12
  });
  assert.ok(result.score >= 65, `score was ${result.score}`);
  assert.equal(result.risk, 'HIGH');
});

test('GDELT article format produces safe canonical metadata', () => {
  const article = formatLiveArticle({ title: 'Grasim update', url: 'https://example.com/story', seendate: '20260828123000', domain: 'example.com' });
  assert.equal(article.domain, 'example.com');
  assert.equal(article.publishedAt, '2026-08-28T12:30:00.000Z');
});

test('live event derivation keeps headline-only discovery visibly labelled', () => {
  const cluster = [
    { title: 'Hindalco announces new specialty alumina capacity', url: 'https://hindalco.com/story', domain: 'hindalco.com', publishedAt: '2026-08-28T10:00:00Z' },
    { title: 'Hindalco expands specialty alumina capacity', url: 'https://reuters.com/story', domain: 'reuters.com', publishedAt: '2026-08-28T10:30:00Z' }
  ];
  const event = deriveLiveEvent(cluster, { entities, sources, now: new Date('2026-08-28T12:00:00Z') });
  assert.ok(event.flags.includes('headline-derived'));
  assert.ok(event.entityIds.includes('hindalco'));
  assert.equal(event.status, 'confirmed');
  assert.equal(event.sources.length, 2);
});

test('event deduplication and ordering are deterministic', () => {
  const input = [
    { id: 'a', bucket: 'other', headline: 'A', intelligence: { materiality: 10 }, publishedAt: '2026-08-28T10:00:00Z' },
    { id: 'a', bucket: 'must', headline: 'duplicate', intelligence: { materiality: 90 }, publishedAt: '2026-08-28T11:00:00Z' },
    { id: 'b', bucket: 'must', headline: 'B', intelligence: { materiality: 80 }, publishedAt: '2026-08-28T09:00:00Z' }
  ];
  const output = sortEvents(dedupeEvents(input));
  assert.equal(output.length, 2);
  assert.equal(output[0].id, 'b');
});


test('freshness gate rejects stale and implausibly future articles', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  assert.equal(Math.round(articleAgeHours({ publishedAt: '2026-08-30T12:00:00Z' }, now)), 24);
  assert.equal(isFreshArticle({ publishedAt: '2026-08-30T12:00:00Z' }, { now, maxHours: 48 }), true);
  assert.equal(isFreshArticle({ publishedAt: '2026-08-20T12:00:00Z' }, { now, maxHours: 96 }), false);
  assert.equal(isFreshArticle({ publishedAt: '2026-09-02T12:00:00Z' }, { now, futureToleranceHours: 12 }), false);
});


test('period resolver produces exact rolling and IST today windows', () => {
  const now = new Date('2026-08-31T15:30:00Z');
  const rolling = resolvePeriodWindow('24h', { now });
  assert.equal(rolling.start, '2026-08-30T15:30:00.000Z');
  assert.equal(rolling.end, '2026-08-31T15:30:00.000Z');

  const today = resolvePeriodWindow('today', { now, timezoneOffsetMinutes: 330 });
  assert.equal(today.start, '2026-08-30T18:30:00.000Z');
  assert.equal(today.end, '2026-08-31T15:30:00.000Z');
});

test('since-last-visit falls back safely and custom windows normalise direction', () => {
  const now = new Date('2026-08-31T15:30:00Z');
  const since = resolvePeriodWindow('since-last-visit', { now, lastOpened: '2026-08-31T10:00:00Z' });
  assert.equal(since.start, '2026-08-31T10:00:00.000Z');
  const fallback = resolvePeriodWindow('since-last-visit', { now, lastOpened: 'not-a-date' });
  assert.equal(fallback.start, '2026-08-30T15:30:00.000Z');
  const custom = resolvePeriodWindow('custom', { now, customStart: '2026-08-31T14:00:00Z', customEnd: '2026-08-31T12:00:00Z' });
  assert.equal(custom.start, '2026-08-31T12:00:00.000Z');
  assert.equal(custom.end, '2026-08-31T14:00:00.000Z');
});

test('event period filter includes first publication or material update', () => {
  const window = resolvePeriodWindow('24h', { now: new Date('2026-08-31T15:30:00Z') });
  const events = [
    { id: 'published', publishedAt: '2026-08-31T09:00:00Z', updatedAt: '2026-08-31T09:00:00Z' },
    { id: 'updated', publishedAt: '2026-08-20T09:00:00Z', updatedAt: '2026-08-31T10:00:00Z' },
    { id: 'old', publishedAt: '2026-08-20T09:00:00Z', updatedAt: '2026-08-21T10:00:00Z' }
  ];
  assert.equal(eventOccursInWindow(events[0], window), true);
  assert.equal(eventOccursInWindow(events[1], window), true);
  assert.deepEqual(filterEventsByWindow(events, window).map((event) => event.id), ['published', 'updated']);
});

test('previous period is contiguous and equal in duration', () => {
  const current = resolvePeriodWindow('6h', { now: new Date('2026-08-31T15:30:00Z') });
  const previous = previousPeriodWindow(current);
  assert.equal(previous.end, current.start);
  assert.equal(previous.durationMs, current.durationMs);
  assert.equal(previous.start, '2026-08-31T03:30:00.000Z');
});


test('stakeholder names alone do not create an ABG entity match', () => {
  const matches = matchEntities('SEBI publishes a general market consultation paper', entities);
  assert.equal(matches.some((match) => match.type === 'stakeholder'), false);
});

test('ambiguous leadership names require ABG context', () => {
  const unrelated = matchEntities('Ashish Dikshit spoke at an unrelated community event', entities);
  assert.equal(unrelated.some((match) => match.id === 'ashish-dikshit'), false);
  const related = matchEntities('ABFRL managing director Ashish Dikshit addressed shareholders', entities);
  assert.equal(related.some((match) => match.id === 'ashish-dikshit'), true);
});

test('observed public sentiment reports sample size and withholds unavailable scores', () => {
  const unavailable = observedPublicSentiment([{ title: 'ABG media report', channel: 'news' }]);
  assert.equal(unavailable.score, null);
  assert.equal(unavailable.confidence, 'unavailable');
  const observed = observedPublicSentiment([
    { title: 'Strong launch and customer win', description: 'positive growth', channel: 'public-conversation', provider: 'Reddit public RSS', engagement: 10 },
    { title: 'Useful and improved service', description: 'strong experience', channel: 'public-conversation', provider: 'Public forum', engagement: 4 }
  ]);
  assert.ok(observed.score > 0);
  assert.equal(observed.sampleSize, 2);
  assert.equal(observed.channelCount, 2);
});

test('routine stock advice is excluded even when it names an ABG company', () => {
  const signal = assessArticleSignal({
    title: 'UltraTech Cement stock to buy: brokerage gives target price',
    description: 'Analysts discuss the share price outlook.',
    domain: 'example.com',
    channel: 'news'
  }, entities, sources);
  assert.equal(signal.includeAsNews, false);
  assert.equal(signal.reason, 'routine_market_advice');
});

test('a non-official item cannot become news from a weak snippet-only entity mention', () => {
  const signal = assessArticleSignal({
    title: 'Five themes investors are discussing today',
    description: 'The roundup briefly mentions UltraTech Cement among many stocks.',
    domain: 'example.com',
    channel: 'news'
  }, entities, sources);
  assert.equal(signal.includeAsNews, false);
  assert.equal(signal.reason, 'entity_only_in_snippet');
});

test('official entity hints preserve a valid official development with a generic title', () => {
  const signal = assessArticleSignal({
    title: 'Quarterly results for the period ended 30 June 2026',
    description: 'The board approved the financial results.',
    domain: 'hindalco.com',
    channel: 'news',
    official: true,
    entityHints: ['hindalco']
  }, entities, sources);
  assert.equal(signal.includeAsNews, true);
  assert.equal(signal.reason, 'official');
  assert.ok(signal.entities.some((entity) => entity.id === 'hindalco'));
});

test('public questions cannot create news or observed sentiment samples', () => {
  const signal = assessArticleSignal({
    title: 'Should I buy Vodafone Idea shares now?',
    description: 'Anyone have thoughts?',
    domain: 'reddit.com',
    provider: 'Reddit public RSS',
    channel: 'public-conversation'
  }, entities, sources);
  assert.equal(signal.includeAsNews, false);
  assert.equal(signal.includeAsSentiment, false);
  assert.equal(signal.reason, 'public_question');
});

test('uncertainty alone no longer promotes a low-signal story to Watch', () => {
  assert.equal(classifyBucket({ materiality: 28, certainty: 25, momentum: 18, p24: 24 }), 'other');
});

test('public conversation cannot create a standalone event or inflate source count', () => {
  const publicOnly = [{
    title: 'Vodafone Idea customers discuss network expansion',
    description: 'Users debate the rollout.',
    url: 'https://reddit.com/r/india/1',
    domain: 'reddit.com',
    publishedAt: '2026-09-02T10:00:00Z',
    provider: 'Reddit public RSS',
    channel: 'public-conversation'
  }];
  assert.equal(deriveLiveEvent(publicOnly, { entities, sources, now: new Date('2026-09-02T12:00:00Z') }), null);

  const media = [{
    title: 'Vodafone Idea announces 5G expansion to 450 cities',
    description: 'The company disclosed the rollout plan.',
    url: 'https://reuters.com/vi-5g',
    domain: 'reuters.com',
    publishedAt: '2026-09-02T09:00:00Z',
    channel: 'news'
  }];
  const relatedPublic = [{
    title: 'Vodafone Idea 5G expansion to 450 cities draws customer reaction',
    description: 'Users discuss the announced rollout.',
    url: 'https://reddit.com/r/india/2',
    domain: 'reddit.com',
    publishedAt: '2026-09-02T10:00:00Z',
    provider: 'Reddit public RSS',
    channel: 'public-conversation'
  }];
  const [cluster] = attachRelatedPublicConversation([media], relatedPublic, entities);
  const event = deriveLiveEvent(cluster, { entities, sources, now: new Date('2026-09-02T12:00:00Z') });
  assert.equal(event.sourceCount, 1);
  assert.equal(event.updatedAt, '2026-09-02T09:00:00.000Z');
});
