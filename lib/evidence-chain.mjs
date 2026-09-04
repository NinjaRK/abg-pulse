import { createHash } from 'node:crypto';

const STOP = new Set([
  'a','an','and','are','as','at','be','been','being','by','for','from','has','have','had','in','is','it','its','of','on','or','that','the','to','was','were','will','with',
  'aditya','birla','group','limited','ltd','inc','plc','company','companies','says','said','reports','reported','report','update','updates','new','latest'
]);

function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9₹$€£%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return [...new Set(normalize(value).split(' ').filter((token) => token.length >= 3 && !STOP.has(token)))];
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function clean(value = '', max = 600) {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function list(value) {
  if (Array.isArray(value)) return value.flatMap(list);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') {
    return [value.id, value.entityId, value.name, value.url, value.sourceUrl, value.title].flatMap(list);
  }
  return [String(value)];
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(String(value));
    url.hash = '';
    [
      'utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','mc_cid','mc_eid','ref','source'
    ].forEach((key) => url.searchParams.delete(key));
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|vero_|hs_|ga_)/i.test(key)) url.searchParams.delete(key);
    });
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '');
  } catch {
    return clean(value, 1000);
  }
}

function domain(value = '') {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberAnchors(value = '') {
  const matches = String(value).match(/(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)?\s*\d+(?:[.,]\d+)*(?:\s*(?:crore|cr|lakh|million|billion|mn|bn|%|percent|bps|basis points|MW|GW|tonnes?|mtpa))?/gi) || [];
  return [...new Set(matches.map((item) => normalize(item)).filter((item) => /\d/.test(item)))];
}

function independentSourceKey(item = {}) {
  return normalize(item.originalPublisher || item.publisher || item.sourceName || item.provider || item.domain || domain(item.url));
}

function jaccard(a = [], b = []) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function topicKey(value = '') {
  const words = tokens(value).filter((token) => !/\d/.test(token)).slice(0, 14).sort();
  return words.join(' ');
}

function sourceTier(item = {}) {
  const raw = normalize(item.sourceTier || item.tier || item.authority || item.channel || '');
  if (item.official === true || /tier0|official filing|regulator|exchange filing|court order/.test(raw)) return 'tier0';
  if (/tier1|major national|international media|wire/.test(raw)) return 'tier1';
  if (/tier2|sector|regional/.test(raw)) return 'tier2';
  return 'tier3';
}

function claimSentences(article = {}) {
  const title = clean(article.title || article.headline || '', 280);
  const description = clean(article.description || article.summary || article.snippet || '', 600);
  const rows = [];
  if (title) rows.push({ text: title, field: 'title' });
  if (description && normalize(description) !== normalize(title)) {
    const sentences = description.split(/(?<=[.!?])\s+(?=[A-Z0-9₹$€£])/).map((sentence) => clean(sentence, 320)).filter(Boolean);
    for (const sentence of sentences.slice(0, 3)) {
      if (tokens(sentence).length >= 3) rows.push({ text: sentence, field: 'description' });
    }
  }
  return rows;
}

function evidenceRecord(article = {}, index = 0) {
  const url = canonicalUrl(article.url || article.sourceUrl || article.link || '');
  const publishedAt = date(article.publishedAt || article.pubDate || article.date || article.updatedAt);
  const title = clean(article.title || article.headline || '', 280);
  const description = clean(article.description || article.summary || article.snippet || '', 600);
  const host = clean(article.domain || domain(url), 200).toLowerCase();
  const record = {
    id: `evidence-${hash([url, publishedAt, title].join('|')).slice(0, 20)}`,
    ordinal: index + 1,
    title,
    description,
    url,
    domain: host,
    publisher: clean(article.originalPublisher || article.publisher || article.sourceName || article.provider || host, 180),
    provider: clean(article.provider || article.sourceName || '', 180) || null,
    publishedAt,
    retrievedAt: date(article.retrievedAt || article.fetchedAt || new Date()),
    tier: sourceTier(article),
    channel: clean(article.channel || article.type || 'news', 80),
    official: article.official === true || sourceTier(article) === 'tier0',
    rightsStatus: clean(article.rightsStatus || article.rights || article.usage || 'link-and-summary-only', 100),
    entityIds: [...new Set([article.entityId, article.entityIds, article.entities].flatMap(list).map(normalize).filter(Boolean))],
    originalPublisherKey: independentSourceKey({ ...article, domain: host, url }),
    contentFingerprint: hash([normalize(title), normalize(description), publishedAt, url].join('|'))
  };
  return record;
}

function claimRecord(sentence, evidence, ordinal) {
  const numeric = numberAnchors(sentence.text);
  return {
    id: `claim-${hash([evidence.id, sentence.field, normalize(sentence.text)].join('|')).slice(0, 20)}`,
    ordinal,
    text: sentence.text,
    extraction: 'verbatim-source-metadata',
    sourceField: sentence.field,
    evidenceIds: [evidence.id],
    sourceTier: evidence.tier,
    official: evidence.official,
    publishedAt: evidence.publishedAt,
    entities: evidence.entityIds,
    numericAnchors: numeric,
    topicKey: topicKey(sentence.text),
    material: numeric.length > 0 || /acquir|merger|appoint|resign|invest|raise|launch|approve|penalt|order|lawsuit|profit|revenue|capacity|stake|filing|regulat|default|downgrade|upgrade/i.test(sentence.text)
  };
}

function mergeClaims(claims = []) {
  const groups = [];
  for (const claim of claims) {
    const claimTokens = tokens(claim.text);
    let group = groups.find((candidate) => {
      const score = jaccard(claimTokens, tokens(candidate.canonicalText));
      const sameNumbers = claim.numericAnchors.length === 0 || candidate.numericAnchors.length === 0 || claim.numericAnchors.some((number) => candidate.numericAnchors.includes(number));
      return score >= 0.82 && sameNumbers;
    });
    if (!group) {
      group = {
        id: `claim-group-${hash(normalize(claim.text)).slice(0, 20)}`,
        canonicalText: claim.text,
        evidenceIds: [],
        sourceTiers: [],
        independentSources: [],
        numericAnchors: claim.numericAnchors,
        topicKey: claim.topicKey,
        material: claim.material,
        memberClaimIds: []
      };
      groups.push(group);
    }
    group.evidenceIds.push(...claim.evidenceIds);
    group.sourceTiers.push(claim.sourceTier);
    group.independentSources.push(claim._sourceKey);
    group.memberClaimIds.push(claim.id);
    group.material = group.material || claim.material;
  }
  return groups.map((group) => {
    const evidenceIds = [...new Set(group.evidenceIds)];
    const sourceTiers = [...new Set(group.sourceTiers)];
    const independentSources = [...new Set(group.independentSources.filter(Boolean))];
    const tier0 = sourceTiers.includes('tier0');
    const supported = tier0 || independentSources.length >= 2;
    return {
      ...group,
      evidenceIds,
      sourceTiers,
      independentSources,
      verification: tier0 ? 'confirmed-by-authoritative-source' : independentSources.length >= 2 ? 'corroborated' : 'single-source',
      supported,
      confidence: tier0 ? 98 : independentSources.length >= 3 ? 92 : independentSources.length === 2 ? 84 : 58
    };
  });
}

function detectContradictions(groups = []) {
  const contradictions = [];
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    const left = groups[leftIndex];
    if (!left.numericAnchors.length) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const right = groups[rightIndex];
      if (!right.numericAnchors.length) continue;
      const topicSimilarity = jaccard(tokens(left.topicKey), tokens(right.topicKey));
      if (topicSimilarity < 0.55) continue;
      const sharedNumber = left.numericAnchors.some((number) => right.numericAnchors.includes(number));
      if (sharedNumber) continue;
      contradictions.push({
        id: `contradiction-${hash([left.id, right.id].sort().join('|')).slice(0, 20)}`,
        claimGroupIds: [left.id, right.id],
        type: 'numeric-conflict',
        status: 'unresolved',
        topicSimilarity: Math.round(topicSimilarity * 1000) / 1000,
        values: [left.numericAnchors, right.numericAnchors],
        evidenceIds: [...new Set([...left.evidenceIds, ...right.evidenceIds])]
      });
    }
  }
  return contradictions;
}

