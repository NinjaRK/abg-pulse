const ENTITY_REFERENCE_KEYS = new Set([
  'entityId', 'entityIds', 'entities', 'ownerEntityId', 'parentEntityId',
  'companyEntityId', 'personEntityId', 'brandEntityId', 'stakeholderEntityId'
]);

const normalize = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const asArray = (value) => Array.isArray(value) ? value : (value ? [value] : []);

export function collectExplicitEntityIds(value, output = new Set(), key = null) {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string') {
    if (key && ENTITY_REFERENCE_KEYS.has(key)) output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExplicitEntityIds(item, output, key);
    return output;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectExplicitEntityIds(childValue, output, childKey);
    }
  }
  return output;
}

export function entitySearchTerms(entity = {}) {
  const values = [
    entity.id,
    entity.name,
    entity.canonicalName,
    entity.displayName,
    ...(entity.aliases || []),
    ...(entity.tickers || []),
    ...(entity.identifiers ? Object.values(entity.identifiers).flatMap(asArray) : [])
  ];
  return [...new Set(values.map(normalize).filter((value) => value.length >= 3))]
    .sort((a, b) => b.length - a.length);
}

function flattenSourceCollection(collection, fallbackKind) {
  if (!collection) return [];
  const candidates = Array.isArray(collection)
    ? collection
    : Array.isArray(collection.sources)
      ? collection.sources
      : Array.isArray(collection.groups)
        ? collection.groups
        : Object.entries(collection)
          .filter(([, value]) => value && typeof value === 'object')
          .flatMap(([key, value]) => Array.isArray(value) ? value : [{ id: key, ...value }]);

  return candidates.map((source, index) => ({
    id: source.id || source.key || `${fallbackKind}-${index + 1}`,
    name: source.name || source.label || source.authority || source.domain || source.id || `${fallbackKind} ${index + 1}`,
    kind: fallbackKind,
    tier: Number.isFinite(Number(source.tier)) ? Number(source.tier) : (fallbackKind === 'authoritative' || fallbackKind === 'official' ? 0 : 3),
    class: source.class || source.type || fallbackKind,
    endpoint: source.endpoint || source.url || source.domain || null,
    queryText: [
      source.query,
      source.search,
      source.name,
      source.label,
      source.authority,
      source.domain,
      ...(source.queries || []),
      ...(source.symbols || []),
      ...(source.identifiers ? Object.values(source.identifiers).flatMap(asArray) : [])
    ].filter(Boolean).join(' '),
    explicitEntityIds: [...collectExplicitEntityIds(source)],
    active: source.active !== false,
    raw: source
  }));
}

export function normalizeCoverageSources({ sourceRegistry, officialSources, queryGroups, authoritativeSources } = {}) {
  return [
    ...flattenSourceCollection(sourceRegistry, 'registry'),
    ...flattenSourceCollection(officialSources, 'official'),
    ...flattenSourceCollection(queryGroups, 'query'),
    ...flattenSourceCollection(authoritativeSources, 'authoritative')
  ].filter((source) => source.active);
}

function sourceText(source) {
  return normalize([source.id, source.name, source.endpoint, source.queryText].filter(Boolean).join(' '));
}

export function mapSourcesToEntities(entities = [], sources = []) {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const mappings = [];
  const unresolvedReferences = [];

  for (const source of sources) {
    const explicit = new Set(source.explicitEntityIds || []);
    for (const entityId of explicit) {
      if (!entityById.has(entityId)) {
        unresolvedReferences.push({ sourceId: source.id, entityId, kind: source.kind });
        continue;
      }
      mappings.push({ sourceId: source.id, entityId, method: 'explicit', confidence: 1 });
    }

    if (explicit.size) continue;
    const text = sourceText(source);
    if (!text) continue;
    for (const entity of entities) {
      const terms = entitySearchTerms(entity);
      const matched = terms.find((term) => term.length >= 5 && (` ${text} `).includes(` ${term} `));
      if (matched) mappings.push({ sourceId: source.id, entityId: entity.id, method: 'alias', confidence: 0.65, matchedTerm: matched });
    }
  }

  const deduped = new Map();
  for (const mapping of mappings) {
    const key = `${mapping.sourceId}|${mapping.entityId}`;
    const existing = deduped.get(key);
    if (!existing || mapping.confidence > existing.confidence) deduped.set(key, mapping);
  }
  return {
    mappings: [...deduped.values()],
    unresolvedReferences: unresolvedReferences.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.entityId.localeCompare(b.entityId))
  };
}

