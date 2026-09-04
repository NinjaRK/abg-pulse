import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntityQueryPlan } from '../lib/query-plan.mjs';

const entities = [
  { id: 'abg', name: 'Aditya Birla Group', type: 'group', priority: 'critical' },
  { id: 'alpha', name: 'Alpha Industries Limited', type: 'company', officialCompanyEntry: true, country: 'India' },
  { id: 'beta', name: 'Beta International Holdings', type: 'company', officialCompanyEntry: true, country: 'United States' },
  { id: 'vi', name: 'Vodafone Idea Limited', aliases: ['Vi'], type: 'company', officialCompanyEntry: true, country: 'India' },
  { id: 'leader', name: 'Asha Rao', type: 'person', officialLeadershipEntry: true, priority: 'high' },
  { id: 'brand', name: 'Bright Brand', type: 'brand' }
];

test('every monitorable entity is assigned to a bounded query shard', () => {
  const plan = buildEntityQueryPlan({ entities, baseGroups: [], maxTermsPerShard: 2, maxQueryLength: 300 });
  assert.equal(plan.gates.allMonitorableEntitiesCovered, true);
  assert.equal(plan.gates.allQueriesWithinLengthLimit, true);
  assert.equal(plan.summary.coveredEntities, entities.length);
  assert.ok(plan.groups.every((group) => group.query.length <= 300));
});

test('generic short aliases cannot appear without ABG context', () => {
  const plan = buildEntityQueryPlan({ entities: [entities[3]], baseGroups: [] });
  const query = plan.groups[0].query;
  assert.match(query, /Vodafone Idea Limited/);
  assert.doesNotMatch(query, /\("Vi"\s+OR/);
});

test('international entities are assigned to international discovery editions', () => {
  const plan = buildEntityQueryPlan({ entities: [entities[2]], baseGroups: [] });
  assert.equal(plan.groups[0].international, true);
});

test('curated public-conversation groups are retained without replacing generated coverage', () => {
  const plan = buildEntityQueryPlan({
    entities,
    baseGroups: [{ id: 'public-core', label: 'Core public conversation', query: 'Aditya Birla Group', publicQuery: 'Aditya Birla Group' }]
  });
  assert.equal(plan.groups[0].origin, 'curated');
  assert.ok(plan.groups.some((group) => group.origin === 'generated'));
  assert.equal(plan.gates.noDuplicateIds, true);
});

test('empty or explicitly excluded entities do not create weak queries', () => {
  const plan = buildEntityQueryPlan({
    entities: [
      { id: 'empty', name: '', type: 'company' },
      { id: 'excluded', name: 'Excluded Limited', type: 'company', monitor: false }
    ],
    baseGroups: []
  });
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.summary.monitorableEntities, 0);
});
