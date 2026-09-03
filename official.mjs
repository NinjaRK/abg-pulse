import { domainFromUrl, parseGdeltDate, normalizeText } from './core.mjs';

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_PATTERNS = [
  new RegExp(`\\b(\\d{1,2})[\\s./-]+(${MONTHS})[\\s,./-]+(20\\d{2})\\b`, 'i'),
  new RegExp(`\\b(${MONTHS})[\\s]+(\\d{1,2})(?:st|nd|rd|th)?[,\\s]+(20\\d{2})\\b`, 'i'),
  /\b(20\d{2})-(\d{2})-(\d{2})\b/
];

const NOISE_TITLES = new Set([
  'read more', 'view all', 'learn more', 'press releases', 'media', 'news', 'investors', 'download', 'click here', 'home', 'contact us', 'share'
]);

export function decodeHtml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function stripTags(value = '') {
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export function parsePublishedDate(value = '', fallback = null) {
  const text = stripTags(value);
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = new Date(match[0].replace(/(\d)(st|nd|rd|th)/gi, '$1'));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const machine = text.match(/\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/);
  if (machine) {
    const parsed = parseGdeltDate(machine[0]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (!fallback) return null;
  return fallback instanceof Date ? fallback : new Date(fallback);
}


function localAnchorContext(html, startIndex, endIndex) {
  const text = String(html);
  const before = text.slice(0, startIndex);
  const after = text.slice(endIndex);
  const blockTags = 'article|li|tr|section|div|p';
  const closePattern = new RegExp(`</(?:${blockTags})\\s*>`, 'gi');
  let start = Math.max(0, startIndex - 220);
  let closeMatch;
  while ((closeMatch = closePattern.exec(before))) start = closeMatch.index + closeMatch[0].length;

  const endPattern = new RegExp(`</(?:${blockTags})\\s*>`, 'i');
  const nextClose = after.match(endPattern);
  const end = nextClose ? endIndex + nextClose.index + nextClose[0].length : Math.min(text.length, endIndex + 220);
  return text.slice(start, end);
}

function absoluteUrl(href, base) {
  try { return new URL(decodeHtml(href), base).href; } catch { return ''; }
}

function pathAllowed(url, source) {
  try {
    const parsed = new URL(url);
    if (source.domain && !(parsed.hostname === source.domain || parsed.hostname.endsWith(`.${source.domain}`))) return false;
    const path = parsed.pathname.replace(/\/+$/, '');
    const included = !source.include?.length || source.include.some((fragment) => path.includes(String(fragment).replace(/\/$/, '')));
    const excluded = source.exclude?.some((fragment) => {
      const raw = String(fragment);
      if (raw.endsWith('$')) return path === raw.slice(0, -1).replace(/\/$/, '');
      return path.includes(raw.replace(/\/$/, ''));
    });
    return included && !excluded;
  } catch { return false; }
}

export function extractOfficialItems(html = '', source = {}, now = new Date()) {
  const anchorPattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  const found = new Map();
  let match;
  while ((match = anchorPattern.exec(String(html)))) {
    const href = absoluteUrl(match[2], source.url);
    if (!href || !pathAllowed(href, source)) continue;
    const title = stripTags(match[4]).replace(/\s*[|·]\s*$/g, '').trim();
    const lower = title.toLowerCase();
    if (title.length < 18 || title.length > 240 || NOISE_TITLES.has(lower)) continue;
    if (/^(menu|search|previous|next|back|close|subscribe)$/i.test(title)) continue;
    const context = localAnchorContext(html, match.index, anchorPattern.lastIndex);
    const parsedDate = parsePublishedDate(context);
    if (!parsedDate) continue;
    const publishedAt = parsedDate.toISOString();
    const key = href.replace(/[?#].*$/, '');
    if (!found.has(key)) {
      found.set(key, {
        title,
        url: key,
        domain: source.domain || domainFromUrl(key),
        publishedAt,
        sourceName: source.name || source.domain || domainFromUrl(key),
        provider: 'Official source',
        official: true,
        sourceId: source.id,
        entityHints: source.entityHints || []
      });
    }
  }
  return [...found.values()]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 30);
}

export async function fetchOfficialSource(source, signal) {
  const response = await fetch(source.url, {
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7',
      'User-Agent': 'Mozilla/5.0 (compatible; ABGPulse/0.2; +https://www.adityabirla.com/)'
    }
  });
  if (!response.ok) throw new Error(`${source.id}: official ${response.status}`);
  const text = await response.text();
  return extractOfficialItems(text, source);
}


function registryCandidateNames(entity = {}) {
  return [entity.name, ...(entity.aliases || [])]
    .map((value) => normalizeText(value))
    .map((value) => value.replace(/\b(limited|ltd|private|inc|plc|company)\b/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);
}

export async function auditOfficialRegistry(source, entities = [], signal) {
  const response = await fetch(source.url, {
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7',
      'User-Agent': 'Mozilla/5.0 (compatible; ABGPulse/4.0 registry-audit; +https://www.adityabirla.com/)'
    }
  });
  if (!response.ok) throw new Error(`${source.id}: registry ${response.status}`);
  const html = await response.text();
  const pageText = ` ${normalizeText(stripTags(html))} `;
  const expected = source.id === 'abg-companies'
    ? entities.filter((entity) => entity.type === 'company' && entity.officialCompanyEntry === true)
    : entities.filter((entity) => entity.type === 'person' && entity.sourceUrl === source.url);
  const matchedIds = [];
  const missingIds = [];
  for (const entity of expected) {
    const found = registryCandidateNames(entity).some((candidate) => pageText.includes(candidate));
    (found ? matchedIds : missingIds).push(entity.id);
  }
  return {
    kind: 'registry-audit',
    registryId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    expectedCount: expected.length,
    matchedCount: matchedIds.length,
    matchedIds,
    missingIds,
    reconciled: expected.length > 0 && missingIds.length === 0,
    checkedAt: new Date().toISOString()
  };
}
