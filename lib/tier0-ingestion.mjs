const DEFAULT_USER_AGENT = 'ABG-Pulse/5.5 contact https://github.com/NinjaRK/abg-pulse';

function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function clean(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function validDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  const nse = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (nse) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[nse[2].toLowerCase()];
    if (month !== undefined) {
      const date = new Date(Date.UTC(Number(nse[3]), month, Number(nse[1]), Number(nse[4] || 0), Number(nse[5] || 0), Number(nse[6] || 0)));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  const compact = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (compact) {
    const date = new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4]), Number(compact[5]), Number(compact[6] || 0)));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inWindow(date, window) {
  const parsed = validDate(date);
  if (!parsed) return false;
  const start = validDate(window?.start);
  const end = validDate(window?.end);
  return Boolean(start && end && parsed >= start && parsed <= end);
}

function formatNseDate(value) {
  const date = validDate(value);
  if (!date) throw new Error('A valid source-window date is required.');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

function getSetCookies(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = typeof headers.get === 'function' ? headers.get('set-cookie') : null;
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,=]+=[^;,]+)/g);
}

function cookieHeader(response) {
  return getSetCookies(response?.headers)
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function fetchWithTimeout(fetchImpl, url, options = {}, milliseconds = 7000) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('source_timeout')), milliseconds);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', abort);
  }
}

function resolveEntity(entities, companyContains) {
  const needle = normalize(companyContains);
  if (!needle) return null;
  const candidates = entities.filter((entity) => {
    const terms = [entity.name, entity.legalName, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]
      .map(normalize)
      .filter(Boolean);
    return terms.some((term) => term.includes(needle) || needle.includes(term));
  });
  return candidates.find((entity) => entity.type === 'company') || candidates[0] || null;
}

function absoluteNseUrl(value = '') {
  const raw = String(value).trim();
  if (!raw) return 'https://www.nseindia.com/companies-listing/corporate-filings-announcements';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://nsearchives.nseindia.com/${raw.replace(/^\//, '')}`;
}

export function mapNseAnnouncement(record = {}, instrument = {}, entity = null) {
  const company = clean(first(record.sm_name, record.companyName, record.company, instrument.companyContains, entity?.name, instrument.symbol));
  const subject = clean(first(record.attchmntText, record.desc, record.subject, record.purpose, 'Corporate filing'));
  const details = clean(first(record.desc, record.attchmntText, record.subject, ''));
  const published = validDate(first(record.exchdisstime, record.an_dt, record.sort_date, record.broadCastDate, record.broadcastDate, record.dt, record.date));
  const attachment = absoluteNseUrl(first(record.attchmntFile, record.attachment, record.fileName, record.url, ''));
  const identifier = first(record.seq_id, record.sequenceId, record.id, `${instrument.symbol}-${published?.toISOString() || subject}`);
  return {
    id: `nse-${String(identifier).replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
    title: `${company}: ${subject}`,
    description: details || subject,
    url: attachment,
    domain: new URL(attachment).hostname.replace(/^www\./, ''),
    publishedAt: published?.toISOString() || null,
    sourceName: 'NSE corporate announcement',
    provider: 'NSE direct filing feed',
    channel: 'official-filing',
    language: 'English',
    queryGroup: `tier0-nse-${instrument.symbol}`,
    entityId: entity?.id || null,
    entityName: entity?.name || company,
    exchange: 'NSE',
    exchangeSymbol: instrument.symbol,
    filingCategory: clean(first(record.desc, record.category, record.purpose, 'Corporate announcement')),
    official: true,
    sourceTier: 'tier0',
    rightsStatus: 'metadata-and-link'
  };
}

async function establishNseSession(config, fetchImpl, signal) {
  const userAgent = config.userAgent || DEFAULT_USER_AGENT;
  const response = await fetchWithTimeout(fetchImpl, config.homepage || 'https://www.nseindia.com/', {
    signal,
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': userAgent,
      'Accept-Language': 'en-IN,en;q=0.9'
    }
  }, 7000);
  if (!response.ok) throw new Error(`NSE session ${response.status}`);
  return cookieHeader(response);
}

export async function fetchNseAnnouncements({ config, instrument, entities = [], window, fetchImpl = fetch, signal, sessionCookie = '' }) {
  const entity = resolveEntity(entities, instrument.companyContains);
  const params = new URLSearchParams({
    index: 'equities',
    symbol: instrument.symbol,
    from_date: formatNseDate(window.start),
    to_date: formatNseDate(window.end)
  });
  const endpoint = `${config.endpoint}?${params}`;
  const response = await fetchWithTimeout(fetchImpl, endpoint, {
    signal,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
      'User-Agent': config.userAgent || DEFAULT_USER_AGENT,
      'Accept-Language': 'en-IN,en;q=0.9',
      ...(sessionCookie ? { Cookie: sessionCookie } : {})
    }
  }, 9000);
  if (!response.ok) throw new Error(`NSE ${instrument.symbol} ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`NSE ${instrument.symbol} returned non-array JSON`);
  return payload
    .map((record) => mapNseAnnouncement(record, instrument, entity))
    .filter((article) => article.publishedAt && inWindow(article.publishedAt, window));
}

function secArchiveUrl(cik, accession, primaryDocument) {
  const cikNumber = String(Number(cik));
  const accessionCompact = String(accession || '').replace(/-/g, '');
  if (!cikNumber || !accessionCompact || !primaryDocument) return 'https://www.sec.gov/edgar/searchedgar/companysearch';
  return `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accessionCompact}/${primaryDocument}`;
}

