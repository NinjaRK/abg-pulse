const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','being','by','for','from','has','have','had','in','into','is','it','its','of','on','or','that','the','this','to','was','were','will','with',
  'after','amid','around','across','about','according','new','latest','update','updates','report','reports','reported','says','said','india','indian','group','company','companies','limited','ltd','corp','corporation','plc','inc'
]);

const POSITIVE = new Set([
  'accelerate','award','awarded','benefit','boost','breakthrough','commissioned','confirms','expands','expansion','gain','gains','growth','improve','improved','innovation','launch','launched','leader','leading','partnership','profit','record','recovery','rises','strong','success','upgrade','win','wins'
]);

const NEGATIVE = new Set([
  'accident','allegation','ban','breach','crisis','decline','delay','delayed','downgrade','fraud','investigation','layoff','loss','miss','penalty','probe','recall','resign','risk','slump','strike','sued','warning','weak'
]);

const NEGATIONS = new Set(['no','not','never','without','neither','nor']);
const ABG_CONTEXT = /aditya\s+birla|hindalco|novelis|ultratech|grasim|vodafone\s+idea|birla\s+opus|abfrl|aditya\s+birla\s+capital|aryaman\s+(?:vikram\s+)?birla|ananya\s+birla|kumar\s+mangalam\s+birla/i;
const VI_CONTEXT = /vodafone|telecom|subscriber|spectrum|agr\b|5g\b|4g\b|network|tower|mobile|arpa?u|bsnl|trai|dot\b/i;
const GENERIC_BIRLA_EXCLUSIONS = /birla\s+institute|bits\s+pilani|birla\s+mandir|b\.?\s*k\.?\s*birla|g\.?\s*d\.?\s*birla|c\.?\s*k\.?\s*birla|m\.?\s*p\.?\s*birla/i;

const SOURCE_FAMILIES = [
  ['times-group', /(?:economictimes|timesofindia|indiatimes|navbharattimes|maharashtratimes)\./i],
  ['network18', /(?:moneycontrol|cnbctv18|news18|firstpost)\./i],
  ['ht-media', /(?:hindustantimes|livemint)\./i],
  ['business-standard', /business-standard\./i],
  ['express-group', /(?:indianexpress|financialexpress)\./i],
  ['ndtv', /(?:ndtv|ndtvprofit)\./i],
  ['reuters', /reuters\./i],
  ['bloomberg', /bloomberg\./i],
  ['abg-official', /(?:adityabirla|hindalco|novelis|ultratechcement|grasim|vodafoneidea|abfrl|adityabirlacapital)\./i],
  ['exchanges-regulators', /(?:bseindia|nseindia|sebi|rbi|trai|cci|sec\.gov|irda|pfrda)\./i]
];

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}%₹$+.'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[-'.]+|[-'.]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function tokenJaccard(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseRegex(value) {
  const cleaned = normalizeText(value).trim();
  if (!cleaned) return null;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(cleaned).replace(/\\\s+/g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'iu');
}

