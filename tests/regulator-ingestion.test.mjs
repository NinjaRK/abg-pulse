import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRegulatorListing,
  fetchRegulatorSource,
  validateRegulatorConfig,
  buildRegulatorJobs,
  regulatorRegistryRecords
} from '../lib/regulator-ingestion.mjs';

const source = {
  id: 'sebi-orders',
  name: 'SEBI orders',
  url: 'https://www.sebi.gov.in/orders',
  authority: 'SEBI',
  tier: 'tier0',
  rightsStatus: 'metadata-and-link',
  cadence: 'on-demand',
  maxItems: 80
};
const window = { start: '2026-09-01T00:00:00Z', end: '2026-09-05T23:59:59Z' };

function listingHtml() {
  return `<!doctype html><html><body>
    <section>
      <div class="date">03 September 2026</div>
      <a href="/orders/order-in-the-matter-of-example-company.pdf">Order in the matter of Example Company</a>
    </section>
    <section>
      <div>01 August 2026</div>
      <a href="/orders/old-order.pdf">Order in an old matter</a>
    </section>
  </body></html>`;
}

function response(body, { status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return String(name).toLowerCase() === 'content-type' ? contentType : null; } },
    async text() { return body; }
  };
}

test('parser extracts dated official links and filters the requested period', () => {
  const rows = parseRegulatorListing(listingHtml(), source, window);
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /Example Company/);
  assert.equal(rows[0].publishedAt, '2026-09-03T00:00:00.000Z');
  assert.equal(rows[0].sourceTier, 'tier0');
  assert.equal(rows[0].authority, 'SEBI');
  assert.equal(rows[0].rightsStatus, 'metadata-and-link');
});

test('access challenge is an explicit failure rather than false silence', () => {
  assert.throws(
    () => parseRegulatorListing('<html><body>Access denied. Verify you are human.</body></html>', source, window),
    /access challenge/
  );
});

test('schema drift with no dated publication links fails visibly', () => {
  const html = '<html><body><a href="/orders/example">Order in a matter</a></body></html>';
  assert.throws(() => parseRegulatorListing(html, source, window), /no dated publication links/);
});

test('fetch validates HTTP and content type before parsing', async () => {
  const rows = await fetchRegulatorSource({ source, window, fetchImpl: async () => response(listingHtml()) });
  assert.equal(rows.length, 1);
  await assert.rejects(
    fetchRegulatorSource({ source, window, fetchImpl: async () => response('{}', { contentType: 'application/json' }) }),
    /unexpected content-type/
  );
});

test('config validation rejects duplicate IDs and weak governance metadata', () => {
  const result = validateRegulatorConfig({ sources: [source, { ...source, url: 'http://bad.example', authority: '', rightsStatus: '' }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /duplicate/.test(error)));
  assert.ok(result.errors.some((error) => /HTTPS/.test(error)));
});

test('job and registry counts stay aligned', () => {
  const config = { sources: [source, { ...source, id: 'rbi-release', authority: 'RBI', url: 'https://rbi.org.in/releases' }] };
  const jobs = buildRegulatorJobs({ config, window, fetchImpl: async () => response(listingHtml()) });
  const records = regulatorRegistryRecords(config);
  assert.equal(jobs.validation.valid, true);
  assert.equal(jobs.jobs.length, 2);
  assert.equal(records.length, 2);
  assert.ok(jobs.jobs.every((job) => job.tier === 'tier0' && job.emptyIsValid === true));
});
