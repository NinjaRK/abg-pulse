const DEFAULT_USER_AGENT = 'ABG-Pulse/5.7 contact https://github.com/NinjaRK/abg-pulse';

function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clean(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  const dotNet = raw.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  if (dotNet) {
    const date = new Date(Number(dotNet[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const compact = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (compact) {
    const date = new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4] || 0), Number(compact[5] || 0), Number(compact[6] || 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const dmy = raw.match(/^(\d{1,2})[-\s/]([A-Za-z]{3}|\d{1,2})[-\s/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = /^\d+$/.test(dmy[2]) ? Number(dmy[2]) - 1 : months[dmy[2].toLowerCase()];
    const date = new Date(Date.UTC(Number(dmy[3]), month, Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inWindow(value, window) {
  const date = parseDate(value);
  const start = parseDate(window?.start);
  const end = parseDate(window?.end);
  return Boolean(date && start && end && date >= start && date <= end);
}

function ymd(value) {
  const date = parseDate(value);
  if (!date) throw new Error('A valid BSE source-window date is required.');
  return date.toISOString().slice(0, 10);
}

function resolveEntity(entities, companyContains) {
  const needle = normalize(companyContains);
  const candidates = entities.filter((entity) => {
    const terms = [entity.name, entity.legalName, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]
      .map(normalize).filter(Boolean);
    return terms.some((term) => term.includes(needle) || needle.includes(term));
  });
  return candidates.find((entity) => entity.type === 'company') || candidates[0] || null;
}

function absoluteAttachment(record = {}) {
  const direct = first(record.NEWSURL, record.NEWS_URL, record.NEWS_SUBJECT_URL, record.ATTACHMENT_URL, record.NEWSPATH, record.NEWS_FILE, record.URL, record.NEWS_LINK);
  if (direct) {
    const raw = String(direct).trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return `https://www.bseindia.com${raw}`;
  }
  const file = first(record.ATTACHMENTNAME, record.ATTACHMENT, record.XML_NAME, record.NEWSSUB_ATTACH);
  if (file) return `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${String(file).replace(/^\//, '')}`;
  return 'https://www.bseindia.com/corporates/ann.html';
}

export function mapBseAnnouncement(record = {}, instrument = {}, entity = null) {
  const company = clean(first(record.SLONGNAME, record.LONG_NAME, record.COMPANYNAME, record.COMP_NAME, entity?.name, instrument.companyContains, instrument.symbol));
  const subject = clean(first(record.NEWSSUB, record.HEADLINE, record.SUBJECT, record.CATEGORYNAME, 'Corporate announcement'));
  const category = clean(first(record.CATEGORYNAME, record.SUBCATNAME, record.NEWS_TYPE, record.CATEGORY, 'Corporate announcement'));
  const detail = clean(first(record.MORE, record.DESCRIPTION, record.DETAILS, record.SUBCATNAME, category));
  const published = parseDate(first(record.DT_TM, record.NEWS_DT, record.DISSEMINATION_DATE, record.BROADCAST_DATE, record.CREATED_DATE));
  const url = absoluteAttachment(record);
  const identifier = first(record.NEWSID, record.NEWS_ID, record.ID, `${instrument.scripCode}-${published?.toISOString() || subject}`);
  return {
    id: `bse-${String(identifier).replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
    title: `${company}: ${subject}`,
    description: detail && detail !== subject ? `${category}. ${detail}` : category,
    url,
    domain: new URL(url).hostname.replace(/^www\./, ''),
    publishedAt: published?.toISOString() || null,
    sourceName: 'BSE corporate announcement',
    provider: 'BSE direct filing feed',
    channel: 'official-filing',
    language: 'English',
    queryGroup: `tier0-bse-${instrument.scripCode}`,
    entityId: entity?.id || null,
    entityName: entity?.name || company,
    exchange: 'BSE',
    exchangeSymbol: instrument.symbol || null,
    scripCode: instrument.scripCode,
    filingCategory: category,
    official: true,
    sourceTier: 'tier0',
    rightsStatus: 'metadata-and-link'
  };
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Table)) return payload.Table;
  if (Array.isArray(payload?.table)) return payload.table;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  throw new Error('BSE returned JSON without an announcement array');
}

function totalRows(payload, fallback) {
  const candidates = [
    payload?.Table1?.[0]?.ROWCNT,
    payload?.Table1?.[0]?.RowCnt,
    payload?.table1?.[0]?.rowcnt,
    payload?.total,
    payload?.TotalRows,
    payload?.count
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function fetchPage({ config, instrument, window, page, fetchImpl, signal }) {
  const params = new URLSearchParams({
    pageno: String(page),
    strCat: '-1',
    strPrevDate: ymd(window.start),
    strScrip: String(instrument.scripCode),
    strSearch: 'P',
    strToDate: ymd(window.end),
    strType: 'C'
  });
  const response = await fetchImpl(`${config.endpoint}?${params}`, {
    signal,
    headers: {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.bseindia.com',
      Referer: config.referer || 'https://www.bseindia.com/corporates/ann.html',
      'User-Agent': config.userAgent || DEFAULT_USER_AGENT,
      'Accept-Language': 'en-IN,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`BSE ${instrument.scripCode} page ${page} ${response.status}`);
  const payload = await response.json();
  const pageRows = rows(payload);
  return { pageRows, total: totalRows(payload, pageRows.length) };
}

export async function fetchBseAnnouncements({ config, instrument, entities = [], window, fetchImpl = fetch, signal }) {
  const entity = resolveEntity(entities, instrument.companyContains);
  const maxPages = Math.max(1, Math.min(20, Number(config.maxPages || 5)));
  const collected = [];
  let expectedTotal = Infinity;
  for (let page = 1; page <= maxPages && collected.length < expectedTotal; page += 1) {
    const { pageRows, total } = await fetchPage({ config, instrument, window, page, fetchImpl, signal });
    expectedTotal = total;
    collected.push(...pageRows);
    if (!pageRows.length) break;
  }
  const unique = new Map();
  for (const record of collected) {
    const article = mapBseAnnouncement(record, instrument, entity);
    if (!article.publishedAt || !inWindow(article.publishedAt, window)) continue;
    const key = article.id || article.url;
    if (!unique.has(key)) unique.set(key, article);
  }
  return [...unique.values()];
}

export function validateBseConfig(config = {}, entities = []) {
  const errors = [];
  const instruments = config.enabled === false ? [] : (config.instruments || []).filter((item) => item.enabled !== false);
  if (!/^https:\/\/api\.bseindia\.com\//.test(String(config.endpoint || ''))) errors.push('BSE endpoint is not the governed api.bseindia.com endpoint');
  for (const instrument of instruments) {
    if (!/^\d{6}$/.test(String(instrument.scripCode || ''))) errors.push(`Invalid BSE scrip code: ${instrument.scripCode || ''}`);
    if (!instrument.symbol) errors.push(`BSE ${instrument.scripCode || 'unknown'} missing symbol`);
    if (!resolveEntity(entities, instrument.companyContains)) errors.push(`BSE ${instrument.scripCode || 'unknown'} entity unresolved: ${instrument.companyContains || ''}`);
  }
  return { valid: errors.length === 0, errors, instruments: instruments.length };
}

export function buildBseJobs({ config = {}, entities = [], window, fetchImpl = fetch } = {}) {
  const validation = validateBseConfig(config, entities);
  const jobs = config.enabled === false ? [] : (config.instruments || [])
    .filter((instrument) => instrument.enabled !== false)
    .map((instrument) => ({
      provider: 'BSE direct filing',
      id: `tier0:bse:${instrument.scripCode}`,
      tier: 'tier0',
      authority: 'exchange',
      rightsStatus: config.rightsStatus || 'metadata-and-link',
      emptyIsValid: true,
      schemaValidated: true,
      entityId: resolveEntity(entities, instrument.companyContains)?.id || null,
      run: (signal) => fetchBseAnnouncements({ config, instrument, entities, window, fetchImpl, signal })
    }));
  return { jobs, validation };
}
