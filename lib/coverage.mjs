function text(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') {
    return [value.id, value.entityId, value.slug, value.name].flatMap(values);
  }
  return [String(value)];
}

function entityTerms(entity) {
  return [...new Set([
    entity.id,
    entity.name,
    entity.slug,
    ...(Array.isArray(entity.aliases) ? entity.aliases : []),
    ...(Array.isArray(entity.tickers) ? entity.tickers : []),
    ...(Array.isArray(entity.legalNames) ? entity.legalNames : [])
  ].flatMap(values).map(text).filter((term) => term.length >= 3))];
}

function sourceScope(source) {
  return [...new Set([
    source.entityId,
    source.entityIds,
    source.entities,
    source.scope,
    source.companyId,
    source.companyIds,
    source.ownerEntityId
  ].flatMap(values).map(text).filter(Boolean))];
}

function queryCorpus(query) {
  return text([
    query.id,
    query.label,
    query.query,
    query.publicQuery,
    query.description,
    query.entityId,
    query.entityIds
  ].flatMap(values).join(' '));
}

function sourceCorpus(source) {
  return text([
    source.id,
    source.name,
    source.label,
    source.url,
    source.domain,
    source.entityId,
    source.entityIds,
    source.entities,
    source.scope
  ].flatMap(values).join(' '));
}

function matchesEntity(entity, corpus, explicitIds = []) {
  const id = text(entity.id);
  if (id && explicitIds.includes(id)) return true;
  return entityTerms(entity).some((term) => {
    if (term.length < 4) return false;
    return ` ${corpus} `.includes(` ${term} `);
  });
}

function isPriorityEntity(entity) {
  if (entity?.active === false) return false;
  if (entity?.monitor === false) return false;
  if (entity?.priority === 'exclude') return false;
  return ['group', 'company', 'brand', 'person'].includes(entity?.type);
}

function isOfficialCompany(entity) {
  return entity?.type === 'company' && entity?.officialCompanyEntry === true;
}

function isPriorityLeader(entity) {
  return entity?.type === 'person' && (
    entity?.officialLeadershipEntry === true ||
    entity?.roleTier === 'group' ||
    entity?.priority === 'critical' ||
    entity?.priority === 'high'
  );
}

function looksDirect(source) {
  const kind = text(source?.kind || source?.type || source?.category || source?.tier || '');
  return source?.direct === true || source?.official === true || source?.registrySource === true ||
    /official|regulator|exchange|filing|newsroom|investor|rating|court/.test(kind);
}

function looksAuthoritative(source) {
  const tier = text(source?.tier || source?.authority || source?.category || source?.kind || '');
  return source?.authoritative === true || source?.official === true || source?.registrySource === true ||
    /tier 0|tier0|official|regulator|exchange|filing|court|rating/.test(tier);
}

function hasRightsStatus(source) {
  return Boolean(source?.rights || source?.rightsStatus || source?.usage || source?.accessPolicy || source?.permittedUse);
}

function hasOperationalMetadata(source) {
  return Boolean(source?.url || source?.endpoint) && Boolean(source?.domain || source?.url) &&
    Boolean(source?.cadence || source?.frequency || source?.pollInterval || source?.schedule);
}

