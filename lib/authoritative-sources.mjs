import { createHash } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 12_000;
const HTML_ENTITY_RE = /&(?:amp|quot|#39|lt|gt|nbsp);/gi;

export class AuthoritativeSourceError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'AuthoritativeSourceError';
    this.code = code;
    this.detail = detail;
  }
}

export function normalizeWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(HTML_ENTITY_RE, ' ');
}

export function stripHtml(value = '') {
  return normalizeWhitespace(decodeHtml(String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')));
}

export function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || ''), base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function toIsoDate(value) {
  if (!value) return null;
  const raw = normalizeWhitespace(value);
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) return native.toISOString();

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = dmy;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const named = raw.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (named) {
    const [, day, monthName, year, hour = '0', minute = '0', second = '0'] = named;
    const month = new Date(`${monthName} 1, 2000 UTC`).getUTCMonth();
    const date = new Date(Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function validateSourceDefinition(source) {
  const required = ['id', 'name', 'authority', 'adapter', 'endpoint', 'jurisdiction', 'tier', 'rights', 'cadenceMinutes'];
  const missing = required.filter((key) => source?.[key] === undefined || source?.[key] === null || source?.[key] === '');
  if (missing.length) throw new AuthoritativeSourceError('invalid_source_definition', `${source?.id || 'unknown'} is missing: ${missing.join(', ')}`, { missing });
  if (Number(source.tier) !== 0) throw new AuthoritativeSourceError('invalid_source_tier', `${source.id} must be Tier 0.`);
  if (!String(source.rights).startsWith('public-')) throw new AuthoritativeSourceError('invalid_source_rights', `${source.id} must declare public metadata rights.`);
  const endpoint = new URL(source.endpoint);
  if (endpoint.protocol !== 'https:') throw new AuthoritativeSourceError('insecure_source_endpoint', `${source.id} must use HTTPS.`);
  return true;
}

export function validateSourceRegistry(registry) {
  if (!registry || !Array.isArray(registry.sources)) throw new AuthoritativeSourceError('invalid_registry', 'Authoritative source registry must contain a sources array.');
  const ids = new Set();
  for (const source of registry.sources) {
    validateSourceDefinition(source);
    if (ids.has(source.id)) throw new AuthoritativeSourceError('duplicate_source_id', `Duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
  return { sourceCount: registry.sources.length, activeSourceCount: registry.sources.filter((source) => source.active !== false).length };
}

function deterministicId(parts) {
  return createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

function record(source, input = {}) {
  const title = normalizeWhitespace(input.title || input.description || 'Untitled official disclosure');
  const publishedAt = toIsoDate(input.publishedAt);
  const url = absoluteUrl(input.url, source.endpoint) || source.endpoint;
  return {
    id: deterministicId([source.id, input.externalId, title, publishedAt, url]),
    sourceId: source.id,
    sourceName: source.name,
    authority: source.authority,
    adapter: source.adapter,
    tier: 0,
    jurisdiction: source.jurisdiction,
    rights: source.rights,
    entityHints: Array.isArray(input.entityHints) && input.entityHints.length ? input.entityHints : (source.entityIds || []),
    title,
    description: normalizeWhitespace(input.description || ''),
    url,
    publishedAt,
    filingType: input.filingType || null,
    category: input.category || null,
    externalId: input.externalId || null,
    attachmentUrl: absoluteUrl(input.attachmentUrl, source.endpoint),
    official: true
  };
}

export function parseSecSubmissions(payload, source) {
  validateSourceDefinition(source);
  const recent = payload?.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) throw new AuthoritativeSourceError('sec_payload_invalid', `${source.id} did not return SEC recent filings.`);
  const cik = String(payload.cik || source.identifiers?.cik || '').replace(/^0+/, '');
  return recent.accessionNumber.map((accessionNumber, index) => {
    const primaryDocument = recent.primaryDocument?.[index] || '';
    const accessionPath = String(accessionNumber || '').replaceAll('-', '');
    const filingUrl = cik && accessionPath && primaryDocument
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${primaryDocument}`
      : source.endpoint;
    const form = recent.form?.[index] || null;
    const description = recent.primaryDocDescription?.[index] || form || 'SEC filing';
    return record(source, {
      externalId: accessionNumber,
      title: `${payload.name || 'Novelis Inc.'} — ${description}`,
      description,
      publishedAt: recent.filingDate?.[index] || recent.acceptanceDateTime?.[index],
      filingType: form,
      category: 'SEC filing',
      url: filingUrl,
      attachmentUrl: filingUrl
    });
  }).filter((item) => item.publishedAt);
}

function nseRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

export function parseNseAnnouncements(payload, source) {
  validateSourceDefinition(source);
  const rows = nseRows(payload);
  return rows.map((item) => {
    const symbol = item.symbol || item.sm_name || item.scrip || '';
    const attachment = item.attchmntFile || item.attachment || item.fileName || '';
    const attachmentUrl = attachment.startsWith('http') ? attachment : `https://nsearchives.nseindia.com/corporate/${String(attachment).replace(/^\/+/, '')}`;
    return record(source, {
      externalId: item.seq_id || item.seqNo || item.id || `${symbol}-${item.an_dt || item.date}`,
      title: item.attchmntText || item.desc || item.subject || `${symbol} corporate announcement`,
      description: item.desc || item.details || item.attchmntText || '',
      publishedAt: item.an_dt || item.date || item.broadcastDateTime,
      filingType: item.category || item.type || null,
      category: 'NSE corporate announcement',
      url: attachmentUrl,
      attachmentUrl,
      entityHints: [symbol, ...(source.entityIds || [])]
    });
  }).filter((item) => item.publishedAt && item.title);
}

function bseRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['Table', 'table', 'data', 'Data']) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

export function parseBseAnnouncements(payload, source) {
  validateSourceDefinition(source);
  return bseRows(payload).map((item) => {
    const attachment = item.ATTACHMENTNAME || item.AttachmentName || item.attachment || '';
    const attachmentUrl = attachment.startsWith('http')
      ? attachment
      : `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${String(attachment).replace(/^\/+/, '')}`;
    const code = String(item.SCRIP_CD || item.SCRIPCODE || item.scripCode || '');
    return record(source, {
      externalId: item.NEWSID || item.NEWSSUBID || item.id || `${code}-${item.NEWS_DT || item.date}`,
      title: item.NEWSSUB || item.HEADLINE || item.subject || `${code} corporate announcement`,
      description: item.MORE || item.DETAILS || item.NEWSSUB || '',
      publishedAt: item.NEWS_DT || item.DT_TM || item.date,
      filingType: item.CATEGORYNAME || item.CATEGORY || null,
      category: 'BSE corporate announcement',
      url: attachmentUrl,
      attachmentUrl,
      entityHints: [code, item.SLONGNAME || item.LONG_NAME || '', ...(source.entityIds || [])].filter(Boolean)
    });
  }).filter((item) => item.publishedAt && item.title);
}

export function parseOfficialHtmlListing(html, source) {
  validateSourceDefinition(source);
  const text = String(html || '');
  const anchors = [...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set();
  const records = [];
  for (const match of anchors) {
    const href = absoluteUrl(match[1], source.endpoint);
    const title = stripHtml(match[2]);
    if (!href || title.length < 12) continue;
    if (/^(home|next|previous|view more|read more|click here|download)$/i.test(title)) continue;
    const surrounding = text.slice(Math.max(0, match.index - 180), Math.min(text.length, match.index + match[0].length + 180));
    const dateMatch = surrounding.match(/\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{1,2}[- ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ]\d{4}|\d{4}-\d{2}-\d{2})\b/i);
    const publishedAt = toIsoDate(dateMatch?.[0]);
    const key = `${title.toLowerCase()}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(record(source, {
      externalId: href,
      title,
      description: '',
      publishedAt,
      category: 'Official regulator publication',
      url: href
    }));
  }
  return records;
}

export function filterRecordsByWindow(records, { start, end } = {}) {
  const startMs = start ? new Date(start).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY;
  return records.filter((item) => {
    if (!item.publishedAt) return true;
    const time = new Date(item.publishedAt).getTime();
    return Number.isFinite(time) && time >= startMs && time <= endMs;
  });
}

function yyyymmdd(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthoritativeSourceError('invalid_window', `Invalid date: ${value}`);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function nseUrl(source, symbol) {
  const url = new URL(source.endpoint);
  url.searchParams.set('index', 'equities');
  url.searchParams.set('symbol', symbol);
  return url.href;
}

function bseUrl(source, code, window) {
  const url = new URL(source.endpoint);
  url.searchParams.set('pageno', '1');
  url.searchParams.set('strCat', '-1');
  url.searchParams.set('strPrevDate', yyyymmdd(window.start));
  url.searchParams.set('strScrip', code);
  url.searchParams.set('strSearch', 'P');
  url.searchParams.set('strToDate', yyyymmdd(window.end));
  url.searchParams.set('strType', 'C');
  url.searchParams.set('subcategory', '-1');
  return url.href;
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: 'follow', ...options, signal: controller.signal });
    if (!response.ok) throw new AuthoritativeSourceError('source_http_error', `${url} returned HTTP ${response.status}.`, { status: response.status, url });
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') throw new AuthoritativeSourceError('source_timeout', `${url} timed out after ${timeoutMs}ms.`, { url, timeoutMs });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function commonHeaders(source) {
  return {
    Accept: source.adapter === 'official-html-listing' ? 'text/html,application/xhtml+xml' : 'application/json,text/plain,*/*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'User-Agent': process.env.AUTHORITATIVE_SOURCE_USER_AGENT || 'ABG-Pulse/1.0 (public-source monitor; abg-pulse@users.noreply.github.com)'
  };
}

async function fetchNse(source, window, fetchImpl) {
  const bootstrap = await fetchWithTimeout(fetchImpl, source.bootstrapUrl || 'https://www.nseindia.com', { headers: { ...commonHeaders(source), Referer: 'https://www.nseindia.com/' } });
  const cookies = typeof bootstrap.headers.getSetCookie === 'function'
    ? bootstrap.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
    : (bootstrap.headers.get('set-cookie') || '').split(',').map((cookie) => cookie.split(';')[0]).join('; ');
  const symbols = source.identifiers?.symbols || [];
  const output = [];
  for (const symbol of symbols) {
    const response = await fetchWithTimeout(fetchImpl, nseUrl(source, symbol), {
      headers: { ...commonHeaders(source), Referer: source.bootstrapUrl || 'https://www.nseindia.com/', Cookie: cookies }
    });
    output.push(...parseNseAnnouncements(await response.json(), source));
  }
  return filterRecordsByWindow(output, window);
}

async function fetchBse(source, window, fetchImpl) {
  const output = [];
  for (const code of source.identifiers?.scripCodes || []) {
    const response = await fetchWithTimeout(fetchImpl, bseUrl(source, code, window), {
      headers: { ...commonHeaders(source), Referer: 'https://www.bseindia.com/' }
    });
    output.push(...parseBseAnnouncements(await response.json(), source));
  }
  return filterRecordsByWindow(output, window);
}

export async function fetchAuthoritativeSource(source, { start, end, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  validateSourceDefinition(source);
  const window = { start, end };
  const startedAt = new Date();
  let records;
  if (source.adapter === 'sec-submissions') {
    const response = await fetchWithTimeout(fetchImpl, source.endpoint, { headers: commonHeaders(source) }, timeoutMs);
    records = filterRecordsByWindow(parseSecSubmissions(await response.json(), source), window);
  } else if (source.adapter === 'nse-announcements') {
    records = await fetchNse(source, window, fetchImpl);
  } else if (source.adapter === 'bse-announcements') {
    records = await fetchBse(source, window, fetchImpl);
  } else if (source.adapter === 'official-html-listing') {
    const response = await fetchWithTimeout(fetchImpl, source.endpoint, { headers: commonHeaders(source) }, timeoutMs);
    records = filterRecordsByWindow(parseOfficialHtmlListing(await response.text(), source), window);
  } else {
    throw new AuthoritativeSourceError('unsupported_adapter', `Unsupported adapter: ${source.adapter}`);
  }
  return {
    sourceId: source.id,
    sourceName: source.name,
    authority: source.authority,
    adapter: source.adapter,
    endpoint: source.endpoint,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    recordCount: records.length,
    ok: true,
    records
  };
}

export async function fetchAuthoritativeWave(registry, { start, end, fetchImpl = fetch, sourceIds = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  validateSourceRegistry(registry);
  const selected = registry.sources.filter((source) => source.active !== false && (!sourceIds || sourceIds.includes(source.id)));
  const results = [];
  for (const source of selected) {
    try {
      results.push(await fetchAuthoritativeSource(source, { start, end, fetchImpl, timeoutMs }));
    } catch (error) {
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        authority: source.authority,
        adapter: source.adapter,
        endpoint: source.endpoint,
        checkedAt: new Date().toISOString(),
        durationMs: null,
        recordCount: 0,
        ok: false,
        error: {
          code: error?.code || 'source_fetch_failed',
          message: String(error?.message || error),
          detail: error?.detail || null
        },
        records: []
      });
    }
  }
  const records = results.flatMap((result) => result.records || []);
  return {
    generatedAt: new Date().toISOString(),
    window: { start, end },
    sourceCount: selected.length,
    successfulSourceCount: results.filter((result) => result.ok).length,
    failedSourceCount: results.filter((result) => !result.ok).length,
    recordCount: records.length,
    sourceChecks: results.map(({ records: _records, ...check }) => check),
    records
  };
}
