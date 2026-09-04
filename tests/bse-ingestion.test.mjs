import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBseAnnouncement, fetchBseAnnouncements, validateBseConfig, buildBseJobs } from '../lib/bse-ingestion.mjs';
import { bseRegistryRecords } from '../lib/bse-registry.mjs';

const entities = [{ id: 'grasim', name: 'Grasim Industries Limited', type: 'company' }];
const instrument = { scripCode: '500300', symbol: 'GRASIM', companyContains: 'Grasim Industries' };
const config = {
  enabled: true,
  endpoint: 'https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w',
  referer: 'https://www.bseindia.com/corporates/ann.html',
  maxPages: 5,
  instruments: [instrument]
};
const window = { start: '2026-09-01T00:00:00Z', end: '2026-09-05T00:00:00Z' };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('BSE mapping preserves Tier-0 provenance and attachment evidence', () => {
  const article = mapBseAnnouncement({
    NEWSID: '777',
    SLONGNAME: 'Grasim Industries Limited',
    NEWSSUB: 'Board meeting outcome',
    CATEGORYNAME: 'Company Update',
    SUBCATNAME: 'Regulation 30 disclosure',
    DT_TM: '2026-09-03 12:15:30',
    ATTACHMENTNAME: 'GRASIM_03092026.pdf'
  }, instrument, entities[0]);
  assert.equal(article.id, 'bse-777');
  assert.equal(article.entityId, 'grasim');
  assert.equal(article.sourceTier, 'tier0');
  assert.equal(article.exchange, 'BSE');
  assert.match(article.url, /AttachLive\/GRASIM_03092026\.pdf/);
  assert.equal(article.publishedAt, '2026-09-03T12:15:30.000Z');
});

test('BSE fetch uses official parameters, paginates and deduplicates', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const page = new URL(url).searchParams.get('pageno');
    if (page === '1') return response({
      Table: [
        { NEWSID: '1', SLONGNAME: 'Grasim Industries Limited', NEWSSUB: 'Disclosure one', DT_TM: '2026-09-03 10:00:00' },
        { NEWSID: '2', SLONGNAME: 'Grasim Industries Limited', NEWSSUB: 'Disclosure two', DT_TM: '2026-09-03 11:00:00' }
      ],
      Table1: [{ ROWCNT: 3 }]
    });
    return response({
      Table: [{ NEWSID: '2', SLONGNAME: 'Grasim Industries Limited', NEWSSUB: 'Disclosure two', DT_TM: '2026-09-03 11:00:00' }],
      Table1: [{ ROWCNT: 3 }]
    });
  };
  const articles = await fetchBseAnnouncements({ config, instrument, entities, window, fetchImpl });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /strScrip=500300/);
  assert.match(calls[0], /strPrevDate=2026-09-01/);
  assert.equal(articles.length, 2);
});

test('BSE non-array JSON fails instead of becoming false silence', async () => {
  await assert.rejects(
    fetchBseAnnouncements({ config, instrument, entities, window, fetchImpl: async () => response({ unexpected: true }) }),
    /without an announcement array/
  );
});

test('BSE configuration validation rejects unresolved entities and invalid codes', () => {
  const result = validateBseConfig({ ...config, instruments: [{ scripCode: 'ABC', symbol: 'BAD', companyContains: 'Missing' }] }, entities);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test('BSE jobs and source registry remain aligned', () => {
  const built = buildBseJobs({ config, entities, window, fetchImpl: async () => response({ Table: [], Table1: [{ ROWCNT: 0 }] }) });
  const records = bseRegistryRecords(config);
  assert.equal(built.validation.valid, true);
  assert.equal(built.jobs.length, 1);
  assert.equal(records.length, 1);
  assert.equal(built.jobs[0].tier, 'tier0');
  assert.equal(built.jobs[0].emptyIsValid, true);
});
