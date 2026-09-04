const MATERIALITY_WEIGHT = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  must_know: 4,
  watch: 2,
  other: 1
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function id(value = '') {
  return String(value).trim().toLowerCase();
}

function list(value) {
  if (Array.isArray(value)) return value.flatMap(list);
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

function referenceIds(event) {
  return [...new Set([
    event.referenceId,
    event.referenceIds,
    event.matches,
    event.matchedReferenceIds,
    event.benchmarkReferenceIds
  ].flatMap(list).map(id).filter(Boolean))];
}

function referenceWeight(reference) {
  if (Number.isFinite(Number(reference.weight))) return Math.max(0, Number(reference.weight));
  const materiality = id(reference.materiality || reference.priority || reference.classification);
  return MATERIALITY_WEIGHT[materiality] || 1;
}

function isCritical(reference) {
  return reference.critical === true || id(reference.materiality || reference.priority || reference.classification) === 'critical';
}

function isHigh(reference) {
  const priority = id(reference.materiality || reference.priority || reference.classification);
  return isCritical(reference) || priority === 'high' || priority === 'must_know' || referenceWeight(reference) >= 3;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function claimRows(events) {
  return events.flatMap((event) => {
    if (!Array.isArray(event.claims)) return [];
    return event.claims.map((claim) => ({ event, claim }));
  });
}

export function evaluateDependability({ references = [], systemEvents = [], knownTier0Outages = 0 } = {}) {
  const validReferences = references.filter((reference) => id(reference.id || reference.referenceId));
  const refMap = new Map(validReferences.map((reference) => [id(reference.id || reference.referenceId), reference]));
  const matchedReferenceIds = new Set();
  const matchedSystemEvents = [];
  const unmatchedSystemEvents = [];

  for (const event of systemEvents) {
    const matches = referenceIds(event).filter((referenceId) => refMap.has(referenceId));
    if (matches.length) {
      matches.forEach((referenceId) => matchedReferenceIds.add(referenceId));
      matchedSystemEvents.push({ event, matches });
    } else {
      unmatchedSystemEvents.push(event);
    }
  }

  const totalWeight = validReferences.reduce((sum, reference) => sum + referenceWeight(reference), 0);
  const matchedWeight = validReferences.reduce((sum, reference) => {
    const referenceId = id(reference.id || reference.referenceId);
    return sum + (matchedReferenceIds.has(referenceId) ? referenceWeight(reference) : 0);
  }, 0);
  const criticalReferences = validReferences.filter(isCritical);
  const highReferences = validReferences.filter(isHigh);
  const matchedCritical = criticalReferences.filter((reference) => matchedReferenceIds.has(id(reference.id || reference.referenceId)));
  const matchedHigh = highReferences.filter((reference) => matchedReferenceIds.has(id(reference.id || reference.referenceId)));

  const claims = claimRows(systemEvents);
  const materialClaims = claims.filter(({ event, claim }) => {
    if (claim.material === true) return true;
    const priority = id(event.materiality || event.priority || event.classification || event?.intelligence?.classification);
    return ['critical', 'high', 'must_know'].includes(priority);
  });
  const unsupportedMaterialClaims = materialClaims.filter(({ claim }) => {
    const evidence = claim.evidence || claim.sources || claim.sourceIds || claim.citations;
    return claim.supported === false || list(evidence).length === 0;
  });

  const metrics = {
    referenceEvents: validReferences.length,
    detectedReferenceEvents: matchedReferenceIds.size,
    systemEvents: systemEvents.length,
    matchedSystemEvents: matchedSystemEvents.length,
    unmatchedSystemEvents: unmatchedSystemEvents.length,
    precisionPct: pct(matchedSystemEvents.length, systemEvents.length),
    recallPct: pct(matchedReferenceIds.size, validReferences.length),
    materialityWeightedRecallPct: pct(matchedWeight, totalWeight),
    criticalEvents: criticalReferences.length,
    criticalEventsDetected: matchedCritical.length,
    criticalRecallPct: pct(matchedCritical.length, criticalReferences.length),
    highEvents: highReferences.length,
    highEventsDetected: matchedHigh.length,
    highEventRecallPct: pct(matchedHigh.length, highReferences.length),
    materialClaims: materialClaims.length,
    unsupportedMaterialClaims: unsupportedMaterialClaims.length,
    unsupportedMaterialClaimRatePct: pct(unsupportedMaterialClaims.length, materialClaims.length),
    knownTier0Outages: number(knownTier0Outages)
  };

  const gates = {
    criticalEventRecall: criticalReferences.length > 0 && metrics.criticalRecallPct === 100,
    highEventWeightedRecall: highReferences.length > 0 && metrics.materialityWeightedRecallPct >= 98,
    noUnsupportedMaterialClaims: metrics.unsupportedMaterialClaims === 0,
    noSilentTier0Outage: metrics.knownTier0Outages === 0,
    minimumPrecision: systemEvents.length > 0 && metrics.precisionPct >= 90
  };

  return {
    metrics,
    gates,
    pass: Object.values(gates).every(Boolean),
    misses: validReferences.filter((reference) => !matchedReferenceIds.has(id(reference.id || reference.referenceId))),
    falsePositives: unmatchedSystemEvents,
    unsupportedMaterialClaims: unsupportedMaterialClaims.map(({ event, claim }) => ({
      eventId: event.id || null,
      claimId: claim.id || null,
      text: claim.text || claim.claim || null
    })),
    matched: matchedSystemEvents.map(({ event, matches }) => ({ eventId: event.id || null, referenceIds: matches }))
  };
}

export function buildDailyLedgerEntry({ date, evaluation, scanMeta = {}, notes = [] } = {}) {
  if (!evaluation?.metrics || !evaluation?.gates) throw new Error('A dependability evaluation is required.');
  return {
    date: date || new Date().toISOString().slice(0, 10),
    recordedAt: new Date().toISOString(),
    pass: evaluation.pass,
    metrics: evaluation.metrics,
    gates: evaluation.gates,
    scanMeta: {
      windowStart: scanMeta.windowStart || null,
      windowEnd: scanMeta.windowEnd || null,
      queryCount: number(scanMeta.queryCount),
      successfulQueries: number(scanMeta.successfulQueries),
      failedQueries: Math.max(0, number(scanMeta.queryCount) - number(scanMeta.successfulQueries)),
      eventCount: number(scanMeta.eventCount)
    },
    notes: list(notes)
  };
}
