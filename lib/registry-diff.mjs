function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|incorporated|inc|corporation|corp|plc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function aliases(record = {}) {
  return [...new Set([
    record.id,
    record.name,
    record.legalName,
    ...(Array.isArray(record.aliases) ? record.aliases : [])
  ].map(normalize).filter(Boolean))];
}

function title(record = {}) {
  return normalize(record.title || record.role || record.designation || record.position || '');
}

function index(records = []) {
  const rows = records.map((record) => ({ ...record, _aliases: aliases(record), _title: title(record) }));
  const byAlias = new Map();
  rows.forEach((row) => row._aliases.forEach((alias) => {
    if (!byAlias.has(alias)) byAlias.set(alias, []);
    byAlias.get(alias).push(row);
  }));
  return { rows, byAlias };
}

function bestMatch(record, observedIndex) {
  const candidates = aliases(record).flatMap((alias) => observedIndex.byAlias.get(alias) || []);
  if (!candidates.length) return null;
  const unique = [...new Map(candidates.map((candidate) => [candidate.id || candidate.name, candidate])).values()];
  if (unique.length === 1) return unique[0];
  const expectedTitle = title(record);
  return unique.find((candidate) => expectedTitle && candidate._title === expectedTitle) || unique[0];
}

function publicRecord(record) {
  const { _aliases, _title, ...rest } = record || {};
  return rest;
}

export function compareRegistry({ expected = [], observed = [], asOf = new Date() } = {}) {
  const expectedIndex = index(expected);
  const observedIndex = index(observed);
  const matchedObserved = new Set();
  const removals = [];
  const roleChanges = [];
  const unchanged = [];
  const ambiguous = [];

  for (const expectedRecord of expectedIndex.rows) {
    const match = bestMatch(expectedRecord, observedIndex);
    if (!match) {
      removals.push({ expected: publicRecord(expectedRecord), detectedAt: new Date(asOf).toISOString() });
      continue;
    }
    const matchId = match.id || match.name;
    if (matchedObserved.has(matchId)) {
      ambiguous.push({ expected: publicRecord(expectedRecord), observed: publicRecord(match), reason: 'observed_record_matched_more_than_once' });
      continue;
    }
    matchedObserved.add(matchId);
    const expectedTitle = expectedRecord._title;
    const observedTitle = match._title;
    if (expectedTitle && observedTitle && expectedTitle !== observedTitle) {
      roleChanges.push({
        id: expectedRecord.id || match.id || null,
        name: expectedRecord.name || match.name,
        from: expectedRecord.title || expectedRecord.role || expectedRecord.designation || null,
        to: match.title || match.role || match.designation || null,
        detectedAt: new Date(asOf).toISOString()
      });
    } else {
      unchanged.push({ expected: publicRecord(expectedRecord), observed: publicRecord(match) });
    }
  }

  const additions = observedIndex.rows
    .filter((record) => !matchedObserved.has(record.id || record.name))
    .map((record) => ({ observed: publicRecord(record), detectedAt: new Date(asOf).toISOString() }));

  return {
    generatedAt: new Date(asOf).toISOString(),
    counts: {
      expected: expected.length,
      observed: observed.length,
      additions: additions.length,
      removals: removals.length,
      roleChanges: roleChanges.length,
      unchanged: unchanged.length,
      ambiguous: ambiguous.length
    },
    reconciled: additions.length === 0 && removals.length === 0 && roleChanges.length === 0 && ambiguous.length === 0,
    additions,
    removals,
    roleChanges,
    ambiguous,
    unchanged,
    effectiveDateSuggestions: [
      ...additions.map(({ observed }) => ({ action: 'add', id: observed.id || null, name: observed.name, effectiveFrom: new Date(asOf).toISOString().slice(0, 10) })),
      ...removals.map(({ expected }) => ({ action: 'close', id: expected.id || null, name: expected.name, effectiveTo: new Date(asOf).toISOString().slice(0, 10) })),
      ...roleChanges.map((change) => ({ action: 'change_role', id: change.id, name: change.name, from: change.from, to: change.to, effectiveFrom: new Date(asOf).toISOString().slice(0, 10) }))
    ]
  };
}
