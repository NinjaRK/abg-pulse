const STOP = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','have','in','is','it','its','of','on','or','that','the','to','was','were','will','with',
  'aditya','birla','group','limited','ltd','company','companies','update','updates','news','report','reports','said','says','new'
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

function tokens(value = '') {
  return [...new Set(normalize(value).split(' ').filter((token) => token.length >= 3 && !STOP.has(token)))];
}

function list(value) {
  if (Array.isArray(value)) return value.flatMap(list);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return [value.id, value.entityId, value.name, value.url].flatMap(list);
  return [String(value)];
}

function eventText(event = {}) {
  return [
    event.title,
    event.headline,
    event.summary,
    event.description,
    event.whyItMatters,
    event.facts,
    event.claims?.map?.((claim) => claim.text || claim.claim)
  ].flatMap(list).join(' ');
}

function eventEntities(event = {}) {
  return new Set([
    event.entityId,
    event.entityIds,
    event.entities,
    event.entity,
    event.relevantEntities,
    event.primaryEntity
  ].flatMap(list).map(normalize).filter(Boolean));
}

function eventUrls(event = {}) {
  return new Set([
    event.url,
    event.sourceUrl,
    event.sources,
    event.evidence,
    event.citations,
    event.articles
  ].flatMap(list).filter((value) => /^https?:\/\//i.test(value)).map((value) => {
    try {
      const url = new URL(value);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach((key) => url.searchParams.delete(key));
      return url.toString().replace(/\/$/, '');
    } catch { return value; }
  }));
}

function eventDate(event = {}) {
  const candidates = [event.occurredAt, event.publishedAt, event.updatedAt, event.createdAt, event.date];
  for (const value of candidates) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function hoursApart(left, right) {
  if (!left || !right) return null;
  return Math.abs(left.getTime() - right.getTime()) / 36e5;
}

function numericAnchors(value = '') {
  return new Set((String(value).match(/(?:₹|\$|€|£)?\s*\d+(?:[.,]\d+)*(?:\s*(?:crore|cr|million|billion|mn|bn|%))?/gi) || [])
    .map(normalize)
    .filter((item) => item.length >= 2));
}

export function scoreBenchmarkMatch(reference = {}, systemEvent = {}) {
  const refText = eventText(reference);
  const sysText = eventText(systemEvent);
  const refTokens = new Set(tokens(refText));
  const sysTokens = new Set(tokens(sysText));
  const tokenJaccard = jaccard(refTokens, sysTokens);
  const tokenOverlap = overlap(refTokens, sysTokens);
  const refEntities = eventEntities(reference);
  const sysEntities = eventEntities(systemEvent);
  const entityOverlap = overlap(refEntities, sysEntities);
  const refUrls = eventUrls(reference);
  const sysUrls = eventUrls(systemEvent);
  const exactUrl = [...refUrls].some((url) => sysUrls.has(url));
  const refNumbers = numericAnchors(refText);
  const sysNumbers = numericAnchors(sysText);
  const numberOverlap = overlap(refNumbers, sysNumbers);
  const timeDistanceHours = hoursApart(eventDate(reference), eventDate(systemEvent));
  const timeScore = timeDistanceHours === null ? 0.4 : timeDistanceHours <= 6 ? 1 : timeDistanceHours <= 24 ? 0.8 : timeDistanceHours <= 72 ? 0.45 : 0;

  let score = 0;
  score += tokenJaccard * 35;
  score += tokenOverlap * 20;
  score += entityOverlap * 20;
  score += numberOverlap * 10;
  score += timeScore * 10;
  if (exactUrl) score += 35;
  score = Math.min(100, Math.round(score * 100) / 100);

  const strongEntity = entityOverlap > 0 || refEntities.size === 0 || sysEntities.size === 0;
  const strongText = tokenJaccard >= 0.28 || tokenOverlap >= 0.55;
  const strongEvidence = exactUrl || (numberOverlap > 0 && strongText);
  const withinWindow = timeDistanceHours === null || timeDistanceHours <= 72;
  const eligible = withinWindow && strongEntity && (strongEvidence || strongText) && score >= 52;

  return {
    score,
    eligible,
    features: {
      tokenJaccard: Math.round(tokenJaccard * 1000) / 1000,
      tokenOverlap: Math.round(tokenOverlap * 1000) / 1000,
      entityOverlap: Math.round(entityOverlap * 1000) / 1000,
      numberOverlap: Math.round(numberOverlap * 1000) / 1000,
      exactUrl,
      timeDistanceHours: timeDistanceHours === null ? null : Math.round(timeDistanceHours * 10) / 10
    }
  };
}

export function matchBenchmarkEvents({ references = [], systemEvents = [], minimumScore = 52 } = {}) {
  const candidates = [];
  references.forEach((reference, referenceIndex) => {
    systemEvents.forEach((event, eventIndex) => {
      const result = scoreBenchmarkMatch(reference, event);
      if (result.eligible && result.score >= minimumScore) {
        candidates.push({ referenceIndex, eventIndex, reference, event, ...result });
      }
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.referenceIndex - b.referenceIndex || a.eventIndex - b.eventIndex);

  const usedReferences = new Set();
  const usedEvents = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedReferences.has(candidate.referenceIndex) || usedEvents.has(candidate.eventIndex)) continue;
    usedReferences.add(candidate.referenceIndex);
    usedEvents.add(candidate.eventIndex);
    matches.push({
      referenceId: candidate.reference.id || candidate.reference.referenceId,
      systemEventId: candidate.event.id || null,
      score: candidate.score,
      features: candidate.features
    });
  }

  const matchedByEvent = new Map(matches.map((match) => [match.systemEventId, match]));
  const annotatedSystemEvents = systemEvents.map((event) => {
    const match = matchedByEvent.get(event.id || null);
    return match ? { ...event, referenceIds: [match.referenceId], benchmarkMatch: match } : event;
  });

  return {
    matches,
    annotatedSystemEvents,
    unmatchedReferences: references.filter((reference) => !matches.some((match) => match.referenceId === (reference.id || reference.referenceId))),
    unmatchedSystemEvents: systemEvents.filter((event) => !matches.some((match) => match.systemEventId === (event.id || null))),
    summary: {
      references: references.length,
      systemEvents: systemEvents.length,
      matches: matches.length,
      unmatchedReferences: references.length - matches.length,
      unmatchedSystemEvents: systemEvents.length - matches.length,
      minimumScore
    }
  };
}
