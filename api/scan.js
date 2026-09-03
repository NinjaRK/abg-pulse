import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  formatLiveArticle,
  matchEntities,
  clusterArticles,
  deriveLiveEvent,
  dedupeEvents,
  sortEvents,
  isFreshArticle,
  normalizeText,
  assessArticleSignal,
  attachRelatedPublicConversation
} from '../core.mjs';
import { fetchOfficialSource, auditOfficialRegistry } from '../official.mjs';

// Literal asset paths ensure Vercel includes every governed JSON file in the
// serverless function bundle.
const entities = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entities.json', import.meta.url)), 'utf8'));
const sources = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-registry.json', import.meta.url)), 'utf8'));
const queryGroups = JSON.parse(readFileSync(fileURLToPath(new URL('../config/queries.json', import.meta.url)), 'utf8'));
const officialSources = JSON.parse(readFileSync(fileURLToPath(new URL('../config/official-sources.json', import.meta.url)), 'utf8'));
const entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));

const GOOGLE_EDITIONS = {
  indiaEnglish: { id: 'IN-en', hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  indiaHindi: { id: 'IN-hi', hl: 'hi', gl: 'IN', ceid: 'IN:hi' },
  globalEnglish: { id: 'US-en', hl: 'en-US', gl: 'US', ceid: 'US:en' }
};

function send(res, status, body, cache = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
  res.end(JSON.stringify(body));
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ').trim();
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function attr(xml, name) {
  const match = String(xml).match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function validDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function gdeltDateParameter(value) {
  const date = validDate(value);
  return date ? date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) : '';
}

function dateOnly(value) {
  const date = validDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function requestedWindow(req, now = new Date()) {
  const parsed = new URL(req.url || '/', `https://${req.headers?.host || 'abg-pulse.local'}`);
  const end = validDate(parsed.searchParams.get('end')) || now;
  const requestedStart = validDate(parsed.searchParams.get('start')) || new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const maximumSpan = 30 * 24 * 60 * 60 * 1000;
  const start = end.getTime() - requestedStart.getTime() > maximumSpan ? new Date(end.getTime() - maximumSpan) : requestedStart;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    requestedStart: requestedStart.toISOString(),
    capped: start.getTime() !== requestedStart.getTime()
  };
}

function articleInWindow(article, window) {
  const published = validDate(article.publishedAt);
  return Boolean(published && published >= new Date(window.start) && published <= new Date(window.end));
}

async function runWithTimeout(run, milliseconds = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGdelt(group, signal, window) {
  const params = new URLSearchParams({
    query: group.query,
    mode: 'artlist',
    maxrecords: '125',
    format: 'json',
    sort: 'datedesc',
    startdatetime: gdeltDateParameter(window.start),
    enddatetime: gdeltDateParameter(window.end)
  });
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'ABGPulse/4.0 corporate-intelligence' }
  });
  if (!response.ok) throw new Error(`GDELT ${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload?.articles) ? payload.articles : []).map((article) => ({
    ...article,
    description: article?.context || article?.description || '',
    queryGroup: group.id,
    provider: 'GDELT DOC 2.0',
    channel: 'news'
  }));
}

function parseGoogleRss(xml, group, edition) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const sourceTag = item.match(/<source(?:\s+url="([^"]+)")?[^>]*>([\s\S]*?)<\/source>/i);
    const sourceUrl = sourceTag?.[1] || '';
    const sourceName = decodeXml(sourceTag?.[2] || 'Google News');
    let title = tag(item, 'title');
    if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3));
    let domain = 'news.google.com';
    try { if (sourceUrl) domain = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { /* keep fallback */ }
    return {
      title,
      description: tag(item, 'description'),
      url: tag(item, 'link'),
      domain,
      publishedAt: tag(item, 'pubDate'),
      sourceName,
      provider: `Google News ${edition.id}`,
      language: edition.hl,
      channel: 'news',
      queryGroup: group.id
    };
  }).filter((item) => item.title && item.url && item.publishedAt);
}

async function fetchGoogleNews(group, edition, signal, window) {
  const after = dateOnly(window.start);
  const before = dateOnly(new Date(new Date(window.end).getTime() + 24 * 60 * 60 * 1000));
  const params = new URLSearchParams({
    q: `${group.query} after:${after} before:${before}`,
    hl: edition.hl,
    gl: edition.gl,
    ceid: edition.ceid
  });
  const response = await fetch(`https://news.google.com/rss/search?${params}`, {
    signal,
    headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'ABGPulse/4.0 public-news-discovery' }
  });
  if (!response.ok) throw new Error(`Google News ${edition.id} ${response.status}`);
  return parseGoogleRss(await response.text(), group, edition);
}