function entityTerms(entity = {}) {
  const values = [entity.name, entity.shortName, entity.ticker, entity.symbol, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]
    .filter(Boolean)
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

function officialDomainFor(entity, domain = '') {
  const urls = [entity.url, entity.officialUrl, entity.sourceUrl].filter(Boolean);
  return urls.some((value) => {
    try { return domain.endsWith(new URL(value).hostname.replace(/^www\./, '')); } catch { return false; }
  });
}

function isAmbiguousTerm(term) {
  const normalized = normalizeText(term).toLowerCase();
  return normalized.length <= 3 || ['birla','vi','idea','capital','opus'].includes(normalized);
}

function entityMatchScore(entity, article, term, inTitle, inBody) {
  const text = `${article.title || ''} ${article.description || ''}`;
  const lowerTerm = normalizeText(term).toLowerCase();
  if (lowerTerm === 'vi' && !VI_CONTEXT.test(text)) return 0;
  if (lowerTerm === 'birla' && GENERIC_BIRLA_EXCLUSIONS.test(text) && !ABG_CONTEXT.test(text)) return 0;
  if (isAmbiguousTerm(term) && !ABG_CONTEXT.test(text) && !officialDomainFor(entity, article.domain || '')) return 0;

  let score = 0;
  const canonical = normalizeText(entity.name || '').toLowerCase();
  const exactCanonical = lowerTerm === canonical;
  if (inTitle) score += exactCanonical ? 70 : 54;
  if (inBody) score += exactCanonical ? 42 : 30;
  if (officialDomainFor(entity, article.domain || '')) score += 28;
  if (ABG_CONTEXT.test(text)) score += 12;
  if (entity.type === 'group') score += 10;
  if (entity.type === 'person') score += 8;
  if (entity.type === 'company') score += 6;
  if (term.length <= 3) score -= 12;
  return Math.max(0, Math.min(100, score));
}

export function resolveEntities(article = {}, entities = [], options = {}) {
  const title = normalizeText(article.title || article.headline || '');
  const body = normalizeText(`${article.description || ''} ${article.summary || ''}`);
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 48;
  const matches = [];

  for (const entity of entities) {
    let best = null;
    for (const term of entityTerms(entity)) {
      const re = phraseRegex(term);
      if (!re) continue;
      const inTitle = re.test(title);
      const inBody = re.test(body);
      if (!inTitle && !inBody) continue;
      const score = entityMatchScore(entity, { ...article, title, description: body }, term, inTitle, inBody);
      if (score >= threshold && (!best || score > best.score)) {
        best = { id: entity.id, name: entity.name, type: entity.type, score, matchedTerm: term, inTitle, inBody };
      }
    }
    if (best) matches.push(best);
  }

  return matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function sourceFamily(domain = '', sourceName = '') {
  const value = `${domain} ${sourceName}`.toLowerCase();
  const known = SOURCE_FAMILIES.find(([, pattern]) => pattern.test(value));
  if (known) return known[0];
  const hostname = String(domain).toLowerCase().replace(/^www\./, '');
  const parts = hostname.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname || normalizeText(sourceName).toLowerCase() || 'unknown';
}

export function independentSourceCount(articles = []) {
  return new Set(articles.map((article) => sourceFamily(article.domain, article.sourceName)).filter(Boolean)).size;
}

export function numericAnchors(value = '') {
  const text = normalizeText(value).toLowerCase();
  const anchors = new Set();
  const pattern = /(?:₹|\$|usd\s*)?\b\d+(?:\.\d+)?\s*(?:crore|cr|lakh|million|billion|bn|mn|mtpa|tonnes?|cities|%|percent)?\b/g;
  for (const match of text.matchAll(pattern)) anchors.add(match[0].replace(/\s+/g, ' ').trim());
  return [...anchors];
}

function entityIdSet(article = {}) {
  return new Set((article.matchedEntities || article.entities || []).map((item) => typeof item === 'string' ? item : item.id || item.name).filter(Boolean));
}

function overlapRatio(left, right) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return overlap / Math.min(left.size, right.size);
}

function hoursApart(a, b) {
  const left = new Date(a.publishedAt || a.date || 0).getTime();
  const right = new Date(b.publishedAt || b.date || 0).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.abs(left - right) / 3_600_000;
}

export function shouldCluster(left, right) {
  const titleSimilarity = tokenJaccard(left.title || left.headline, right.title || right.headline);
  const entityOverlap = overlapRatio(entityIdSet(left), entityIdSet(right));
  const sameCategory = left.category && right.category && left.category === right.category;
  const hours = hoursApart(left, right);
  if (hours > 120) return false;

  const leftNumbers = new Set(numericAnchors(`${left.title || ''} ${left.description || ''}`));
  const rightNumbers = new Set(numericAnchors(`${right.title || ''} ${right.description || ''}`));
  const sharedNumber = [...leftNumbers].some((value) => rightNumbers.has(value));
  const numericConflict = leftNumbers.size && rightNumbers.size && !sharedNumber;

  if (numericConflict && titleSimilarity < 0.62) return false;
  if (!entityOverlap && titleSimilarity < 0.66) return false;
  const score = titleSimilarity * 0.62 + entityOverlap * 0.24 + (sameCategory ? 0.08 : 0) + (sharedNumber ? 0.06 : 0);
  return score >= 0.5 || (titleSimilarity >= 0.72 && hours <= 72);
}

export function clusterArticles(articles = []) {
  const ordered = [...articles].sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
  const clusters = [];
  for (const article of ordered) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < clusters.length; index += 1) {
      const representative = clusters[index][0];
      if (!shouldCluster(representative, article)) continue;
      const score = tokenJaccard(representative.title, article.title) + overlapRatio(entityIdSet(representative), entityIdSet(article));
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    if (bestIndex >= 0) clusters[bestIndex].push(article);
    else clusters.push([article]);
  }
  return clusters;
}

