import { createHash } from 'node:crypto';

const normalize = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stableId = (...parts) => createHash('sha256')
  .update(parts.flat().filter(Boolean).map(String).join('|'))
  .digest('hex')
  .slice(0, 24);

const asArray = (value) => Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function evidenceFromSource(source = {}, event = {}) {
  const url = canonicalUrl(source.url || source.link || source.sourceUrl || event.url);
  const authority = source.authority || source.name || source.sourceName || source.publisher || source.domain || 'Unknown source';
  const publishedAt = source.publishedAt || source.pubDate || event.publishedAt || event.latestAt || null;
  const tier = Number.isFinite(Number(source.tier)) ? Number(source.tier) : (source.official ? 0 : 3);
  return {
    id: stableId('evidence', event.id, url, authority, publishedAt),
    eventId: event.id,
    authority,
    title: source.title || event.title || null,
    url,
    publishedAt,
    tier,
    official: source.official === true || tier === 0,
    provider: source.provider || null,
    sourceId: source.sourceId || source.authoritativeSourceId || null,
    attachmentUrl: canonicalUrl(source.attachmentUrl),
    rights: source.rights || null,
    snapshotSourceCommit: source.snapshotSourceCommit || null
  };
}

function independentEvidence(evidence = []) {
  const keys = new Set();
  for (const item of evidence) {
    let key = normalize(item.authority);
    try { key = new URL(item.url).hostname.replace(/^www\./, '') || key; } catch { /* retain authority */ }
    if (key) keys.add(key);
  }
  return keys.size;
}

function supportStatus(evidence = []) {
  if (!evidence.length) return { status: 'unsupported', reason: 'No traceable evidence is attached.', confidence: 0 };
  const independent = independentEvidence(evidence);
  const bestTier = Math.min(...evidence.map((item) => Number(item.tier ?? 3)));
  if (bestTier === 0) return { status: 'supported', reason: 'At least one direct official or authoritative source supports the statement.', confidence: independent > 1 ? 0.98 : 0.94 };
  if (bestTier === 1 && independent >= 2) return { status: 'supported', reason: 'At least two independent major-journalism sources support the statement.', confidence: 0.9 };
  if (bestTier <= 1) return { status: 'provisional', reason: 'Strong source quality, but independent corroboration is still limited.', confidence: 0.75 };
  if (independent >= 2) return { status: 'provisional', reason: 'Multiple independent sources exist, but direct or major-source confirmation is absent.', confidence: 0.62 };
  return { status: 'provisional', reason: 'Only one lower-tier evidence source is attached.', confidence: 0.45 };
}

function factStatements(event = {}) {
  const facts = asArray(event.facts).map((value) => typeof value === 'string' ? value : value?.text).filter(Boolean);
  if (facts.length) return facts;
  const summary = typeof event.summary === 'string' ? event.summary : null;
  const title = typeof event.title === 'string' ? event.title : null;
  return [summary || title].filter(Boolean);
}

function interpretationStatements(event = {}) {
  return asArray(event.interpretation || event.interpretations)
    .map((value) => typeof value === 'string' ? value : value?.text)
    .filter(Boolean);
}

export function deriveClaimEvidenceForEvent(event = {}) {
  if (!event.id) throw new TypeError('Event id is required for claim lineage.');
  const evidenceMap = new Map();
  for (const source of asArray(event.sources)) {
    const evidence = evidenceFromSource(source, event);
    if (!evidence.url) continue;
    evidenceMap.set(evidence.id, evidence);
  }
  if (!evidenceMap.size && event.url) {
    const evidence = evidenceFromSource({ url: event.url, name: event.sourceName || event.source }, event);
    if (evidence.url) evidenceMap.set(evidence.id, evidence);
  }
  const evidence = [...evidenceMap.values()];
  const support = supportStatus(evidence);
  const entityIds = [...new Set(asArray(event.entityIds).filter(Boolean))];
  const base = {
    eventId: event.id,
    entityIds,
    evidenceIds: evidence.map((item) => item.id),
    evidenceCount: evidence.length,
    independentEvidenceCount: independentEvidence(evidence),
    supportStatus: support.status,
    supportReason: support.reason,
    supportConfidence: support.confidence,
    observedAt: event.latestAt || event.publishedAt || event.createdAt || null,
    lifecycle: event.lifecycle || event.status || 'observed',
    sourceEventVersion: event.version || 1
  };
  const claims = [
    ...factStatements(event).map((text, index) => ({
      id: stableId('claim', event.id, 'fact', index, normalize(text)),
      ...base,
      kind: 'fact',
      text: String(text).trim(),
      normalizedText: normalize(text),
      sequence: index + 1
    })),
    ...interpretationStatements(event).map((text, index) => ({
      id: stableId('claim', event.id, 'interpretation', index, normalize(text)),
      ...base,
      kind: 'interpretation',
      text: String(text).trim(),
      normalizedText: normalize(text),
      sequence: index + 1,
      supportStatus: 'interpretation',
      supportReason: 'This is explicitly labelled interpretation rather than a verified factual claim.',
      supportConfidence: null
    }))
  ];
  return { eventId: event.id, entityIds, claims, evidence };
}

