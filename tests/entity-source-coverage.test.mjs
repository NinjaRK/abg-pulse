import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEntitySourceCoverage,
  collectExplicitEntityIds,
  mapSourcesToEntities,
  normalizeCoverageSources
} from '../lib/entity-source-coverage.mjs';
import { filterCoverageRows } from '../api/entity-source-coverage.js';

const entities = [
  { id: 'company-a', canonicalName: 'Company Alpha', aliases: ['Alpha Ltd'], type: 'company', officialCompanyEntry: true },
  { id: 'leader-a', canonicalName: 'Asha Leader', type: 'person', sourceUrl: 'https://example.com/leadership' },
  { id: 'brand-a', canonicalName: 'Brand Aurora', type: 'brand' }
];

const authoritativeSources = {
  sources: [{
    id: 'exchange-a',
    name: 'Exchange Alpha announcements',
    authority: 'Official Exchange',
    adapter: 'official-html-listing',
    endpoint: 'https://exchange.example.test/alpha',
    tier: 0,
    rights: 'public-exchange-metadata',
    cadenceMinutes: 15,
    jurisdiction: 'IN',
    entityIds: ['company-a'],
    active: true
  }]
};

const queryGroups = {
  groups: [
    { id: 'query-company', name: 'Company Alpha news', entityIds: ['company-a'], queries: ['Company Alpha'] },
    { id: 'query-leader', name: 'Asha Leader news', entityIds: ['leader-a'], queries: ['Asha Leader'] }
  ]
};

test('explicit entity references are collected without treating arbitrary strings as IDs', () => {
  const result = collectExplicitEntityIds({
    entityIds: ['company-a'],
    endpoint: 'company-a',
    nested: { ownerEntityId: 'leader-a', label: 'brand-a' }
  });
  assert.deepEqual([...result].sort(), ['company-a', 'leader-a']);
});

test('coverage source normalisation preserves source kind and Tier-0 authority', () => {
  const sources = normalizeCoverageSources({ authoritativeSources, queryGroups });
  assert.equal(sources.length, 3);
  assert.equal(sources.find((source) => source.id === 'exchange-a').kind, 'authoritative');
  assert.equal(sources.find((source) => source.id === 'exchange-a').tier, 0);
});

test('explicit mappings outrank aliases and unresolved IDs remain visible', () => {
  const sources = normalizeCoverageSources({
    authoritativeSources: {
      sources: [
        ...authoritativeSources.sources,
        { ...authoritativeSources.sources[0], id: 'broken', entityIds: ['missing-entity'] }
      ]
    },
    queryGroups
  });
  const mapped = mapSourcesToEntities(entities, sources);
  const company = mapped.mappings.find((mapping) => mapping.sourceId === 'exchange-a' && mapping.entityId === 'company-a');
  assert.equal(company.method, 'explicit');
  assert.equal(company.confidence, 1);
  assert.deepEqual(mapped.unresolvedReferences, [{ sourceId: 'broken', entityId: 'missing-entity', kind: 'authoritative' }]);
});

test('priority company is covered only when both direct and discovery mappings exist', () => {
  const coverage = buildEntitySourceCoverage({ entities, authoritativeSources, queryGroups, generatedAt: '2026-09-08T00:00:00.000Z' });
  const company = coverage.rows.find((row) => row.entityId === 'company-a');
  const leader = coverage.rows.find((row) => row.entityId === 'leader-a');
  const brand = coverage.rows.find((row) => row.entityId === 'brand-a');
  assert.equal(company.status, 'covered');
  assert.equal(company.directTier0Count, 1);
  assert.equal(company.discoveryCount, 1);
  assert.equal(leader.status, 'partial');
  assert.ok(leader.gaps.includes('no-direct-tier-0-source'));
  assert.equal(brand.status, 'gap');
  assert.equal(coverage.summary.priorityEntityCount, 2);
  assert.equal(coverage.summary.priorityCovered, 1);
  assert.equal(coverage.summary.priorityCoveragePct, 50);
});

test('coverage API filtering supports status, priority, gap and search', () => {
  const coverage = buildEntitySourceCoverage({ entities, authoritativeSources, queryGroups });
  assert.deepEqual(filterCoverageRows(coverage.rows, { status: 'gap' }).map((row) => row.entityId), ['brand-a']);
  assert.deepEqual(filterCoverageRows(coverage.rows, { priority: true }).map((row) => row.entityId).sort(), ['company-a', 'leader-a']);
  assert.deepEqual(filterCoverageRows(coverage.rows, { gap: 'no-direct-tier-0-source' }).map((row) => row.entityId).sort(), ['brand-a', 'leader-a']);
  assert.deepEqual(filterCoverageRows(coverage.rows, { search: 'aurora' }).map((row) => row.entityId), ['brand-a']);
});