export function buildCoverageAudit({
  entities = [],
  sourceRegistry = [],
  officialSources = [],
  queryGroups = []
} = {}) {
  const allSources = [...officialSources, ...sourceRegistry];
  const directSources = allSources.filter(looksDirect);
  const authoritativeSources = allSources.filter(looksAuthoritative);
  const priorities = entities.filter(isPriorityEntity);

  const entityRows = priorities.map((entity) => {
    const matchedDirect = directSources.filter((source) => matchesEntity(entity, sourceCorpus(source), sourceScope(source)));
    const matchedAuthoritative = authoritativeSources.filter((source) => matchesEntity(entity, sourceCorpus(source), sourceScope(source)));
    const matchedQueries = queryGroups.filter((query) => matchesEntity(entity, queryCorpus(query), sourceScope(query)));
    const aliases = entityTerms(entity);
    const issues = [];
    if (!matchedDirect.length) issues.push('no_direct_source');
    if (!matchedAuthoritative.length) issues.push('no_authoritative_source');
    if (!matchedQueries.length) issues.push('no_discovery_query');
    if (!aliases.length) issues.push('no_search_terms');
    if (entity.type === 'person' && !entity.effectiveFrom && !entity.startDate) issues.push('role_effective_date_missing');
    if (entity.type === 'company' && !entity.jurisdiction && !entity.country) issues.push('jurisdiction_missing');

    return {
      entityId: entity.id,
      name: entity.name,
      type: entity.type,
      priority: entity.priority || entity.roleTier || null,
      officialCompanyEntry: isOfficialCompany(entity),
      priorityLeader: isPriorityLeader(entity),
      directSourceIds: matchedDirect.map((source) => source.id || source.name || source.url).filter(Boolean),
      authoritativeSourceIds: matchedAuthoritative.map((source) => source.id || source.name || source.url).filter(Boolean),
      queryGroupIds: matchedQueries.map((query) => query.id || query.label).filter(Boolean),
      issues,
      covered: !issues.includes('no_direct_source') && !issues.includes('no_discovery_query')
    };
  });

  const officialCompanies = entityRows.filter((row) => row.officialCompanyEntry);
  const leaders = entityRows.filter((row) => row.priorityLeader);
  const sourceRows = allSources.map((source) => ({
    id: source.id || source.name || source.url || 'unnamed-source',
    domain: source.domain || null,
    direct: looksDirect(source),
    authoritative: looksAuthoritative(source),
    rightsGoverned: hasRightsStatus(source),
    operationalMetadata: hasOperationalMetadata(source)
  }));

  const pct = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
  const directCovered = entityRows.filter((row) => row.directSourceIds.length).length;
  const queryCovered = entityRows.filter((row) => row.queryGroupIds.length).length;
  const fullyCovered = entityRows.filter((row) => row.covered).length;
  const officialCompaniesDirect = officialCompanies.filter((row) => row.directSourceIds.length).length;
  const leadersDirect = leaders.filter((row) => row.directSourceIds.length).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      priorityEntities: entityRows.length,
      fullyCovered,
      fullCoveragePct: pct(fullyCovered, entityRows.length),
      directCovered,
      directCoveragePct: pct(directCovered, entityRows.length),
      discoveryCovered: queryCovered,
      discoveryCoveragePct: pct(queryCovered, entityRows.length),
      officialCompanies: officialCompanies.length,
      officialCompaniesDirect,
      officialCompaniesDirectPct: pct(officialCompaniesDirect, officialCompanies.length),
      priorityLeaders: leaders.length,
      priorityLeadersDirect: leadersDirect,
      priorityLeadersDirectPct: pct(leadersDirect, leaders.length),
      sources: sourceRows.length,
      directSources: sourceRows.filter((row) => row.direct).length,
      authoritativeSources: sourceRows.filter((row) => row.authoritative).length,
      rightsGovernedSources: sourceRows.filter((row) => row.rightsGoverned).length,
      operationalSources: sourceRows.filter((row) => row.operationalMetadata).length
    },
    gates: {
      allOfficialCompaniesDirectlyMonitored: officialCompanies.length > 0 && officialCompanies.every((row) => row.directSourceIds.length > 0),
      allPriorityLeadersDirectlyMonitored: leaders.length > 0 && leaders.every((row) => row.directSourceIds.length > 0),
      allPriorityEntitiesDiscoverable: entityRows.length > 0 && entityRows.every((row) => row.queryGroupIds.length > 0),
      allSourcesRightsGoverned: sourceRows.length > 0 && sourceRows.every((row) => row.rightsGoverned),
      allDirectSourcesOperationallySpecified: sourceRows.filter((row) => row.direct).every((row) => row.operationalMetadata)
    },
    gaps: {
      entitiesWithoutDirectSource: entityRows.filter((row) => !row.directSourceIds.length),
      entitiesWithoutAuthoritativeSource: entityRows.filter((row) => !row.authoritativeSourceIds.length),
      entitiesWithoutDiscoveryQuery: entityRows.filter((row) => !row.queryGroupIds.length),
      sourcesWithoutRightsStatus: sourceRows.filter((row) => !row.rightsGoverned),
      directSourcesWithoutOperationalMetadata: sourceRows.filter((row) => row.direct && !row.operationalMetadata)
    },
    entities: entityRows,
    sources: sourceRows
  };
}