function eventVerification(evidence = [], groups = [], contradictions = []) {
  if (contradictions.length) return { status: 'disputed', confidence: 35 };
  const tier0 = evidence.filter((item) => item.tier === 'tier0');
  const independent = new Set(evidence.map((item) => item.originalPublisherKey).filter(Boolean));
  const supportedMaterial = groups.filter((group) => group.material && group.supported);
  const material = groups.filter((group) => group.material);
  if (tier0.length) return { status: 'confirmed', confidence: 98 };
  if (independent.size >= 3 && (!material.length || supportedMaterial.length === material.length)) return { status: 'strongly-corroborated', confidence: 92 };
  if (independent.size >= 2) return { status: 'corroborated', confidence: 82 };
  return { status: 'single-source', confidence: 58 };
}

function relevantArticles(cluster, event) {
  const candidates = [
    cluster?.articles,
    cluster?.items,
    cluster?.sources,
    event?.articles,
    event?.sources,
    event?.evidence
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return candidates.filter((item) => item && typeof item === 'object' && (item.url || item.sourceUrl || item.title || item.headline));
}

export function buildEvidenceChain(event = {}, cluster = {}, { retrievedAt = new Date() } = {}) {
  const articles = relevantArticles(cluster, event);
  const evidenceMap = new Map();
  articles.forEach((article, index) => {
    const record = evidenceRecord({ ...article, retrievedAt }, index);
    const key = record.url || record.contentFingerprint;
    const existing = evidenceMap.get(key);
    if (!existing || (record.tier === 'tier0' && existing.tier !== 'tier0')) evidenceMap.set(key, record);
  });
  const evidence = [...evidenceMap.values()].map((item, index) => ({ ...item, ordinal: index + 1 }));
  const rawClaims = [];
  let ordinal = 0;
  for (const item of evidence) {
    for (const sentence of claimSentences(item)) {
      ordinal += 1;
      rawClaims.push({ ...claimRecord(sentence, item, ordinal), _sourceKey: item.originalPublisherKey });
    }
  }
  const claimGroups = mergeClaims(rawClaims);
  const contradictions = detectContradictions(claimGroups);
  const verification = eventVerification(evidence, claimGroups, contradictions);
  const unsupportedMaterialClaims = claimGroups.filter((group) => group.material && !group.supported);
  const evidenceHash = hash(evidence.map((item) => item.contentFingerprint).sort().join('|'));
  const chain = {
    version: '1.0.0',
    generatedAt: date(retrievedAt),
    eventId: event.id || null,
    verification,
    evidenceHash,
    evidenceCount: evidence.length,
    independentSourceCount: new Set(evidence.map((item) => item.originalPublisherKey).filter(Boolean)).size,
    tier0EvidenceCount: evidence.filter((item) => item.tier === 'tier0').length,
    claims: rawClaims.map(({ _sourceKey, ...claim }) => claim),
    claimGroups,
    contradictions,
    unsupportedMaterialClaims: unsupportedMaterialClaims.map((group) => ({ id: group.id, text: group.canonicalText, evidenceIds: group.evidenceIds })),
    evidence,
    rules: {
      confirmed: 'At least one direct Tier-0/official source.',
      corroborated: 'At least two independent source-origin keys.',
      unsupportedMaterialClaim: 'A material source-extracted claim with neither Tier-0 evidence nor two independent sources.',
      contradiction: 'Closely related claim groups with materially different numeric anchors.'
    }
  };
  return {
    ...chain,
    chainHash: hash(JSON.stringify({ eventId: chain.eventId, evidenceHash, claimGroups: claimGroups.map((group) => ({ id: group.id, evidenceIds: group.evidenceIds })), contradictions }))
  };
}

export function attachEvidenceChain(event = {}, cluster = {}, options = {}) {
  const evidenceChain = buildEvidenceChain(event, cluster, options);
  return {
    ...event,
    verificationStatus: evidenceChain.verification.status,
    confidence: evidenceChain.verification.confidence,
    evidenceChain,
    claims: evidenceChain.claimGroups.map((group) => ({
      id: group.id,
      text: group.canonicalText,
      evidence: group.evidenceIds,
      supported: group.supported,
      material: group.material,
      verification: group.verification,
      confidence: group.confidence
    }))
  };
}

export function summarizeEvidenceChains(events = []) {
  const chains = events.map((event) => event.evidenceChain).filter(Boolean);
  return {
    events: events.length,
    eventsWithEvidence: chains.filter((chain) => chain.evidenceCount > 0).length,
    confirmedEvents: chains.filter((chain) => chain.verification.status === 'confirmed').length,
    corroboratedEvents: chains.filter((chain) => /corroborated/.test(chain.verification.status)).length,
    disputedEvents: chains.filter((chain) => chain.verification.status === 'disputed').length,
    singleSourceEvents: chains.filter((chain) => chain.verification.status === 'single-source').length,
    evidenceRecords: chains.reduce((sum, chain) => sum + chain.evidenceCount, 0),
    claimGroups: chains.reduce((sum, chain) => sum + chain.claimGroups.length, 0),
    unsupportedMaterialClaims: chains.reduce((sum, chain) => sum + chain.unsupportedMaterialClaims.length, 0),
    contradictions: chains.reduce((sum, chain) => sum + chain.contradictions.length, 0)
  };
}
