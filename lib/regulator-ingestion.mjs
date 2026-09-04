const DEFAULT_USER_AGENT = 'ABG-Pulse/6.2 contact https://github.com/NinjaRK/abg-pulse';

function decode(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function clean(value = '', max = 800) {
  return decode(String(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parseDate(value = '') {
  const text = clean(value, 300);
  const patterns = [
    /\b(\d{1,2})[-\s/.](Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[-\s,.]+(20\d{2})\b/i,
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
    /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/
  ];
  const months = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  let match = text.match(patterns[0]);
  if (match) return new Date(Date.UTC(Number(match[3]), months[match[2].toLowerCase()], Number(match[1])));
  match = text.match(patterns[1]);
  if (match) return new Date(Date.UTC(Number(match[3]), months[match[1].toLowerCase()], Number(match[2])));
  match = text.match(patterns[2]);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  match = text.match(patterns[3]);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return null;
}

function absolute(base, href = '') {
  const raw = decode(href).trim();
  if (!raw || /^javascript:|^mailto:|^tel:/i.test(raw) || raw === '#') return null;
  try { return new URL(raw, base).toString(); }
  catch { return null; }
}

function inWindow(date, window) {
  if (!date) return false;
  const start = new Date(window.start);
  const end = new Date(window.end);
  return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && date >= start && date <= end;
}

function likelyPublication(title, url) {
  const text = `${title} ${url}`.toLowerCase();
  if (title.length < 8) return false;
  if (/^(home|about|contact|login|skip|search|read more|view all|next|previous)$/i.test(title)) return false;
  if (/facebook|twitter|linkedin|youtube|instagram|whatsapp|sitemap|privacy|terms|accessibility/i.test(text)) return false;
  return /press|release|order|ruling|circular|notification|announcement|decision|penalty|approval|merger|combination|direction|advisory|notice|speech|statement|publication|pdf|document|download|attachment|news/i.test(text) || /\b20\d{2}\b/.test(text);
}

function challengePage(html = '') {
  const text = clean(html, 1000).toLowerCase();
  return /access denied|captcha|cloudflare|verify you are human|request blocked|enable javascript and cookies|bot detection|temporarily unavailable/.test(text);
}

function extractAnchors(html, source) {
  const anchors = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const url = absolute(source.url, match[3]);
    const title = clean(match[5], 320);
    if (!url || !title) continue;
    const before = html.slice(Math.max(0, match.index - 420), match.index);
    const after = html.slice(pattern.lastIndex, Math.min(html.length, pattern.lastIndex + 420));
    const context = clean(`${before} ${match[5]} ${after}`, 1000);
    const published = parseDate(context) || parseDate(url);
    if (!likelyPublication(title, url)) continue;
    anchors.push({ title, url, context, publishedAt: published?.toISOString() || null });
  }
  return anchors;
}

function dedupe(items = []) {
  const map = new Map();
  for (const item of items) {
    const key = item.url.replace(/[#?].*$/, '').toLowerCase();
    const existing = map.get(key);
    if (!existing || (!existing.publishedAt && item.publishedAt)) map.set(key, item);
  }
  return [...map.values()];
}

export function parseRegulatorListing(html, source, window) {
  if (challengePage(html)) throw new Error(`${source.id} access challenge detected`);
  const anchors = extractAnchors(html, source);
  if (!anchors.length) throw new Error(`${source.id} parser found no publication links`);
  const dated = anchors.filter((item) => item.publishedAt);
  if (!dated.length) throw new Error(`${source.id} parser found no dated publication links`);
  return dedupe(dated)
    .filter((item) => inWindow(new Date(item.publishedAt), window))
    .slice(0, Math.max(1, Number(source.maxItems || 80)))
    .map((item, index) => ({
      id: `${source.id}-${Buffer.from(item.url).toString('base64url').slice(0, 22)}-${index + 1}`,
      title: item.title,
      description: `${source.authority} official publication. ${item.context}`.slice(0, 700),
      url: item.url,
      domain: new URL(item.url).hostname.replace(/^www\./, ''),
      publishedAt: item.publishedAt,
      sourceName: source.name,
      provider: `${source.authority} direct official feed`,
      channel: 'official-regulator',
      language: 'English',
      queryGroup: `tier0-regulator-${source.id}`,
      authority: source.authority,
      official: true,
      sourceTier: 'tier0',
      rightsStatus: source.rightsStatus || 'metadata-and-link'
    }));
}

async function fetchWithTimeout(fetchImpl, url, options = {}, milliseconds = 10000) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) forwardAbort();
    else parentSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('regulator_source_timeout')), milliseconds);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchRegulatorSource({ source, window, fetchImpl = fetch, signal }) {
  const response = await fetchWithTimeout(fetchImpl, source.url, {
    signal,
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9',
      'User-Agent': source.userAgent || DEFAULT_USER_AGENT,
      Referer: new URL(source.url).origin
    }
  }, Number(source.timeoutMs || 10000));
  if (!response.ok) throw new Error(`${source.id} HTTP ${response.status}`);
  const contentType = String(response.headers?.get?.('content-type') || '');
  if (contentType && !/html|xml|text/i.test(contentType)) throw new Error(`${source.id} unexpected content-type ${contentType}`);
  const html = await response.text();
  if (html.length < 500) throw new Error(`${source.id} response too small for a publication index`);
  return parseRegulatorListing(html, source, window);
}

export function validateRegulatorConfig(config = {}) {
  const errors = [];
  const sources = Array.isArray(config.sources) ? config.sources.filter((source) => source.enabled !== false) : [];
  const ids = new Set();
  for (const source of sources) {
    if (!source.id || ids.has(source.id)) errors.push(`Invalid or duplicate regulator source id: ${source.id || ''}`);
    ids.add(source.id);
    if (!/^https:\/\//.test(String(source.url || ''))) errors.push(`${source.id || 'unknown'} missing HTTPS URL`);
    if (!source.authority) errors.push(`${source.id || 'unknown'} missing authority`);
    if (String(source.tier || '').toLowerCase() !== 'tier0') errors.push(`${source.id || 'unknown'} must be Tier-0`);
    if (!source.rightsStatus) errors.push(`${source.id || 'unknown'} missing rights status`);
    if (!source.cadence) errors.push(`${source.id || 'unknown'} missing cadence`);
  }
  return { valid: sources.length > 0 && errors.length === 0, errors, sources: sources.length };
}

export function buildRegulatorJobs({ config = {}, window, fetchImpl = fetch } = {}) {
  const validation = validateRegulatorConfig(config);
  const jobs = (config.sources || [])
    .filter((source) => source.enabled !== false)
    .map((source) => ({
      provider: `${source.authority} direct official`,
      id: `tier0:regulator:${source.id}`,
      tier: 'tier0',
      authority: source.authority,
      rightsStatus: source.rightsStatus || 'metadata-and-link',
      emptyIsValid: true,
      schemaValidated: true,
      retryable: true,
      timeoutMs: Number(source.timeoutMs || 10000),
      run: (signal) => fetchRegulatorSource({ source, window, fetchImpl, signal })
    }));
  return { jobs, validation };
}

export function regulatorRegistryRecords(config = {}) {
  return (config.sources || [])
    .filter((source) => source.enabled !== false)
    .map((source) => ({
      id: `tier0-regulator-${source.id}`,
      name: source.name,
      type: 'regulator publication',
      kind: 'regulator publication',
      tier: 'tier0',
      direct: true,
      official: true,
      authoritative: true,
      rightsStatus: source.rightsStatus || 'metadata-and-link',
      cadence: source.cadence || 'on-demand',
      url: source.url,
      domain: new URL(source.url).hostname.replace(/^www\./, ''),
      authority: source.authority
    }));
}
