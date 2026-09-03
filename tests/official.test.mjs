import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtml, stripTags, parsePublishedDate, extractOfficialItems, auditOfficialRegistry } from '../official.mjs';

test('official parser decodes and strips HTML safely', () => {
  assert.equal(decodeHtml('A &amp; B &mdash; C'), 'A & B — C');
  assert.equal(stripTags('<strong>Hindalco</strong> launches <em>plant</em>'), 'Hindalco launches plant');
});

test('official parser extracts dated release links only', () => {
  const html = `
    <article><time>27 August, 2026</time><a href="/media/press-releases/hindalco-commissions-new-plant">Hindalco commissions India’s first Superfine PPT ATH plant</a></article>
    <article><a href="/media/press-releases/undated-old-release">Undated old release that should not look new</a></article>`;
  const source = {
    id: 'hindalco-press', name: 'Hindalco Industries', url: 'https://www.hindalco.com/media/press-releases', domain: 'hindalco.com',
    include: ['/media/press-releases/'], exclude: ['/media/press-releases$'], entityHints: ['hindalco']
  };
  const items = extractOfficialItems(html, source, new Date('2026-08-31T00:00:00Z'));
  assert.equal(items.length, 1);
  assert.match(items[0].url, /hindalco-commissions-new-plant$/);
  assert.equal(items[0].official, true);
  assert.equal(items[0].sourceName, 'Hindalco Industries');
  assert.equal(items[0].publishedAt.slice(0, 10), '2026-08-27');
});

test('official parser rejects cross-domain and landing-page links', () => {
  const html = `
    <div>20 August, 2026 <a href="https://example.com/media/press-releases/fake">External fake story</a></div>
    <div>20 August, 2026 <a href="/media/press-releases/">Press releases</a></div>`;
  const source = {
    id: 'abg', name: 'ABG', url: 'https://www.adityabirla.com/media/press-releases/', domain: 'adityabirla.com',
    include: ['/media/press-releases/'], exclude: ['/media/press-releases/$']
  };
  assert.deepEqual(extractOfficialItems(html, source), []);
});

test('date parser handles common newsroom date forms', () => {
  assert.equal(parsePublishedDate('13 August, 2026').toISOString().slice(0, 10), '2026-08-13');
  assert.equal(parsePublishedDate('August 20th, 2026').toISOString().slice(0, 10), '2026-08-20');
  assert.equal(parsePublishedDate('no publication date'), null);
});


test('official registry audit reports exact governed coverage and missing entries', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '<main>Alpha Limited · Beta Corporation</main>' });
  try {
    const source = { id: 'abg-companies', name: 'ABG companies', url: 'https://example.com/companies', domain: 'example.com' };
    const entities = [
      { id: 'alpha', name: 'Alpha Limited', type: 'company', officialCompanyEntry: true },
      { id: 'beta', name: 'Beta Corporation Limited', aliases: ['Beta Corporation'], type: 'company', officialCompanyEntry: true },
      { id: 'gamma', name: 'Gamma Limited', type: 'company', officialCompanyEntry: true }
    ];
    const audit = await auditOfficialRegistry(source, entities);
    assert.equal(audit.expectedCount, 3);
    assert.equal(audit.matchedCount, 2);
    assert.deepEqual(audit.missingIds, ['gamma']);
    assert.equal(audit.reconciled, false);
  } finally { global.fetch = previousFetch; }
});