export function classifyCategory(value = '') {
  const text = normalizeText(value).toLowerCase();
  if (/court|tribunal|sebi|rbi|trai|cci|regulat|tax|nclt|nclat|penalt|probe|investigat/.test(text)) return 'Regulatory';
  if (/acqui|merger|stake|buyout|divest|sale\b|consortium/.test(text)) return 'M&A';
  if (/loan|funding|revenue|profit|loss|ebitda|debt|rating|ipo|capex|spectrum dues/.test(text)) return 'Financial';
  if (/ceo|cfo|chairman|director|appoint|resign|leadership|succession/.test(text)) return 'Leadership';
  if (/plant|capacity|commission|network|5g|4g|factory|production|mine|mining/.test(text)) return 'Operations';
  if (/launch|brand|campaign|retail|consumer|customer|store|product/.test(text)) return 'Brand';
  if (/esg|renewable|green|emission|sustainab|climate|recycl/.test(text)) return 'Sustainability';
  if (/award|recognition|jury|honour/.test(text)) return 'Recognition';
  return 'Corporate';
}

export function computeMediaTone(value = '') {
  const words = normalizeText(value).toLowerCase().split(/\s+/).filter(Boolean);
  let raw = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index].replace(/[^a-z]/g, '');
    if (!word) continue;
    const negated = words.slice(Math.max(0, index - 3), index).some((candidate) => NEGATIONS.has(candidate.replace(/[^a-z]/g, '')));
    if (POSITIVE.has(word)) raw += negated ? -1 : 1;
    if (NEGATIVE.has(word)) raw += negated ? 1 : -1;
  }
  return Math.max(-100, Math.min(100, raw * 14));
}

function isAuthoritative(article = {}) {
  const family = sourceFamily(article.domain, article.sourceName);
  return family === 'abg-official' || family === 'exchanges-regulators' || article.official === true || Number(article.sourceTier) === 0;
}

export function computeConfidence(articles = []) {
  const independent = independentSourceCount(articles);
  const authoritative = articles.some(isAuthoritative);
  const tierOne = articles.some((article) => Number(article.sourceTier) <= 1);
  if (authoritative) return 96;
  if (independent >= 4 && tierOne) return 91;
  if (independent >= 3) return 84;
  if (independent >= 2 && tierOne) return 78;
  if (independent >= 2) return 70;
  if (tierOne) return 62;
  return 46;
}