function parseRedditAtom(xml, group) {
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  return entries.map((entry) => {
    const linkTag = entry.match(/<link\b[^>]*href=["'][^"']+["'][^>]*\/?\s*>/i)?.[0] || '';
    return {
      title: tag(entry, 'title'),
      description: tag(entry, 'content') || tag(entry, 'summary'),
      url: attr(linkTag, 'href'),
      domain: 'reddit.com',
      publishedAt: tag(entry, 'updated') || tag(entry, 'published'),
      sourceName: tag(entry, 'name') ? `Reddit · ${tag(entry, 'name')}` : 'Reddit public post',
      provider: 'Reddit public RSS',
      channel: 'public-conversation',
      language: 'English',
      queryGroup: group.id
    };
  }).filter((item) => item.title && item.url && item.publishedAt);
}

async function fetchReddit(group, signal) {
  const params = new URLSearchParams({ q: group.publicQuery || group.label, sort: 'new', t: 'month' });
  const response = await fetch(`https://www.reddit.com/search.rss?${params}`, {
    signal,
    headers: { Accept: 'application/atom+xml, application/xml;q=0.9', 'User-Agent': 'ABGPulse/4.0 public-sentiment-observer' }
  });
  if (!response.ok) throw new Error(`Reddit RSS ${response.status}`);
  return parseRedditAtom(await response.text(), group);
}