export function mapSecRecentFilings(payload = {}, registrant = {}, entity = null) {
  const recent = payload?.filings?.recent || {};
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  return accessions.map((accession, index) => {
    const form = first(recent.form?.[index], 'SEC filing');
    const description = clean(first(recent.primaryDocDescription?.[index], recent.items?.[index], form));
    const company = clean(first(payload.name, entity?.name, registrant.companyContains, 'Novelis'));
    const primaryDocument = first(recent.primaryDocument?.[index], '');
    const published = validDate(first(recent.acceptanceDateTime?.[index], recent.filingDate?.[index], recent.reportDate?.[index]));
    const url = secArchiveUrl(registrant.cik, accession, primaryDocument);
    return {
      id: `sec-${String(accession).replace(/[^a-zA-Z0-9]+/g, '-')}`,
      title: `${company}: ${form} filing${description && description !== form ? ` — ${description}` : ''}`,
      description: `${form} filed with the U.S. Securities and Exchange Commission.${description ? ` ${description}.` : ''}`,
      url,
      domain: 'sec.gov',
      publishedAt: published?.toISOString() || null,
      sourceName: 'U.S. SEC EDGAR',
      provider: 'SEC direct submissions feed',
      channel: 'official-filing',
      language: 'English',
      queryGroup: `tier0-sec-${String(registrant.cik)}`,
      entityId: entity?.id || null,
      entityName: entity?.name || company,
      regulator: 'U.S. SEC',
      filingForm: form,
      accessionNumber: accession,
      official: true,
      sourceTier: 'tier0',
      rightsStatus: 'public-filing-metadata-and-link'
    };
  });
}

export async function fetchSecSubmissions({ config, registrant, entities = [], window, fetchImpl = fetch, signal }) {
  const entity = resolveEntity(entities, registrant.companyContains);
  const endpoint = String(config.endpointTemplate).replace('{cik}', String(registrant.cik).padStart(10, '0'));
  const response = await fetchWithTimeout(fetchImpl, endpoint, {
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': config.userAgent || DEFAULT_USER_AGENT,
      'Accept-Encoding': 'gzip, deflate'
    }
  }, 9000);
  if (!response.ok) throw new Error(`SEC CIK ${registrant.cik} ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error(`SEC CIK ${registrant.cik} returned invalid JSON`);
  return mapSecRecentFilings(payload, registrant, entity)
    .filter((article) => article.publishedAt && inWindow(article.publishedAt, window));
}

export function validateTier0Config(config = {}, entities = []) {
  const errors = [];
  const instruments = config?.nse?.enabled === false ? [] : (config?.nse?.instruments || []).filter((item) => item.enabled !== false);
  const registrants = config?.sec?.enabled === false ? [] : (config?.sec?.registrants || []).filter((item) => item.enabled !== false);
  for (const instrument of instruments) {
    if (!instrument.symbol) errors.push('NSE instrument missing symbol');
    if (!resolveEntity(entities, instrument.companyContains)) errors.push(`NSE ${instrument.symbol || 'unknown'} entity unresolved: ${instrument.companyContains || ''}`);
  }
  for (const registrant of registrants) {
    if (!/^\d{10}$/.test(String(registrant.cik || ''))) errors.push(`SEC registrant has invalid CIK: ${registrant.cik || ''}`);
    if (!resolveEntity(entities, registrant.companyContains)) errors.push(`SEC ${registrant.cik || 'unknown'} entity unresolved: ${registrant.companyContains || ''}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    configuredJobs: instruments.length + registrants.length,
    nseInstruments: instruments.length,
    secRegistrants: registrants.length
  };
}

export function buildTier0Jobs({ config = {}, entities = [], window, fetchImpl = fetch } = {}) {
  const jobs = [];
  const validation = validateTier0Config(config, entities);
  const nseConfig = config.nse || {};
  const secConfig = config.sec || {};
  let nseSessionPromise = null;
  const getNseSession = (signal) => {
    if (!nseSessionPromise) nseSessionPromise = establishNseSession(nseConfig, fetchImpl, signal);
    return nseSessionPromise;
  };

  if (nseConfig.enabled !== false) {
    for (const instrument of (nseConfig.instruments || []).filter((item) => item.enabled !== false)) {
      jobs.push({
        provider: 'NSE direct filing',
        id: `tier0:nse:${instrument.symbol}`,
        tier: 'tier0',
        authority: 'exchange',
        rightsStatus: nseConfig.rightsStatus || 'metadata-and-link',
        entityId: resolveEntity(entities, instrument.companyContains)?.id || null,
        run: async (signal) => fetchNseAnnouncements({
          config: nseConfig,
          instrument,
          entities,
          window,
          fetchImpl,
          signal,
          sessionCookie: await getNseSession(signal)
        })
      });
    }
  }

  if (secConfig.enabled !== false) {
    for (const registrant of (secConfig.registrants || []).filter((item) => item.enabled !== false)) {
      jobs.push({
        provider: 'SEC direct filing',
        id: `tier0:sec:${registrant.cik}`,
        tier: 'tier0',
        authority: 'regulator',
        rightsStatus: secConfig.rightsStatus || 'public-filing-metadata-and-link',
        entityId: resolveEntity(entities, registrant.companyContains)?.id || null,
        run: (signal) => fetchSecSubmissions({ config: secConfig, registrant, entities, window, fetchImpl, signal })
      });
    }
  }

  return { jobs, validation };
}
