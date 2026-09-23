const GNEWS_ENDPOINT = 'https://gnews.io/api/v4/search';

export const GNEWS_QUERY_MAX_CHARS = 200;
export const GNEWS_ESSENTIAL_MAX_ARTICLES = 25;

export class GNewsError extends Error {
  constructor(code, message, status = 502, detail = {}) {
    super(message);
    this.name = 'GNewsError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function validIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} must be a valid date.`);
  return date.toISOString();
}

function hostFrom(value = '') {
  try { return new URL(value).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

export function validateGNewsQueryPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('GNews query plan must be an object.');
  }
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.queries) || !plan.queries.length) {
    throw new TypeError('GNews query plan must use schemaVersion 1 and contain queries.');
  }
  const ids = new Set();
  for (const item of plan.queries) {
    if (!item || typeof item !== 'object') throw new TypeError('Every GNews query must be an object.');
    const id = String(item.id || '').trim();
    const group = String(item.group || '').trim();
    const query = String(item.query || '').trim();
    if (!id || !group || !query) throw new TypeError('Every GNews query requires id, group and query.');
    if (ids.has(id)) throw new TypeError(`Duplicate GNews query id: ${id}`);
    ids.add(id);
    if (query.length > GNEWS_QUERY_MAX_CHARS) {
      throw new TypeError(`GNews query ${id} is ${query.length} characters; maximum is ${GNEWS_QUERY_MAX_CHARS}.`);
    }
    if (/apikey\s*=|x-api-key|bearer\s+/i.test(query)) {
      throw new TypeError(`GNews query ${id} appears to contain a credential.`);
    }
  }
  return plan;
}

export function buildGNewsUrl(spec, window, { page = 1, max = GNEWS_ESSENTIAL_MAX_ARTICLES } = {}) {
  const query = String(spec?.query || '').trim();
  if (!query) throw new TypeError('GNews query is required.');
  if (query.length > GNEWS_QUERY_MAX_CHARS) {
    throw new TypeError(`GNews query exceeds ${GNEWS_QUERY_MAX_CHARS} characters.`);
  }
  const start = validIso(window?.start, 'GNews window.start');
  const end = validIso(window?.end, 'GNews window.end');
  if (new Date(start) >= new Date(end)) throw new TypeError('GNews window must have start before end.');
  const pageNumber = Number(page);
  const maxNumber = Number(max);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new TypeError('GNews page must be a positive integer.');
  if (!Number.isInteger(maxNumber) || maxNumber < 1 || maxNumber > GNEWS_ESSENTIAL_MAX_ARTICLES) {
    throw new TypeError(`GNews max must be 1-${GNEWS_ESSENTIAL_MAX_ARTICLES} for the Essential pilot.`);
  }

  const url = new URL(GNEWS_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('max', String(maxNumber));
  url.searchParams.set('page', String(pageNumber));
  url.searchParams.set('from', start);
  url.searchParams.set('to', end);
  url.searchParams.set('sortby', 'publishedAt');
  url.searchParams.set('in', 'title,description,content');
  // Maximum-coverage pilot: do not silently discard a story merely because
  // a publisher omitted an image, description or extractable content field.
  url.searchParams.set('nullable', 'image,description,content');
  return url;
}

export function mapGNewsArticle(article = {}, spec = {}) {
  const url = String(article.url || '').trim();
  const title = String(article.title || '').trim();
  if (!url || !title) return null;
  const sourceUrl = String(article.source?.url || '').trim();
  const domain = hostFrom(sourceUrl) || hostFrom(url) || 'gnews.io';
  return {
    title,
    description: String(article.description || article.content || '').trim(),
    content: String(article.content || '').trim(),
    url,
    domain,
    publishedAt: article.publishedAt || '',
    sourceName: String(article.source?.name || domain),
    sourceCountry: String(article.source?.country || ''),
    language: String(article.lang || ''),
    provider: 'GNews',
    channel: 'news',
    queryGroup: String(spec.group || ''),
    queryId: String(spec.id || '')
  };
}

function errorCode(status) {
  if (status === 401) return 'gnews_unauthorised';
  if (status === 403) return 'gnews_forbidden_or_quota';
  if (status === 429) return 'gnews_rate_limited';
  if (status >= 500) return 'gnews_upstream_error';
  return 'gnews_request_failed';
}

export async function fetchGNewsQuery(
  spec,
  {
    apiKey,
    window,
    fetchImpl = globalThis.fetch,
    signal,
    page = 1,
    max = GNEWS_ESSENTIAL_MAX_ARTICLES
  } = {}
) {
  const key = String(apiKey || '').trim();
  if (!key) throw new GNewsError('gnews_not_configured', 'GNews API key is not configured.', 503);
  if (typeof fetchImpl !== 'function') throw new GNewsError('gnews_fetch_unavailable', 'No fetch implementation is available.', 500);

  const url = buildGNewsUrl(spec, window, { page, max });
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ABGPulse/6.1 news-intelligence-pilot',
        'X-Api-Key': key
      }
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new GNewsError('gnews_network_error', String(error?.message || error), 503);
  }

  if (!response?.ok) {
    const status = Number(response?.status || 502);
    throw new GNewsError(errorCode(status), `GNews request failed with HTTP ${status}.`, status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GNewsError('gnews_invalid_json', `GNews response was not valid JSON: ${error?.message || error}`, 502);
  }

  const rawArticles = Array.isArray(payload?.articles) ? payload.articles : [];
  const items = rawArticles.map((article) => mapGNewsArticle(article, spec)).filter(Boolean);
  const totalArticles = Number.isFinite(Number(payload?.totalArticles)) ? Number(payload.totalArticles) : items.length;
  return {
    items,
    totalArticles,
    page: Number(page),
    max: Number(max),
    saturated: totalArticles > Number(page) * Number(max),
    queryId: String(spec?.id || ''),
    group: String(spec?.group || '')
  };
}
