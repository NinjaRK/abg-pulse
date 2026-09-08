import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AuthoritativeSourceError,
  fetchAuthoritativeSource,
  fetchAuthoritativeWave,
  parseBseAnnouncements,
  parseNseAnnouncements,
  parseOfficialHtmlListing,
  parseSecSubmissions,
  validateSourceRegistry
} from '../lib/authoritative-sources.mjs';

const registry = JSON.parse(readFileSync(fileURLToPath(new URL('../config/authoritative-sources-wave1.json', import.meta.url)), 'utf8'));
const byId = (id) => registry.sources.find((source) => source.id === id);

function response({ status = 200, json = null, text = '', cookies = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => String(name).toLowerCase() === 'set-cookie' ? cookies.join(', ') : null,
      getSetCookie: () => cookies
    },
    json: async () => json,
    text: async () => text
  };
}

test('wave-one registry is unique, HTTPS, Tier 0 and rights-governed', () => {
  const result = validateSourceRegistry(registry);
  assert.equal(result.sourceCount, 9);
  assert.equal(result.activeSourceCount, 9);
  for (const source of registry.sources) {
    assert.equal(new URL(source.endpoint).protocol, 'https:');
    assert.equal(source.tier, 0);
    assert.match(source.rights, /^public-/);
    assert.ok(source.entityIds.length > 0);
  }
});

test('duplicate source identifiers fail closed', () => {
  const duplicate = { ...registry, sources: [registry.sources[0], registry.sources[0]] };
  assert.throws(() => validateSourceRegistry(duplicate), (error) => error instanceof AuthoritativeSourceError && error.code === 'duplicate_source_id');
});

test('SEC submissions become traceable Novelis filing records', () => {
  const records = parseSecSubmissions({
    cik: '1304280',
    name: 'NOVELIS INC.',
    filings: {
      recent: {
        accessionNumber: ['0001304280-26-000001'],
        filingDate: ['2026-09-07'],
        acceptanceDateTime: ['20260907123456'],
        form: ['8-K'],
        primaryDocument: ['novelis-8k.htm'],
        primaryDocDescription: ['Current report']
      }
    }
  }, byId('sec-novelis'));
  assert.equal(records.length, 1);
  assert.equal(records[0].filingType, '8-K');
  assert.equal(records[0].official, true);
  assert.match(records[0].url, /sec\.gov\/Archives\/edgar\/data\/1304280\/000130428026000001\/novelis-8k\.htm/);
  assert.deepEqual(records[0].entityHints, ['novelis']);
});

test('NSE announcements retain attachment evidence and symbol hints', () => {
  const records = parseNseAnnouncements([{
    symbol: 'HINDALCO',
    an_dt: '07-Sep-2026 18:45:00',
    attchmntText: 'Outcome of Board Meeting',
    desc: 'Board approved the disclosed matter.',
    attchmntFile: 'HINDALCO_07092026.pdf',
    seq_id: 'NSE-1'
  }], byId('nse-abg-listed'));
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceId, 'nse-abg-listed');
  assert.ok(records[0].entityHints.includes('HINDALCO'));
  assert.match(records[0].attachmentUrl, /nsearchives\.nseindia\.com/);
  assert.ok(records[0].publishedAt.startsWith('2026-09-07'));
});

test('BSE announcements retain scrip-code lineage', () => {
  const records = parseBseAnnouncements({ Table: [{
    SCRIP_CD: '500300',
    SLONGNAME: 'Grasim Industries Limited',
    NEWS_DT: '07/09/2026 17:30:00',
    NEWSSUB: 'Disclosure under Regulation 30',
    ATTACHMENTNAME: 'example.pdf',
    NEWSID: 'BSE-1'
  }] }, byId('bse-abg-listed'));
  assert.equal(records.length, 1);
  assert.ok(records[0].entityHints.includes('500300'));
  assert.match(records[0].attachmentUrl, /bseindia\.com/);
  assert.equal(records[0].category, 'BSE corporate announcement');
});

test('official HTML listings extract dated, traceable publication links', () => {
  const records = parseOfficialHtmlListing(`
    <section>
      <span>07 Sep 2026</span>
      <a href="/media/example-release.html">CCI approves proposed combination involving an Aditya Birla entity</a>
    </section>
  `, byId('cci-releases'));
  assert.equal(records.length, 1);
  assert.match(records[0].url, /^https:\/\/www\.cci\.gov\.in\//);
  assert.ok(records[0].publishedAt.startsWith('2026-09-07'));
  assert.equal(records[0].tier, 0);
});

test('single-source fetch enforces source window and provenance', async () => {
  const source = byId('sec-novelis');
  const fetchImpl = async () => response({ json: {
    cik: '1304280',
    name: 'NOVELIS INC.',
    filings: { recent: {
      accessionNumber: ['0001304280-26-000002', '0001304280-26-000003'],
      filingDate: ['2026-09-07', '2026-08-01'],
      form: ['8-K', '10-Q'],
      primaryDocument: ['new.htm', 'old.htm'],
      primaryDocDescription: ['Current report', 'Quarterly report']
    } }
  } });
  const result = await fetchAuthoritativeSource(source, {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z',
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.recordCount, 1);
  assert.equal(result.records[0].externalId, '0001304280-26-000002');
});

test('wave fetch exposes failures instead of silently treating them as coverage', async () => {
  const oneSourceRegistry = { ...registry, sources: [byId('sec-novelis'), byId('cci-releases')] };
  const fetchImpl = async (url) => {
    if (String(url).includes('data.sec.gov')) return response({ status: 503 });
    return response({ text: '<a href="/release.html">A sufficiently descriptive official release title</a><time>07 Sep 2026</time>' });
  };
  const result = await fetchAuthoritativeWave(oneSourceRegistry, {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z',
    fetchImpl
  });
  assert.equal(result.sourceCount, 2);
  assert.equal(result.successfulSourceCount, 1);
  assert.equal(result.failedSourceCount, 1);
  assert.equal(result.sourceChecks.find((item) => item.sourceId === 'sec-novelis').ok, false);
  assert.match(result.sourceChecks.find((item) => item.sourceId === 'sec-novelis').error.message, /HTTP 503/);
});