export function computeMateriality(articles = [], primaryEntity = null, category = 'Corporate') {
  const text = articles.map((article) => `${article.title || ''} ${article.description || ''}`).join(' ').toLowerCase();
  const categoryBase = { Regulatory: 72, 'M&A': 74, Financial: 64, Leadership: 66, Operations: 56, Brand: 46, Sustainability: 48, Recognition: 26, Corporate: 42 };
  let score = categoryBase[category] ?? 42;
  if (primaryEntity?.type === 'group') score += 12;
  if (primaryEntity?.type === 'person') score += 9;
  if (primaryEntity?.type === 'company') score += 7;
  if (/kumar mangalam birla|chairman|chief executive|ceo\b|cfo\b|managing director/.test(text)) score += 10;
  if (/crore|billion|bn\b|million|mtpa|nationwide|all circles|supreme court|high court/.test(text)) score += 7;
  if (/reportedly|explor|may\b|could\b|talks|considering|sources said/.test(text)) score -= 8;
  if (articles.some(isAuthoritative)) score += 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeMomentum(articles = [], now = new Date()) {
  const independent = independentSourceCount(articles);
  const dates = articles.map((article) => new Date(article.publishedAt || 0)).filter((date) => !Number.isNaN(date.getTime()));
  const newest = dates.length ? Math.max(...dates.map((date) => date.getTime())) : now.getTime();
  const ageHours = Math.max(0, (now.getTime() - newest) / 3_600_000);
  const recency = Math.max(0, 34 - ageHours * 1.4);
  const breadth = Math.min(42, independent * 11);
  const volume = Math.min(24, Math.log2(Math.max(1, articles.length) + 1) * 8);
  return Math.max(0, Math.min(100, Math.round(recency + breadth + volume)));
}

function toneLabel(score) {
  if (score >= 25) return 'Positive';
  if (score <= -25) return 'Negative';
  return 'Neutral / mixed';
}

function statusFor(articles, confidence) {
  if (articles.some(isAuthoritative)) return 'Confirmed';
  if (confidence >= 76) return 'Strong reporting';
  return 'Developing';
}

function bucketFor(materiality, confidence, momentum, authoritative) {
  if ((authoritative && materiality >= 62) || (materiality >= 72 && confidence >= 76)) return 'must';
  if (materiality >= 52 || momentum >= 68 || (materiality >= 66 && confidence < 76)) return 'watch';
  return 'other';
}

function actionFor(bucket, confidence) {
  if (bucket === 'must') return confidence >= 76 ? 'BRIEF' : 'PREPARE';
  if (bucket === 'watch') return 'WATCH / PREPARE';
  return 'NO ACTION';
}

function safeDescription(articles, headline) {
  const candidate = articles
    .map((article) => normalizeText(article.description || article.summary || ''))
    .filter((value) => value.length >= 45)
    .sort((a, b) => b.length - a.length)[0];
  if (!candidate) return `Coverage reports the development described in the headline. Open the evidence sources for the underlying facts and caveats.`;
  const clipped = candidate.length > 420 ? `${candidate.slice(0, 417).replace(/\s+\S*$/, '')}…` : candidate;
  return clipped.toLowerCase().startsWith(normalizeText(headline).toLowerCase()) ? `${clipped}` : clipped;
}

function whyItMatters(category, entityName, materiality) {
  const entity = entityName || 'ABG';
  if (category === 'Regulatory') return `This may affect ${entity}'s legal, regulatory, financial or reputation position and merits verified senior awareness.`;
  if (category === 'M&A') return `This may change ${entity}'s ownership, portfolio or capital-allocation trajectory.`;
  if (category === 'Financial') return `This may alter ${entity}'s funding, cash-flow, valuation or investment capacity.`;
  if (category === 'Leadership') return `Leadership changes can affect governance, accountability, execution and the external narrative around ${entity}.`;
  if (category === 'Operations') return `This may affect ${entity}'s capacity, execution, cost position or competitive readiness.`;
  if (category === 'Brand') return `This may influence consumer perception, distribution, demand or competitive positioning for ${entity}.`;
  if (materiality >= 65) return `The development could materially change the current picture of ${entity}; confirmation and follow-through should be monitored.`;
  return `The development is relevant to ${entity}; its significance depends on confirmation, scale and what changes next.`;
}

function deterministicId(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `event-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function narrativeDrift(articles = []) {
  const official = articles.find(isAuthoritative);
  const media = articles.find((article) => !isAuthoritative(article));
  if (!official || !media) return { score: null, label: 'Insufficient comparison', officialFrame: official?.title || null, emergingFrame: media?.title || null };
  const alignment = tokenJaccard(official.title, media.title);
  const score = Math.round((1 - alignment) * 100);
  return { score, label: score >= 65 ? 'High drift' : score >= 40 ? 'Moderate drift' : 'Aligned', officialFrame: official.title, emergingFrame: media.title };
}

export function buildEvent(cluster = [], now = new Date()) {
  const articles = [...cluster].filter(Boolean);
  if (!articles.length) return null;
  const ordered = articles.sort((a, b) => {
    const authority = Number(isAuthoritative(b)) - Number(isAuthoritative(a));
    if (authority) return authority;
    return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  });
  const lead = ordered[0];
  const allMatches = ordered.flatMap((article) => article.matchedEntities || []);
  const matchById = new Map();
  for (const match of allMatches) {
    const key = match.id || match.name;
    const existing = matchById.get(key);
    if (!existing || Number(match.score || 0) > Number(existing.score || 0)) matchById.set(key, match);
  }
  const matchedEntities = [...matchById.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const primaryEntity = matchedEntities[0] || { id: 'abg', name: 'Aditya Birla Group', type: 'group', score: 0 };
  const combinedText = ordered.map((article) => `${article.title || ''} ${article.description || ''}`).join(' ');
  const category = classifyCategory(combinedText);
  const confidence = computeConfidence(ordered);
  const materiality = computeMateriality(ordered, primaryEntity, category);
  const momentum = computeMomentum(ordered, now);
  const mediaTone = computeMediaTone(combinedText);
  const authoritative = ordered.some(isAuthoritative);
  const bucket = bucketFor(materiality, confidence, momentum, authoritative);
  const sourceCount = independentSourceCount(ordered);
  const dates = ordered.map((article) => new Date(article.publishedAt || 0)).filter((date) => !Number.isNaN(date.getTime()));
  const firstPublished = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : now;
  const latestPublished = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : now;
  const normalizedHeadline = normalizeText(lead.title || lead.headline || 'Untitled development');
  const identitySeed = `${primaryEntity.id}|${category}|${tokenize(normalizedHeadline).slice(0, 12).sort().join('|')}|${numericAnchors(combinedText).slice(0, 4).join('|')}`;
  const p24 = Math.max(5, Math.min(95, Math.round(materiality * 0.55 + momentum * 0.35 + (100 - confidence) * 0.1)));
  const p6 = Math.max(3, Math.min(92, Math.round(p24 * 0.72)));
  const p72 = Math.max(p24, Math.min(97, Math.round(p24 + (100 - p24) * 0.28)));

  return {
    id: deterministicId(identitySeed),
    headline: normalizedHeadline,
    title: normalizedHeadline,
    summary: safeDescription(ordered, normalizedHeadline),
    whyItMatters: whyItMatters(category, primaryEntity.name, materiality),
    interpretation: whyItMatters(category, primaryEntity.name, materiality),
    bucket,
    status: statusFor(ordered, confidence),
    action: actionFor(bucket, confidence),
    category,
    entity: primaryEntity.name,
    primaryEntity,
    entities: matchedEntities,
    publishedAt: firstPublished.toISOString(),
    updatedAt: latestPublished.toISOString(),
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    sourceCount,
    articleCount: ordered.length,
    sources: ordered.map((article) => ({
      name: article.sourceName || article.domain || 'Source',
      url: article.url,
      domain: article.domain || '',
      family: sourceFamily(article.domain, article.sourceName),
      provider: article.provider || 'Unknown',
      publishedAt: article.publishedAt || null,
      official: isAuthoritative(article),
      tier: Number.isFinite(Number(article.sourceTier)) ? Number(article.sourceTier) : null
    })),
    intelligence: {
      materiality,
      momentum,
      confidence,
      certainty: confidence,
      mediaTone,
      sentiment: mediaTone,
      mediaToneLabel: toneLabel(mediaTone),
      prediction: { p6, p24, p72, status: 'heuristic-until-calibrated' },
      prediction24: p24,
      narrativeDrift: narrativeDrift(ordered)
    },
    methodology: {
      facts: 'Headline and summary are derived only from retrieved source text.',
      interpretation: 'Why it matters and scores are explicitly interpretive.',
      independence: `${sourceCount} independent source families after publisher-lineage collapsing.`
    }
  };
}

export function sortEvents(events = []) {
  const rank = { must: 3, watch: 2, other: 1 };
  return [...events].sort((a, b) =>
    (rank[b.bucket] || 0) - (rank[a.bucket] || 0)
    || Number(b.intelligence?.materiality || 0) - Number(a.intelligence?.materiality || 0)
    || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
}
