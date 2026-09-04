const GENERIC_TERMS = new Set([
  'vi', 'idea', 'life', 'health', 'capital', 'fashion', 'retail', 'chemicals',
  'payments', 'housing', 'sun life', 'ultratech', 'hindalco', 'grasim'
]);

function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function quote(value = '') {
  return `"${String(value).replace(/"/g, '').trim()}"`;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function monitorable(entity = {}) {
  if (entity.active === false || entity.monitor === false || entity.priority === 'exclude') return false;
  return ['group', 'company', 'brand', 'person'].includes(entity.type);
}

function priorityScore(entity = {}) {
  let score = 0;
  if (entity.type === 'group') score += 100;
  if (entity.officialCompanyEntry === true) score += 70;
  if (entity.officialLeadershipEntry === true) score += 70;
  if (entity.priority === 'critical') score += 60;
  if (entity.priority === 'high') score += 40;
  if (entity.roleTier === 'group') score += 45;
  if (entity.type === 'company') score += 25;
  if (entity.type === 'person') score += 20;
  if (entity.type === 'brand') score += 15;
  return score;
}

function usableAlias(alias = '') {
  const normalized = normalize(alias);
  if (normalized.length < 4) return false;
  if (/^[0-9]+$/.test(normalized)) return false;
  if (normalized.split(' ').length === 1 && normalized.length < 6 && GENERIC_TERMS.has(normalized)) return false;
  return true;
}

function entityTerms(entity = {}) {
  const raw = unique([
    entity.name,
    entity.legalName,
    ...(Array.isArray(entity.legalNames) ? entity.legalNames : []),
    ...(Array.isArray(entity.aliases) ? entity.aliases : []),
    ...(Array.isArray(entity.tickers) ? entity.tickers : [])
  ]);
  const canonical = String(entity.name || entity.legalName || '').trim();
  const aliases = raw.filter((value) => value !== canonical && usableAlias(value)).slice(0, 2);
  return unique([canonical, ...aliases]).filter((value) => normalize(value).length >= 4);
}

function needsContext(term = '') {
  const normalized = normalize(term);
  return normalized.length < 7 || GENERIC_TERMS.has(normalized) || normalized.split(' ').length === 1;
}

function expression(entity = {}) {
  const terms = entityTerms(entity);
  if (!terms.length) return null;
  const expressions = terms.map((term) => {
    const exact = quote(term);
    if (!needsContext(term)) return exact;
    const context = entity.type === 'person'
      ? '("Aditya Birla" OR "Birla Group")'
      : '("Aditya Birla" OR ABG OR Birla)';
    return `(${exact} AND ${context})`;
  });
  return expressions.length === 1 ? expressions[0] : `(${expressions.join(' OR ')})`;
}

function groupingKey(entity = {}) {
  if (entity.type === 'person') return 'leadership';
  if (entity.type === 'brand') return 'brands';
  if (entity.type === 'group') return 'group';
  const geography = normalize(entity.jurisdiction || entity.country || entity.region || '');
  if (geography && !/(india|indian)/.test(geography)) return 'international-companies';
  return 'companies';
}

function shardEntities(entities, { maxTerms = 7, maxQueryLength = 1250 } = {}) {
  const shards = [];
  let current = [];
  let currentLength = 0;
  for (const entity of entities) {
    const queryExpression = expression(entity);
    if (!queryExpression) continue;
    const addition = (current.length ? 4 : 0) + queryExpression.length;
    if (current.length && (current.length >= maxTerms || currentLength + addition > maxQueryLength)) {
      shards.push(current);
      current = [];
      currentLength = 0;
    }
    current.push({ entity, queryExpression });
    currentLength += (current.length > 1 ? 4 : 0) + queryExpression.length;
  }
  if (current.length) shards.push(current);
  return shards;
}

function publicBaseGroups(baseGroups = []) {
  return baseGroups.filter((group) => group?.publicQuery || group?.alwaysInclude === true).map((group) => ({
    ...group,
    origin: 'curated',
    entityIds: Array.isArray(group.entityIds) ? group.entityIds : []
  }));
}

export function buildEntityQueryPlan({
  entities = [],
  baseGroups = [],
  maxTermsPerShard = 7,
  maxQueryLength = 1250
} = {}) {
  const candidates = entities
    .filter(monitorable)
    .filter((entity) => entityTerms(entity).length)
    .sort((a, b) => priorityScore(b) - priorityScore(a) || String(a.name).localeCompare(String(b.name)));

  const buckets = new Map();
  for (const entity of candidates) {
    const key = groupingKey(entity);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entity);
  }

  const generated = [];
  for (const [key, bucket] of buckets) {
    const shards = shardEntities(bucket, { maxTerms: maxTermsPerShard, maxQueryLength });
    shards.forEach((shard, index) => {
      const entityIds = shard.map(({ entity }) => entity.id).filter(Boolean);
      const query = shard.map(({ queryExpression }) => queryExpression).join(' OR ');
      generated.push({
        id: `entity-${key}-${String(index + 1).padStart(2, '0')}`,
        label: `${key.replace(/-/g, ' ')} ${index + 1}`,
        query,
        entityIds,
        origin: 'generated',
        hindi: key === 'group' || key === 'leadership',
        international: key === 'international-companies' || key === 'group',
        publicQuery: null
      });
    });
  }

  const groups = [...publicBaseGroups(baseGroups), ...generated];
  const coveredEntityIds = new Set(groups.flatMap((group) => group.entityIds || []));
  const uncoveredEntities = candidates
    .filter((entity) => entity.id && !coveredEntityIds.has(entity.id))
    .map((entity) => ({ id: entity.id, name: entity.name, type: entity.type }));
  const overlongGroups = groups
    .filter((group) => String(group.query || '').length > maxQueryLength)
    .map((group) => ({ id: group.id, length: String(group.query || '').length }));

  return {
    groups,
    summary: {
      generatedGroups: generated.length,
      curatedPublicGroups: groups.length - generated.length,
      totalGroups: groups.length,
      monitorableEntities: candidates.length,
      coveredEntities: coveredEntityIds.size,
      uncoveredEntities: uncoveredEntities.length,
      maximumQueryLength: Math.max(0, ...groups.map((group) => String(group.query || '').length)),
      overlongGroups: overlongGroups.length
    },
    gates: {
      allMonitorableEntitiesCovered: uncoveredEntities.length === 0,
      allQueriesWithinLengthLimit: overlongGroups.length === 0,
      noEmptyQueries: groups.length > 0 && groups.every((group) => String(group.query || '').trim().length > 0),
      noDuplicateIds: new Set(groups.map((group) => group.id)).size === groups.length
    },
    uncoveredEntities,
    overlongGroups
  };
}
