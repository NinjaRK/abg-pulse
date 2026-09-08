const DEFAULT_GRAPH_URL = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data/data/claim-evidence.json';
const DEFAULT_STALE_MINUTES = 240;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60, stale-while-revalidate=180' : 'no-store');
  res.end(JSON.stringify(payload));
}

function queryValue(req, key) {
  const direct = req?.query?.[key];
  if (Array.isArray(direct)) return direct[0];
  if (direct !== undefined) return direct;
  try { return new URL(req.url, 'https://abg-pulse.local').searchParams.get(key); } catch { return null; }
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

const normalize = (value = '') => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function validateClaimEvidenceGraph(payload, { now = new Date(), staleAfterMinutes = DEFAULT_STALE_MINUTES } = {}) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('Claim-evidence graph is not an object.'), { code: 'claim_graph_invalid' });
  if (!Array.isArray(payload.claims)) throw Object.assign(new Error('Claim-evidence graph has no claims array.'), { code: 'claim_graph_invalid' });
  if (!Array.isArray(payload.evidence)) throw Object.assign(new Error('Claim-evidence graph has no evidence array.'), { code: 'claim_graph_invalid' });
  if (!Array.isArray(payload.eventSummaries)) throw Object.assign(new Error('Claim-evidence graph has no event summaries.'), { code: 'claim_graph_invalid' });
  if (!payload.summary || typeof payload.summary !== 'object') throw Object.assign(new Error('Claim-evidence graph summary is missing.'), { code: 'claim_graph_invalid' });
  if (payload?.quality?.publishable !== true) throw Object.assign(new Error('Claim-evidence graph did not pass its publication gate.'), { code: 'claim_graph_unpublishable' });
  if (Number(payload?.quality?.unsupportedMaterialClaimCount || 0) !== 0) {
    throw Object.assign(new Error('Claim-evidence graph contains unsupported material claims.'), { code: 'unsupported_material_claims' });
  }
  const generatedAt = new Date(payload.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw Object.assign(new Error('Claim-evidence graph generation time is invalid.'), { code: 'claim_graph_invalid' });
  const ageMinutes = Math.max(0, (now.getTime() - generatedAt.getTime()) / 60_000);
  if (ageMinutes > staleAfterMinutes) {
    throw Object.assign(new Error(`Claim-evidence graph is ${Math.round(ageMinutes)} minutes old; limit is ${staleAfterMinutes}.`), {
      code: 'claim_graph_stale',
      detail: { ageMinutes: Number(ageMinutes.toFixed(1)), staleAfterMinutes }
    });
  }
  const evidenceIds = new Set(payload.evidence.map((item) => item.id));
  const orphanReferences = payload.claims.flatMap((claim) => (claim.evidenceIds || [])
    .filter((id) => !evidenceIds.has(id))
    .map((evidenceId) => ({ claimId: claim.id, evidenceId })));
  if (orphanReferences.length) {
    throw Object.assign(new Error('Claim-evidence graph contains orphan evidence references.'), {
      code: 'claim_graph_orphan_evidence',
      detail: { orphanReferences: orphanReferences.slice(0, 20) }
    });
  }
  return { ageMinutes: Number(ageMinutes.toFixed(1)), staleAfterMinutes, orphanReferenceCount: 0 };
}

export function filterClaims(claims = [], {
  eventId = null,
  entityId = null,
  kind = null,
  supportStatus = null,
  lifecycle = null,
  search = null
} = {}) {
  const needle = normalize(search);
  return (Array.isArray(claims) ? claims : []).filter((claim) => {
    if (eventId && claim.eventId !== eventId) return false;
    if (entityId && !(claim.entityIds || []).includes(entityId)) return false;
    if (kind && claim.kind !== kind) return false;
    if (supportStatus && claim.supportStatus !== supportStatus) return false;
    if (lifecycle && claim.lifecycle !== lifecycle) return false;
    if (needle && !normalize(`${claim.text || ''} ${(claim.entityIds || []).join(' ')} ${claim.eventId || ''}`).includes(needle)) return false;
    return true;
  });
}