function buildJobs(window) {
  const jobs = [];
  for (const group of queryGroups) {
    jobs.push({ provider: 'GDELT', id: `${group.id}:gdelt`, run: (signal) => fetchGdelt(group, signal, window) });
    jobs.push({ provider: 'Google News', id: `${group.id}:IN-en`, run: (signal) => fetchGoogleNews(group, GOOGLE_EDITIONS.indiaEnglish, signal, window) });
    if (group.hindi) jobs.push({ provider: 'Google News', id: `${group.id}:IN-hi`, run: (signal) => fetchGoogleNews(group, GOOGLE_EDITIONS.indiaHindi, signal, window) });
    if (group.international) jobs.push({ provider: 'Google News', id: `${group.id}:US-en`, run: (signal) => fetchGoogleNews(group, GOOGLE_EDITIONS.globalEnglish, signal, window) });
    if (group.publicQuery) jobs.push({ provider: 'Open public conversation', id: `${group.id}:reddit`, run: (signal) => fetchReddit(group, signal) });
  }
  for (const source of officialSources) {
    jobs.push({ provider: source.registrySource ? 'Official registry' : 'Official source', id: source.id, run: (signal) => source.registrySource ? auditOfficialRegistry(source, entities, signal) : fetchOfficialSource(source, signal) });
  }
  return jobs;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const startedAt = new Date();
  const window = requestedWindow(req, startedAt);
  const jobs = buildJobs(window);
  try {
    const settled = await Promise.allSettled(jobs.map((job) => runWithTimeout(job.run, job.provider === 'Official source' || job.provider === 'Official registry' ? 7000 : 9000)));
    const sourceChecks = settled.map((result, index) => {
      const value = result.status === 'fulfilled' ? result.value : null;
      const registryAudit = value && !Array.isArray(value) && value.kind === 'registry-audit' ? value : null;
      return {
        name: jobs[index].id,
        provider: jobs[index].provider,
        ok: result.status === 'fulfilled',
        status: result.status !== 'fulfilled' ? 'failed' : (registryAudit && !registryAudit.reconciled ? 'degraded' : 'healthy'),
        itemCount: Array.isArray(value) ? value.length : (registryAudit?.matchedCount || 0),
        registryAudit,
        error: result.status === 'rejected' ? String(result.reason?.message || result.reason) : ''
      };
    });
    const errors = sourceChecks.filter((check) => !check.ok).map((check) => ({ provider: check.provider, query: check.name, error: check.error }));
    const raw = settled.flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);

    const unique = new Map();
    for (const article of raw) {
      if (!article?.url || !article?.title) continue;
      const key = article.url.replace(/[?#].*$/, '') || `${normalizeText(article.title)}-${article.publishedAt || ''}`;
      if (!unique.has(key)) unique.set(key, article);
    }

    const formatted = [...unique.values()].map(formatLiveArticle);
    const fresh = formatted.filter((article) => articleInWindow(article, window) && isFreshArticle(article, {
      now: new Date(window.end),
      maxHours: Math.max(24, (new Date(window.end) - new Date(window.start)) / 36e5 + 1),
      futureToleranceHours: 12
    }));
    const assessed = fresh.map((article) => ({ article, signal: assessArticleSignal(article, entities, sources) }));
    const relevantNews = assessed.filter(({ signal }) => signal.includeAsNews).map(({ article }) => article);
    const publicSentimentCandidates = assessed.filter(({ signal }) => signal.includeAsSentiment).map(({ article }) => article);
    const rejectionReasons = assessed
      .filter(({ signal }) => !signal.includeAsNews && !signal.includeAsSentiment)
      .reduce((counts, { signal }) => {
        counts[signal.reason] = (counts[signal.reason] || 0) + 1;
        return counts;
      }, {});

    const mediaClusters = clusterArticles(relevantNews, entities);
    const clusters = attachRelatedPublicConversation(mediaClusters, publicSentimentCandidates, entities);
    const events = sortEvents(dedupeEvents(
      clusters
        .map((cluster) => deriveLiveEvent(cluster, { entities, sources, now: startedAt }))
        .filter(Boolean)
        .filter((event) => (event.intelligence?.materiality || 0) >= 35)
    )).slice(0, 60);

    const publicConversationItems = publicSentimentCandidates.length;
    const publicConversationChecks = sourceChecks.filter((check) => check.provider === 'Open public conversation');
    const providerSummary = [...new Set(jobs.map((job) => job.provider))];
    const registryAudits = sourceChecks.map((check) => check.registryAudit).filter(Boolean);

    return send(res, 200, {
      events,
      entityUniverse,
      meta: {
        scannedAt: new Date().toISOString(),
        providers: providerSummary,
        serviceVersion: '5.2.0',
        queryCount: jobs.length,
        officialSourceCount: officialSources.length,
        registryAudits,
        registryReconciled: registryAudits.length === 2 && registryAudits.every((audit) => audit.reconciled),
        successfulQueries: sourceChecks.filter((check) => check.ok).length,
        sourceChecks,
        rawArticleCount: raw.length,
        freshArticleCount: fresh.length,
        articleCount: relevantNews.length,
        rejectedArticleCount: assessed.length - relevantNews.length - publicSentimentCandidates.length,
        rejectionReasons,
        eventCount: events.length,
        publicConversationItems,
        publicConversationChecks: publicConversationChecks.length,
        publicConversationChecksSucceeded: publicConversationChecks.filter((check) => check.ok).length,
        sentimentCoverage: {
          media: 'Google News, GDELT and official published-source language',
          openPublic: 'Accessible Reddit public-search RSS where available; samples inform sentiment only and cannot create news events.',
          closedSocial: 'X, LinkedIn, Instagram and platform-level comments require authorised or licensed data access and are not represented unless connected.'
        },
        errors,
        windowStart: window.start,
        windowEnd: window.end,
        requestedWindowStart: window.requestedStart,
        windowCapped: window.capped
      }
    }, true);
  } catch (error) {
    return send(res, 502, {
      error: 'live_scan_failed',
      message: String(error?.message || error),
      events: [],
      entityUniverse,
      meta: {
        scannedAt: new Date().toISOString(),
        serviceVersion: '5.2.0',
        queryCount: jobs.length,
        successfulQueries: 0,
        sourceChecks: [],
        errors: [{ provider: 'scan', query: 'all', error: String(error?.message || error) }],
        windowStart: window.start,
        windowEnd: window.end
      }
    });
  }
}