export function buildClaimEvidenceGraph(events = [], { generatedAt = new Date().toISOString(), sourceCommit = null } = {}) {
  const claimMap = new Map();
  const evidenceMap = new Map();
  const eventSummaries = [];
  for (const event of events) {
    const derived = deriveClaimEvidenceForEvent(event);
    for (const item of derived.claims) claimMap.set(item.id, item);
    for (const item of derived.evidence) evidenceMap.set(item.id, item);
    eventSummaries.push({
      eventId: event.id,
      entityIds: derived.entityIds,
      claimIds: derived.claims.map((item) => item.id),
      evidenceIds: derived.evidence.map((item) => item.id),
      unsupportedFactClaims: derived.claims.filter((item) => item.kind === 'fact' && item.supportStatus === 'unsupported').length,
      provisionalFactClaims: derived.claims.filter((item) => item.kind === 'fact' && item.supportStatus === 'provisional').length
    });
  }
  const claims = [...claimMap.values()];
  const evidence = [...evidenceMap.values()];
  const factClaims = claims.filter((item) => item.kind === 'fact');
  return {
    schemaVersion: '1.0.0',
    generatedAt,
    sourceCommit,
    summary: {
      eventCount: events.length,
      claimCount: claims.length,
      factClaimCount: factClaims.length,
      interpretationCount: claims.filter((item) => item.kind === 'interpretation').length,
      evidenceCount: evidence.length,
      supportedFactClaims: factClaims.filter((item) => item.supportStatus === 'supported').length,
      provisionalFactClaims: factClaims.filter((item) => item.supportStatus === 'provisional').length,
      unsupportedFactClaims: factClaims.filter((item) => item.supportStatus === 'unsupported').length
    },
    eventSummaries,
    claims,
    evidence
  };
}

export function applyCorrection(graph, { claimId, correctionText, evidenceIds = [], reason, correctedAt = new Date().toISOString(), actor = 'system' } = {}) {
  if (!graph || !Array.isArray(graph.claims)) throw new TypeError('A claim graph is required.');
  const original = graph.claims.find((claim) => claim.id === claimId);
  if (!original) throw new Error(`Claim not found: ${claimId}`);
  if (!correctionText || !String(correctionText).trim()) throw new Error('Correction text is required.');
  const availableEvidence = new Set((graph.evidence || []).map((item) => item.id));
  const invalidEvidence = evidenceIds.filter((id) => !availableEvidence.has(id));
  if (invalidEvidence.length) throw new Error(`Unknown correction evidence: ${invalidEvidence.join(', ')}`);
  const correction = {
    id: stableId('correction', claimId, correctionText, correctedAt),
    claimId,
    previousText: original.text,
    correctionText: String(correctionText).trim(),
    normalizedCorrectionText: normalize(correctionText),
    evidenceIds: [...new Set(evidenceIds)],
    reason: reason || 'Correction supplied',
    correctedAt,
    actor,
    version: Number(original.sourceEventVersion || 1) + 1
  };
  original.lifecycle = 'corrected';
  original.correctionId = correction.id;
  graph.corrections = [...(graph.corrections || []), correction];
  return correction;
}

export function findPotentialContradictions(claims = []) {
  const negation = /\b(no|not|never|denies?|denied|without|false|incorrect|withdrawn|cancelled|canceled)\b/i;
  const buckets = new Map();
  for (const claim of claims.filter((item) => item.kind === 'fact')) {
    const key = [...(claim.entityIds || [])].sort().join('|') || claim.eventId;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(claim);
  }
  const pairs = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        const aTokens = new Set(a.normalizedText.split(' ').filter((token) => token.length >= 4));
        const bTokens = new Set(b.normalizedText.split(' ').filter((token) => token.length >= 4));
        const overlap = [...aTokens].filter((token) => bTokens.has(token)).length / Math.max(1, Math.min(aTokens.size, bTokens.size));
        const polarityDiffers = negation.test(a.text) !== negation.test(b.text);
        if (overlap >= 0.45 && polarityDiffers) {
          pairs.push({
            id: stableId('contradiction', a.id, b.id),
            claimIds: [a.id, b.id],
            entityIds: [...new Set([...(a.entityIds || []), ...(b.entityIds || [])])],
            lexicalOverlap: Number(overlap.toFixed(3)),
            reason: 'High lexical overlap with opposing negation cues; human review required.',
            status: 'potential'
          });
        }
      }
    }
  }
  return pairs;
}