export function projectClaimGraph(payload, filters = {}, { summaryOnly = false, includeEvidence = true } = {}) {
  const claims = filterClaims(payload.claims, filters);
  const claimIds = new Set(claims.map((claim) => claim.id));
  const eventIds = new Set(claims.map((claim) => claim.eventId));
  const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds || []));
  const evidence = includeEvidence ? payload.evidence.filter((item) => evidenceIds.has(item.id)) : [];
  const corrections = (payload.corrections || []).filter((item) => claimIds.has(item.claimId));
  const contradictions = (payload.contradictions || []).filter((item) => (item.claimIds || []).some((id) => claimIds.has(id)));
  const eventSummaries = payload.eventSummaries.filter((item) => eventIds.has(item.eventId));
  const facts = claims.filter((claim) => claim.kind === 'fact');
  const filteredSummary = {
    claimCount: claims.length,
    factClaimCount: facts.length,
    interpretationCount: claims.filter((claim) => claim.kind === 'interpretation').length,
    supportedFactClaims: facts.filter((claim) => claim.supportStatus === 'supported').length,
    provisionalFactClaims: facts.filter((claim) => claim.supportStatus === 'provisional').length,
    unsupportedFactClaims: facts.filter((claim) => claim.supportStatus === 'unsupported').length,
    evidenceCount: evidence.length,
    eventCount: eventSummaries.length,
    correctionCount: corrections.length,
    potentialContradictionCount: contradictions.length
  };
  return {
    filteredSummary,
    eventSummaries: summaryOnly ? [] : eventSummaries,
    claims: summaryOnly ? [] : claims,
    evidence: summaryOnly ? [] : evidence,
    corrections: summaryOnly ? [] : corrections,
    contradictions: summaryOnly ? [] : contradictions
  };
}

export async function loadClaimEvidenceGraph({
  fetchImpl = fetch,
  url = process.env.CLAIM_EVIDENCE_URL || DEFAULT_GRAPH_URL,
  timeoutMs = 12_000
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ABG-Pulse/1.0 claim-evidence reader' }
    });
    if (!response.ok) throw Object.assign(new Error(`Claim-evidence snapshot returned HTTP ${response.status}.`), {
      code: 'claim_graph_http_error',
      detail: { status: response.status, url }
    });
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Claim-evidence snapshot request timed out.'), { code: 'claim_graph_timeout' });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const staleAfterMinutes = boundedNumber(process.env.CLAIM_EVIDENCE_STALE_MINUTES, DEFAULT_STALE_MINUTES, 30, 24 * 60);
    const payload = await loadClaimEvidenceGraph();
    const freshness = validateClaimEvidenceGraph(payload, { staleAfterMinutes });
    const summaryOnly = ['1', 'true', 'yes'].includes(String(queryValue(req, 'summaryOnly') || '').toLowerCase());
    const includeEvidence = !['0', 'false', 'no'].includes(String(queryValue(req, 'includeEvidence') || 'true').toLowerCase());
    const filters = {
      eventId: queryValue(req, 'eventId'),
      entityId: queryValue(req, 'entityId'),
      kind: queryValue(req, 'kind'),
      supportStatus: queryValue(req, 'supportStatus'),
      lifecycle: queryValue(req, 'lifecycle'),
      search: queryValue(req, 'q')
    };
    const projection = projectClaimGraph(payload, filters, { summaryOnly, includeEvidence });
    return send(res, 200, {
      schemaVersion: payload.schemaVersion,
      generatedAt: payload.generatedAt,
      sourceCommit: payload.sourceCommit,
      input: payload.input,
      quality: payload.quality,
      summary: payload.summary,
      filters,
      freshness,
      methodology: {
        fact: 'A factual statement is stored separately from interpretation and linked to the evidence that supports it.',
        supported: 'Supported by a direct official source, or by sufficient independent high-quality corroboration.',
        provisional: 'Relevant evidence exists but does not yet meet the strongest support threshold.',
        unsupported: 'No traceable evidence is attached. Material unsupported claims block graph publication.',
        contradiction: 'Potential contradictions are surfaced for human review; the system does not silently choose a winner.',
        correction: 'Corrections append a new version and retain the original text, evidence and actor.'
      },
      ...projection
    });
  } catch (error) {
    return send(res, Number(error?.status || 503), {
      error: error?.code || 'claim_graph_unavailable',
      message: String(error?.message || error),
      detail: error?.detail || null,
      claims: [],
      evidence: [],
      failedClosed: true,
      checkedAt: new Date().toISOString()
    });
  }
}
