// Source metadata is discovery evidence, not a statement-level truth check.
// No input flag, source tier, domain count or supplied score can upgrade it.
export const CLAIM_SUPPORT_POLICY = 'source-metadata-only-v1';
export const CLAIM_SUPPORT_NOTICE = 'Sources attached; statement verification pending.';

export function traceableSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return null; }
}

export function assessSourceMetadata(evidence = [], kind = 'fact') {
  const attached = evidence.filter(item => traceableSourceUrl(item?.url));
  const domains = new Set(attached.map(item => new URL(item.url).hostname.toLowerCase().replace(/^www\./, '')));
  return {
    supportStatus: kind === 'interpretation' ? 'interpretation' : attached.length ? 'provisional' : 'unsupported',
    supportReason: kind === 'interpretation'
      ? 'Interpretation, not a verified factual statement.'
      : attached.length
        ? 'Traceable source metadata is attached; the statement has not been checked against source text. Source tier and repeated reporting do not establish truth.'
        : 'No traceable source is attached; this statement is not verified.',
    supportConfidence: null,
    statementVerification: 'not_performed',
    supportPolicy: CLAIM_SUPPORT_POLICY,
    // Null is intentional: we have not established original-reporting independence.
    // Even different domains can syndicate the same report. Breadth is separate.
    independentEvidenceCount: attached.length ? null : 0,
    independenceAssessment: 'not_established',
    sourceDomainCount: domains.size
  };
}

export function eventSupportPresentation(event = {}) {
  const assessment = assessSourceMetadata(Array.isArray(event.sources) ? event.sources : []);
  return {
    label: assessment.supportStatus === 'provisional' ? 'Source-linked · unverified' : 'No traceable source',
    className: 'developing',
    notice: assessment.supportStatus === 'provisional' ? CLAIM_SUPPORT_NOTICE : 'No traceable source; do not treat this statement as verified.',
    policy: CLAIM_SUPPORT_POLICY
  };
}

// Protect cached snapshot and database events at the public API boundary too.
// Ranking is computed upstream; a ranking score must not be exposed as certainty.
export function applyEventSupportPolicy(event = {}) {
  return {
    ...event,
    status: 'developing',
    supportPolicy: CLAIM_SUPPORT_POLICY,
    statementVerification: 'not_performed',
    supportNotice: eventSupportPresentation(event).notice,
    intelligence: { ...(event.intelligence || {}), certainty: null, certaintyCalibrated: false }
  };
}

function policyError(message) {
  return Object.assign(new Error(message), { code: 'claim_support_invalid', status: 503 });
}

// Conservative delivery view, including legacy graphs. Never changes the original
// graph or its archival hash/timestamps. T5.3 must add actual passage verification
// before any claim may be upgraded. An inbound "verified" flag is not authority.
export function applyClaimSupportPolicy(graph) {
  if (!graph || !Array.isArray(graph.claims) || !Array.isArray(graph.evidence) || !Array.isArray(graph.eventSummaries)) {
    throw policyError('Claim-support policy requires a complete graph.');
  }
  const evidenceById = new Map();
  for (const item of graph.evidence) {
    if (!item || typeof item.id !== 'string' || !item.id || evidenceById.has(item.id)) throw policyError('Missing or duplicate evidence identity.');
    const url = traceableSourceUrl(item.url);
    if (!url) throw policyError('Evidence contains an unsafe or missing source URL.');
    evidenceById.set(item.id, { ...item, url });
  }
  const claimIds = new Set();
  const claims = graph.claims.map(claim => {
    if (!claim || typeof claim.id !== 'string' || !claim.id || claimIds.has(claim.id)) throw policyError('Missing or duplicate claim identity.');
    claimIds.add(claim.id);
    if (!['fact', 'interpretation'].includes(claim.kind) || typeof claim.eventId !== 'string' || !claim.eventId || !Array.isArray(claim.evidenceIds)) {
      throw policyError('Invalid claim kind, event identity or evidence references.');
    }
    const evidenceIds = [...new Set(claim.evidenceIds)];
    const evidence = evidenceIds.map(id => {
      const item = evidenceById.get(id);
      if (!item || item.eventId !== claim.eventId) throw policyError('Evidence is missing or belongs to a different event.');
      return item;
    });
    // The existing materiality gate must not be bypassed through relabelling.
    if (claim.kind === 'fact' && !evidence.length) throw policyError('An untraceable factual statement cannot be delivered as a supported claim.');
    const safe = {};
    for (const key of ['id', 'eventId', 'entityIds', 'kind', 'text', 'normalizedText', 'sequence', 'observedAt', 'lifecycle', 'sourceEventVersion', 'correctionId']) {
      if (Object.hasOwn(claim, key)) safe[key] = claim[key];
    }
    return { ...safe, evidenceIds, evidenceCount: evidence.length, ...assessSourceMetadata(evidence, claim.kind) };
  });
  const facts = claims.filter(item => item.kind === 'fact');
  const eventSummaries = graph.eventSummaries.map(event => {
    const own = claims.filter(claim => claim.eventId === event.eventId && claim.kind === 'fact');
    return {
      ...event,
      supportedFactClaims: 0,
      provisionalFactClaims: own.filter(claim => claim.supportStatus === 'provisional').length,
      unsupportedFactClaims: own.filter(claim => claim.supportStatus === 'unsupported').length
    };
  });
  return {
    ...graph,
    supportPolicy: CLAIM_SUPPORT_POLICY,
    statementVerification: 'not_performed',
    claims,
    evidence: [...evidenceById.values()],
    eventSummaries,
    summary: {
      ...graph.summary,
      eventCount: new Set(claims.map(claim => claim.eventId)).size,
      claimCount: claims.length,
      factClaimCount: facts.length,
      interpretationCount: claims.length - facts.length,
      evidenceCount: evidenceById.size,
      supportedFactClaims: 0,
      provisionalFactClaims: facts.filter(item => item.supportStatus === 'provisional').length,
      unsupportedFactClaims: facts.filter(item => item.supportStatus === 'unsupported').length
    },
    quality: {
      ...graph.quality,
      factualAccuracyVerified: false,
      supportPolicy: CLAIM_SUPPORT_POLICY,
      rule: 'The publication gate checks traceable sources and structural consistency, not the truth of each statement.'
    }
  };
}
