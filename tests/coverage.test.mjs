import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageAudit } from '../lib/coverage.mjs';

const entities = [
  { id: 'alpha', name: 'Alpha Limited', type: 'company', officialCompanyEntry: true, jurisdiction: 'India' },
  { id: 'beta', name: 'Beta Industries', type: 'company', officialCompanyEntry: true },
  { id: 'leader', name: 'Asha Rao', type: 'person', priority: 'high', effectiveFrom: '2026-01-01' }
];
const officialSources = [
  { id: 'alpha-ir', type: 'official investor relations', entityIds: ['alpha'], url: 'https://alpha.example/ir', domain: 'alpha.example', cadence: 'hourly', rightsStatus: 'summarise' },
  { id: 'leader-profile', type: 'official leadership', entityIds: ['leader'], url: 'https://group.example/leader', domain: 'group.example', cadence: 'daily', rightsStatus: 'summarise' }
];
const queryGroups = [
  { id: 'alpha-query', query: 'Alpha Limited corporate news' },
  { id: 'beta-query', query: 'Beta Industries corporate news' },
  { id: 'leader-query', query: 'Asha Rao executive news' }
];

test('coverage audit exposes entities without direct sources', () => {
  const audit = buildCoverageAudit({ entities, sourceRegistry: [], officialSources, queryGroups });
  assert.equal(audit.summary.officialCompanies, 2);
  assert.equal(audit.summary.officialCompaniesDirect, 1);
  assert.equal(audit.gates.allOfficialCompaniesDirectlyMonitored, false);
  assert.deepEqual(audit.gaps.entitiesWithoutDirectSource.map((row) => row.entityId), ['beta']);
});

test('discovery queries do not masquerade as direct authoritative monitoring', () => {
  const audit = buildCoverageAudit({ entities, sourceRegistry: [], officialSources: [], queryGroups });
  assert.equal(audit.summary.discoveryCovered, 3);
  assert.equal(audit.summary.directCovered, 0);
  assert.equal(audit.gates.allPriorityEntitiesDiscoverable, true);
  assert.equal(audit.gates.allOfficialCompaniesDirectlyMonitored, false);
});

test('source rights and operational metadata are independently governed', () => {
  const audit = buildCoverageAudit({
    entities: [entities[0]],
    sourceRegistry: [],
    officialSources: [{ id: 'alpha', official: true, entityId: 'alpha', url: 'https://alpha.example' }],
    queryGroups: [queryGroups[0]]
  });
  assert.equal(audit.gates.allSourcesRightsGoverned, false);
  assert.equal(audit.gates.allDirectSourcesOperationallySpecified, false);
  assert.equal(audit.gaps.sourcesWithoutRightsStatus.length, 1);
});