function priorityReason(entity = {}) {
  if (entity.officialCompanyEntry === true) return 'official-company-register';
  if (entity.promoterFamily === true || entity.familyMember === true) return 'promoter-family';
  if (entity.significantLeader === true || entity.seniorLeader === true) return 'significant-leader';
  if (entity.type === 'person' && /leadership/i.test(String(entity.sourceUrl || ''))) return 'official-leadership-register';
  return null;
}

export function buildEntitySourceCoverage({ entities = [], sourceRegistry, officialSources, queryGroups, authoritativeSources, generatedAt = new Date().toISOString() } = {}) {
  const sources = normalizeCoverageSources({ sourceRegistry, officialSources, queryGroups, authoritativeSources });
  const { mappings, unresolvedReferences } = mapSourcesToEntities(entities, sources);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const mappingByEntity = new Map();
  for (const mapping of mappings) {
    if (!mappingByEntity.has(mapping.entityId)) mappingByEntity.set(mapping.entityId, []);
    mappingByEntity.get(mapping.entityId).push(mapping);
  }

  const rows = entities.map((entity) => {
    const entityMappings = mappingByEntity.get(entity.id) || [];
    const mappedSources = entityMappings.map((mapping) => ({ ...mapping, source: sourceById.get(mapping.sourceId) })).filter((item) => item.source);
    const directTier0 = mappedSources.filter((item) => item.source.tier === 0 || ['authoritative', 'official'].includes(item.source.kind));
    const authoritative = mappedSources.filter((item) => item.source.kind === 'authoritative');
    const official = mappedSources.filter((item) => item.source.kind === 'official');
    const discovery = mappedSources.filter((item) => ['query', 'registry'].includes(item.source.kind));
    const reason = priorityReason(entity);
    const hasDirect = directTier0.length > 0;
    const hasDiscovery = discovery.length > 0;
    const status = hasDirect && hasDiscovery ? 'covered' : (hasDirect || hasDiscovery ? 'partial' : 'gap');
    const gaps = [];
    if (!hasDirect) gaps.push('no-direct-tier-0-source');
    if (!hasDiscovery) gaps.push('no-discovery-or-media-map');
    if (reason && authoritative.length === 0 && entity.type === 'company') gaps.push('no-direct-authoritative-adapter');
    return {
      entityId: entity.id,
      name: entity.canonicalName || entity.name || entity.displayName || entity.id,
      type: entity.type || 'unknown',
      priority: Boolean(reason),
      priorityReason: reason,
      status,
      sourceCount: mappedSources.length,
      directTier0Count: directTier0.length,
      authoritativeCount: authoritative.length,
      officialCount: official.length,
      discoveryCount: discovery.length,
      mappingMethods: [...new Set(entityMappings.map((mapping) => mapping.method))],
      gaps,
      sources: mappedSources.map((item) => ({
        id: item.source.id,
        name: item.source.name,
        kind: item.source.kind,
        tier: item.source.tier,
        method: item.method,
        confidence: item.confidence
      })).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    };
  }).sort((a, b) => Number(b.priority) - Number(a.priority) || a.status.localeCompare(b.status) || a.name.localeCompare(b.name));

  const priorityRows = rows.filter((row) => row.priority);
  const count = (list, status) => list.filter((row) => row.status === status).length;
  return {
    schemaVersion: '1.0.0',
    generatedAt,
    methodology: {
      direct: 'Tier-0 official, exchange, regulator or authoritative source explicitly or conservatively mapped to the entity.',
      discovery: 'Governed query or source-registry coverage that can discover public reporting.',
      covered: 'At least one direct source and one discovery/media mapping.',
      partial: 'Only direct or discovery coverage exists.',
      gap: 'No governed source mapping exists.',
      caveat: 'Alias mappings are lower-confidence and never replace explicit entity-to-source governance.'
    },
    summary: {
      entityCount: rows.length,
      sourceCount: sources.length,
      mappingCount: mappings.length,
      unresolvedReferenceCount: unresolvedReferences.length,
      coveredEntities: count(rows, 'covered'),
      partialEntities: count(rows, 'partial'),
      gapEntities: count(rows, 'gap'),
      priorityEntityCount: priorityRows.length,
      priorityCovered: count(priorityRows, 'covered'),
      priorityPartial: count(priorityRows, 'partial'),
      priorityGaps: count(priorityRows, 'gap'),
      priorityCoveragePct: priorityRows.length ? Math.round(count(priorityRows, 'covered') / priorityRows.length * 1000) / 10 : 0
    },
    unresolvedReferences,
    rows
  };
}
