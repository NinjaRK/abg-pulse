const BASES = new Set(['filing_snapshot', 'historical_snapshot', 'webpage_observation']);
export function dateParts(value, allowMonth = true) {
  if (typeof value !== 'string' || !(allowMonth ? /^\d{4}-\d{2}(?:-\d{2})?$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return null;
  const [year, month, day = 1] = value.split('-').map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day, precision: value.length === 7 ? 'month' : 'day', time: date.getTime() } : null;
}
export function safeSourceUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function validateEntityHistory(data, baseEntities) {
  const errors = []; const fail = (message) => errors.push(message);
  if (data?.schemaVersion !== 1 || data?.complete !== false) fail('An explicitly incomplete version-1 research batch is required.');
  if (!dateParts(data?.retrievedOn, false)) fail('Invalid retrieval date.');
  if (!Array.isArray(baseEntities) || !Array.isArray(data?.additionalEntities) || !Array.isArray(data?.sources) || !Array.isArray(data?.records)) return { valid: false, errors: [...errors, 'Missing entity, source or record arrays.'] };
  const entities = new Map();
  for (const item of [...baseEntities, ...data.additionalEntities]) {
    if (!item?.id || entities.has(item.id)) fail('Missing or duplicate entity ID.');
    entities.set(item?.id, item);
  }
  const sources = new Map();
  for (const s of data.sources) {
    if (!s?.id || sources.has(s.id)) fail('Missing or duplicate source ID.');
    if (!safeSourceUrl(s?.url)) fail(`Unsafe source URL: ${s?.id}`);
    if (!dateParts(s?.retrievedOn, false) || s.retrievedOn > data.retrievedOn) fail(`Invalid source retrieval date: ${s?.id}`);
    if (s?.publishedOn !== null && (!dateParts(s.publishedOn, false) || s.publishedOn > s.retrievedOn)) fail(`Invalid source publication date: ${s?.id}`);
    sources.set(s?.id, s);
  }
  const ids = new Set(); const recordMap = new Map(data.records.map(x => [x?.id, x]));
  for (const row of data.records) {
    if (!row?.id || ids.has(row.id)) fail('Missing or duplicate record ID.'); ids.add(row?.id);
    if (!['ownership', 'leadership'].includes(row.kind)) fail(`Invalid kind: ${row.id}`);
    const subject = entities.get(row.subjectId), related = entities.get(row.relatedEntityId);
    if (!subject || !related || subject === related) fail(`Invalid entity reference: ${row.id}`);
    if (related?.type !== 'company' && !(row.kind === 'ownership' && related?.stakeholderClass === 'joint-venture-partner')) fail(`Related entity must be a company or corporate venture partner: ${row.id}`);
    if (subject?.type !== (row.kind === 'leadership' ? 'person' : 'company')) fail(`Wrong subject type: ${row.id}`);
    if (!row.label || !row.locator || !BASES.has(row.basis)) fail(`Missing claim context: ${row.id}`);
    if (!Array.isArray(row.sourceIds) || !row.sourceIds.length || row.sourceIds.some(id => !sources.has(id))) fail(`Missing evidence reference: ${row.id}`);
    for (const field of ['effectiveFrom', 'effectiveTo', 'sourceAsOf']) {
      if (row[field] !== null && !dateParts(row[field], field !== 'sourceAsOf')) fail(`Invalid ${field}: ${row.id}`);
    }
    if (row.sourceAsOf && row.sourceAsOf > data.retrievedOn) fail(`Future source date: ${row.id}`);
    if (row.basis !== 'webpage_observation' && !row.sourceAsOf) fail(`Dated snapshots need an as-of date: ${row.id}`);
    const from = dateParts(row.effectiveFrom), to = dateParts(row.effectiveTo);
    if (from && from.time > dateParts(row.sourceAsOf || data.retrievedOn, false)?.time) fail(`Effective date after evidence date: ${row.id}`);
    if (from && to && to.time < from.time) fail(`Reversed tenure: ${row.id}`);
    if (row.kind === 'ownership') {
      if (!['direct', 'indirect', 'not_specified'].includes(row.directness)) fail(`Invalid ownership basis: ${row.id}`);
      if (!['exact', 'rounded', 'not_reported'].includes(row.percentagePrecision)) fail(`Invalid percentage precision: ${row.id}`);
      if (row.percentage === null ? row.percentagePrecision !== 'not_reported' : (typeof row.percentage !== 'number' || !Number.isFinite(row.percentage) || row.percentage < 0 || row.percentage > 100 || row.percentagePrecision === 'not_reported')) fail(`Invalid ownership percentage: ${row.id}`);
    }
    if (row.previousObservationId) {
      const prior = recordMap.get(row.previousObservationId);
      if (!prior || prior.id === row.id || prior.subjectId !== row.subjectId || prior.relatedEntityId !== row.relatedEntityId || prior.kind !== row.kind || !prior.sourceAsOf || prior.sourceAsOf >= (row.sourceAsOf || data.retrievedOn)) fail(`Invalid prior observation: ${row.id}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
export function dateLabel(value) {
  const parts = dateParts(value); if (!parts) return 'Not established';
  return parts.precision === 'month' ? `${value} (month only)` : value;
}
export function selectRecords(data, baseEntities, { query = '', kind = 'all', basis = 'all' } = {}) {
  const validation = validateEntityHistory(data, baseEntities);
  if (!validation.valid) throw new Error(`Invalid research registry: ${validation.errors.join('; ')}`);
  const names = new Map([...baseEntities, ...data.additionalEntities].map(e => [e.id, e.name]));
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  return data.records.filter(row => (kind === 'all' || row.kind === kind) && (basis === 'all' || row.basis === basis)
    && `${names.get(row.subjectId)} ${names.get(row.relatedEntityId)} ${row.label} ${row.effectiveFrom || ''}`.toLocaleLowerCase().includes(needle));
}
