import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapNseAnnouncement,
  mapSecRecentFilings,
  fetchNseAnnouncements,
  fetchSecSubmissions,
  validateTier0Config,
  buildTier0Jobs
} from '../lib/tier0-ingestion.mjs';

const entities = [
  { id: 'grasim', name: 'Grasim Industries Limited', type: 'company' },
  { id: 'novelis', name: 'Novelis Inc.', aliases: ['Novelis'], type: 'company' }
];
const window = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-05T00:00:00.000Z' };

function response(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) { return headers[String(name).toLowerCase()] || null; },
      getSetCookie() { return headers['set-cookie-list'] || []; }
    },
    async json() { return typeof body === 'string' ? JSON.parse(body) : body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

test('NSE mapping preserves official evidence and entity context', () => {
  const article = mapNseAnnouncement({
    sm_name: 'Grasim Industries Limited',
    attchmntText: 'Disclosure under Regulation 30',
    desc: 'Board meeting outcome',
    exchdisstime: '03-Sep-2026 18:31:14',
    attchmntFile: 'https://nsearchives.nseindia.com/corporate/GRASIM_03092026.pdf',
    seq_id: '123'
  }, { symbol: 'GRASIM', companyContains: 'Grasim Industries' }, entities[0]);
  assert.equal(article.entityId, 'grasim');
  assert.equal(article.sourceTier, 'tier0');
  assert.equal(article.channel, 'official-filing');
  assert.match(article.title, /Grasim Industries Limited/);
  assert.equal(article.publishedAt, '2026-09-03T18:31:14.000Z');
});

test('NSE fetch uses exact window and filters out-of-window filings', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /symbol=GRASIM/);
    assert.match(String(url), /from_date=01-09-2026/);
    assert.match(String(url), /to_date=05-09-2026/);
    assert.equal(options.headers.Cookie, 'nseappid=session');
    return response([
      { sm_name: 'Grasim Industries Limited', attchmntText: 'Material disclosure', exchdisstime: '03-Sep-2026 10:00:00', attchmntFile: 'https://nsearchives.nseindia.com/a.pdf' },
      { sm_name: 'Grasim Industries Limited', attchmntText: 'Old disclosure', exchdisstime: '01-Aug-2026 10:00:00', attchmntFile: 'https://nsearchives.nseindia.com/b.pdf' }
    ]);
  };
  const articles = await fetchNseAnnouncements({
    config: { endpoint: 'https://www.nseindia.com/api/corporate-announcements' },
    instrument: { symbol: 'GRASIM', companyContains: 'Grasim Industries' },
    entities,
    window,
    fetchImpl,
    sessionCookie: 'nseappid=session'
  });
  assert.equal(articles.length, 1);
  assert.match(articles[0].title, /Material disclosure/);
});

test('SEC mapping creates evidence links from accession and primary document', () => {
  const payload = {
    name: 'Novelis Inc.',
    filings: {
      recent: {
        accessionNumber: ['0001304280-26-000123'],
        form: ['8-K'],
        filingDate: ['2026-09-03'],
        acceptanceDateTime: ['2026-09-03T14:12:00.000Z'],
        primaryDocument: ['nvl-20260903.htm'],
        primaryDocDescription: ['Current report']
      }
    }
  };
  const articles = mapSecRecentFilings(payload, { cik: '0001304280', companyContains: 'Novelis' }, entities[1]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].entityId, 'novelis');
  assert.equal(articles[0].filingForm, '8-K');
  assert.match(articles[0].url, /Archives\/edgar\/data\/1304280\/000130428026000123\/nvl-20260903\.htm/);
});

test('SEC fetch rejects HTTP errors rather than returning false silence', async () => {
  await assert.rejects(
    fetchSecSubmissions({
      config: { endpointTemplate: 'https://data.sec.gov/submissions/CIK{cik}.json' },
      registrant: { cik: '0001304280', companyContains: 'Novelis' },
      entities,
      window,
      fetchImpl: async () => response({}, { status: 503 })
    }),
    /SEC CIK 0001304280 503/
  );
});

test('configuration validation exposes unresolved entities', () => {
  const validation = validateTier0Config({
    nse: { instruments: [{ symbol: 'UNKNOWN', companyContains: 'Missing Company' }] },
    sec: { enabled: false }
  }, entities);
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /entity unresolved/);
});

test('Tier-0 job builder emits one health-checkable job per instrument and registrant', () => {
  const built = buildTier0Jobs({
    config: {
      nse: { instruments: [{ symbol: 'GRASIM', companyContains: 'Grasim Industries' }] },
      sec: { endpointTemplate: 'https://data.sec.gov/submissions/CIK{cik}.json', registrants: [{ cik: '0001304280', companyContains: 'Novelis' }] }
    },
    entities,
    window,
    fetchImpl: async () => response([])
  });
  assert.equal(built.validation.valid, true);
  assert.equal(built.jobs.length, 2);
  assert.ok(built.jobs.every((job) => job.tier === 'tier0'));
});
