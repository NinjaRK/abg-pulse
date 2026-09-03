const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','have','in','is','it','its','of','on','or','that','the','to','was','were','will','with',
  'after','amid','into','over','says','said','new','latest','update','updates','report','reports','reported','according','about','around','across',
  'india','indian','ltd','limited','group','company','companies','corp','corporation','plc','inc'
]);

const POSITIVE = [
  'gain','gains','growth','record','strong','improve','improved','improvement','win','wins','won','award','awarded','launch','launched','commission','commissioned',
  'expand','expansion','profit','profitable','approval','approved','upgrade','upgraded','partnership','tie-up','investment','invest','innovation','leader','leadership',
  'self-reliance','sustainable','renewable','milestone','positive','boost','rises','rise','surge','surges','secure','secured','acquire','acquisition'
];
const NEGATIVE = [
  'loss','losses','decline','falls','fall','drop','drops','debt','default','probe','investigation','fraud','fine','penalty','lawsuit','court','regulator','recall','accident',
  'fire','death','deaths','injury','injuries','strike','layoff','layoffs','resign','resignation','crisis','risk','warning','downgrade','negative','miss','misses','delay','delayed',
  'breach','complaint','controversy','dispute','slump','weak','violation','allegation','alleged','unconfirmed'
];

const MATERIALITY_TERMS = [
  ['acquisition',28],['acquire',25],['merger',28],['sale',18],['stake',18],['investment',20],['capex',20],['crore',10],['billion',16],['financing',22],['loan',18],
  ['results',18],['revenue',14],['profit',18],['loss',18],['ebitda',16],['rating',12],['downgrade',22],['upgrade',14],['default',35],
  ['chairman',22],['ceo',20],['cfo',20],['md',14],['director',12],['resign',30],['appointed',20],['appointment',20],['leadership',18],
  ['court',24],['regulator',25],['sebi',28],['cci',28],['rbi',28],['trai',26],['nclt',28],['nclat',28],['supreme court',32],['high court',28],['tax',16],
  ['accident',32],['fire',30],['fatal',38],['death',38],['injury',30],['strike',24],['protest',22],['fraud',38],['probe',30],['investigation',28],['recall',30],
  ['launch',10],['commissioned',18],['expansion',18],['plant',14],['capacity',14],['5g',14],['spectrum',18],['subscriber',12],['partnership',10],
  ['promoter',24],['kumar mangalam birla',30],['ananya birla',22],['aryaman birla',22],['rajashree birla',20],['aditya birla group',18]
];

const CERTAINTY_DOWN = ['reportedly','sources said','people familiar','may','might','could','exploring','considering','talks','likely','rumour','rumor','unconfirmed','appears'];
const CERTAINTY_UP = ['announced','disclosed','filing','official','confirmed','approved','commissioned','appointed','completed','signed','exchange filing','press release'];


// These patterns are deliberately conservative. ABG Pulse should surface an
// underlying corporate development, not every article that happens to mention
// an ABG-listed security or every public question about an ABG brand.
const ROUTINE_MARKET_PATTERNS = [
  /\b(stocks?|shares?)\s+to\s+(buy|sell|watch)\b/,
  /\b(buy|sell|hold)\s+(call|rating|recommendation)\b/,
  /\btarget\s+price\b/,
  /\bprice\s+target\b/,
  /\bshare\s+price\s+(target|forecast|prediction|today|outlook)\b/,
  /\b(multibagger|intraday|technical\s+analysis|trading\s+strategy)\b/,
  /\b(top|best)\s+\d*\s*(stocks?|shares?)\b/,
  /\bmarket\s+(movers?|roundup|wrap|live)\b/,
  /\b(brokerage|analyst)\s+(call|pick|recommendation)\b/,
  /\bshould\s+(you|i|investors?)\s+(buy|sell|hold)\b/
];

const PURE_PRICE_MOVEMENT_PATTERNS = [
  /\bshares?\s+(rise|rises|rose|fall|falls|fell|jump|jumps|surge|surges|slip|slips|gain|gains|drop|drops)\b/,
  /\bstock\s+(rise|rises|rose|fall|falls|fell|jump|jumps|surge|surges|slip|slips|gain|gains|drop|drops)\b/
];

const CORPORATE_EVENT_PATTERNS = [
  /\b(announces?|announced|discloses?|disclosed|filing|results?|revenue|profit|loss|ebitda)\b/,
  /\b(acquisition|acquires?|merger|stake|divest|sale|funding|financing|investment|capex)\b/,
  /\b(appoints?|appointed|resigns?|resigned|chairman|chief executive|ceo|cfo|managing director|board)\b/,
  /\b(sebi|rbi|trai|cci|nclt|nclat|court|regulator|penalty|fine|probe|investigation|order)\b/,
  /\b(plant|capacity|commissioned|launches?|launched|partnership|contract|spectrum|subscriber)\b/,
  /\b(accident|fatal|fire|strike|protest|recall|breach|fraud|allegation)\b/,
  /\b(upgrade|downgrade|credit rating|sustainability|renewable|emission)\b/
];

const PUBLIC_QUESTION_PATTERNS = [
  /^(why|what|when|where|who|how|is|are|do|does|did|can|could|should|would|has|have)\b/,
  /\b(anyone|thoughts|opinion|review|experience|help|advice)\b/,
  /\?$/
];

const TOKEN_CANONICAL = new Map([
  ['commissions','commission'],['commissioned','commission'],['opens','commission'],['opened','commission'],['open','commission'],
  ['facility','plant'],['facilities','plant'],['rollout','expansion'],['expands','expansion'],['expanded','expansion'],
  ['accelerates','acceleration'],['accelerated','acceleration'],['targets','target'],['plans','plan'],['planning','plan'],
  ['precipitated','ppt'],['aluminium','aluminum'],['cities','city']
]);

export function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9₹$%+.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map((token) => TOKEN_CANONICAL.get(token) || token);
}

export function jaccardSimilarity(left = '', right = '') {
  const a = new Set(titleTokens(left));
  const b = new Set(titleTokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function parseGdeltDate(value) {
  if (!value) return new Date(Number.NaN);
  const raw = String(value).replace(/[^0-9]/g, '');
  if (raw.length >= 14) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    const hh = raw.slice(8, 10);
    const mm = raw.slice(10, 12);
    const ss = raw.slice(12, 14);
    const date = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(Number.NaN) : parsed;
}

export function articleAgeHours(article = {}, now = new Date()) {
  const published = parseGdeltDate(article.publishedAt || article.seendate);
  return (new Date(now).getTime() - published.getTime()) / 36e5;
}

export function isFreshArticle(article = {}, { now = new Date(), maxHours = 96, futureToleranceHours = 12 } = {}) {
  const age = articleAgeHours(article, now);
  return Number.isFinite(age) && age >= -futureToleranceHours && age <= maxHours;
}

export function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function sourceTier(domain = '', registry = []) {
  const normalized = String(domain).replace(/^www\./, '').toLowerCase();
  const match = registry.find((entry) => normalized === entry.domain || normalized.endsWith(`.${entry.domain}`));
  if (match) return match.tier;
  if (/^(nseindia|bseindia|sebi|rbi|trai|cci|sec)\./.test(normalized)) return 0;
  if (/adityabirla|hindalco|grasim|ultratechcement|novelis|myvi|adityabirlacapital|abfrl/.test(normalized)) return 0;
  if (/reuters|bloomberg|ft\.com|wsj|business-standard|economictimes|livemint|moneycontrol|businessline|cnbctv18|ndtv/.test(normalized)) return 1;
  return 3;
}

export function matchEntities(text = '', entities = []) {
  const normalized = ` ${normalizeText(text)} `;

  const matchAlias = (entity) => {
    const aliases = [entity.name, ...(entity.aliases || [])]
      .map(normalizeText)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (!pattern.test(normalized)) continue;

      // Very short aliases and explicitly ambiguous entities must carry ABG/business context.
      // A full personal name can still collide with an unrelated person, so ambiguity
      // is an entity-level property rather than a one-word-only property.
      const contextNeeded = alias.length <= 4 || Boolean(entity.ambiguous);
      if (contextNeeded) {
        const contextTerms = (entity.contextRequired || []).map(normalizeText).filter(Boolean);
        const parent = entities.find((candidate) => candidate.id === entity.parentId);
        const parentTerms = parent
          ? [parent.name, ...(parent.aliases || [])].map(normalizeText).filter((term) => term.length > 3)
          : [];
        const hasContext = [...contextTerms, ...parentTerms, 'aditya birla']
          .some((term) => Boolean(term) && (normalized.includes(` ${term} `) || normalized.includes(term)));
        if (!hasContext) continue;
      }
      return alias;
    }
    return '';
  };

  const primary = [];
  for (const entity of entities.filter((item) => item.type !== 'stakeholder')) {
    const matchedAlias = matchAlias(entity);
    if (matchedAlias) primary.push({ ...entity, matchedAlias });
  }

  // Stakeholders are relevant only when an ABG entity is also present. This prevents
  // generic RBI/SEBI/NSE stories from polluting the feed.
  const hasAbgContext = primary.some((entity) => entity.type !== 'stakeholder') || normalized.includes(' aditya birla ');
  if (!hasAbgContext) return primary;

  const stakeholderMatches = [];
  for (const entity of entities.filter((item) => item.type === 'stakeholder')) {
    const matchedAlias = matchAlias(entity);
    if (matchedAlias) stakeholderMatches.push({ ...entity, matchedAlias });
  }
  return [...primary, ...stakeholderMatches];
}


export function assessArticleSignal(article = {}, entities = [], sources = []) {
  const title = normalizeText(article.title || '');
  const description = normalizeText(article.description || '');
  const combined = `${title} ${description}`.trim();
  const titleEntities = matchEntities(article.title || '', entities).filter((entity) => entity.type !== 'stakeholder');
  const textEntities = matchEntities(`${article.title || ''} ${article.description || ''}`, entities).filter((entity) => entity.type !== 'stakeholder');
  const hintedEntities = (article.entityHints || [])
    .map((id) => entities.find((entity) => entity.id === id))
    .filter((entity) => entity && entity.type !== 'stakeholder');
  const combinedEntities = [...new Map([...textEntities, ...hintedEntities].map((entity) => [entity.id, entity])).values()];
  const tier = sourceTier(article.domain || domainFromUrl(article.url), sources);
  const official = Boolean(article.official) || tier === 0;
  const hasCorporateEvent = CORPORATE_EVENT_PATTERNS.some((pattern) => pattern.test(combined));
  const routineMarket = ROUTINE_MARKET_PATTERNS.some((pattern) => pattern.test(title));
  const purePriceMove = PURE_PRICE_MOVEMENT_PATTERNS.some((pattern) => pattern.test(title)) && !hasCorporateEvent;
  const publicQuestion = article.channel === 'public-conversation' && PUBLIC_QUESTION_PATTERNS.some((pattern) => pattern.test(title));

  if (!combinedEntities.length) {
    return { includeAsNews: false, includeAsSentiment: false, reason: 'no_abg_entity', entities: [] };
  }
  if (article.channel === 'public-conversation') {
    return {
      includeAsNews: false,
      // Public conversation can inform observed sentiment only when the ABG
      // entity is explicit in the title and the item is not a generic question.
      includeAsSentiment: titleEntities.length > 0 && !publicQuestion,
      reason: publicQuestion ? 'public_question' : (titleEntities.length ? 'public_sentiment_only' : 'weak_public_context'),
      entities: combinedEntities
    };
  }
  if (routineMarket && !official) {
    return { includeAsNews: false, includeAsSentiment: false, reason: 'routine_market_advice', entities: combinedEntities };
  }
  if (purePriceMove && !official) {
    return { includeAsNews: false, includeAsSentiment: false, reason: 'price_movement_without_event', entities: combinedEntities };
  }
  if (!titleEntities.length && !official) {
    return { includeAsNews: false, includeAsSentiment: false, reason: 'entity_only_in_snippet', entities: combinedEntities };
  }
  return { includeAsNews: true, includeAsSentiment: false, reason: official ? 'official' : 'direct_entity_news', entities: combinedEntities };
}

export function attachRelatedPublicConversation(mediaClusters = [], publicArticles = [], entities = []) {
  if (!publicArticles.length) return mediaClusters.map((cluster) => [...cluster]);
  return mediaClusters.map((cluster) => {
    const mediaEntityIds = new Set(matchEntities(
      cluster.map((article) => `${article.title || ''} ${article.description || ''}`).join(' '),
      entities
    ).filter((entity) => entity.type !== 'stakeholder').map((entity) => entity.id));
    const attached = publicArticles.filter((article) => {
      const publicIds = matchEntities(`${article.title || ''} ${article.description || ''}`, entities)
        .filter((entity) => entity.type !== 'stakeholder')
        .map((entity) => entity.id);
      if (!publicIds.some((id) => mediaEntityIds.has(id))) return false;
      // Entity overlap is necessary but not enough: require event-language
      // overlap so generic brand chatter cannot distort a specific event.
      return cluster.some((media) => articlesRelated(article, media, entities));
    });
    return [...cluster, ...attached];
  });
}

export function uniqueDomains(articles = []) {
  return [...new Set(articles.map((article) => article.domain || domainFromUrl(article.url)).filter(Boolean))];
}

function articlesRelated(a, b, entities = []) {
  const similarity = jaccardSimilarity(a.title, b.title);
  const involvesPublicConversation = a.channel === 'public-conversation' || b.channel === 'public-conversation';
  if (similarity >= (involvesPublicConversation ? 0.72 : 0.64)) return true;
  const aEntities = new Set(matchEntities(a.title, entities).map((entity) => entity.id));
  const bEntities = new Set(matchEntities(b.title, entities).map((entity) => entity.id));
  const sharedEntity = [...aEntities].some((id) => bEntities.has(id));
  if (!sharedEntity) return false;
  const aTokens = new Set(titleTokens(a.title));
  const bTokens = new Set(titleTokens(b.title));
  const sharedTokens = [...aTokens].filter((token) => bTokens.has(token));
  const sharedMeaningful = sharedTokens.length;
  const sharedNumericAnchor = sharedTokens.some((token) => /^\d/.test(token));
  if (involvesPublicConversation) {
    if (sharedMeaningful >= 5 && similarity >= 0.48) return true;
    return sharedMeaningful >= 4 && similarity >= 0.42 && sharedNumericAnchor;
  }
  if (sharedMeaningful >= 4 && similarity >= 0.42) return true;
  return sharedMeaningful >= 3 && similarity >= 0.34 && sharedNumericAnchor;
}

export function clusterArticles(articles = [], entities = []) {
  const sorted = [...articles].sort((a, b) => (parseGdeltDate(b.publishedAt || b.seendate).getTime() || 0) - (parseGdeltDate(a.publishedAt || a.seendate).getTime() || 0));
  const clusters = [];
  for (const article of sorted) {
    let target = null;
    for (const cluster of clusters) {
      if (cluster.some((existing) => articlesRelated(article, existing, entities))) {
        target = cluster;
        break;
      }
    }
    if (target) target.push(article);
    else clusters.push([article]);
  }
  return clusters;
}

export function mediaTone(text = '', externalTone = null) {
  if (externalTone !== null && externalTone !== undefined && externalTone !== '') {
    const numeric = Number(String(externalTone).split(',')[0]);
    if (Number.isFinite(numeric)) return Math.round(clamp(numeric * 8, -100, 100));
  }
  const normalized = normalizeText(text);
  let score = 0;
  for (const word of POSITIVE) if (normalized.includes(word)) score += 7;
  for (const word of NEGATIVE) if (normalized.includes(word)) score -= 8;
  return Math.round(clamp(score, -100, 100));
}

export function materialityScore({ text = '', entities = [], sourceCount = 1, sourceTierValue = 3 } = {}) {
  const normalized = normalizeText(text);
  let score = 8;
  for (const [term, weight] of MATERIALITY_TERMS) if (normalized.includes(term)) score += weight;
  const highestEntityTier = entities.length ? Math.min(...entities.map((entity) => entity.tier ?? 4)) : 4;
  score += [24, 18, 13, 8, 3][highestEntityTier] || 0;
  score += Math.min(18, Math.log2(Math.max(1, sourceCount)) * 7);
  score += sourceTierValue === 0 ? 18 : sourceTierValue === 1 ? 10 : sourceTierValue === 2 ? 5 : 0;
  return Math.round(clamp(score));
}

export function certaintyScore({ text = '', sourceCount = 1, sourceTierValue = 3, official = false } = {}) {
  const normalized = normalizeText(text);
  let score = official || sourceTierValue === 0 ? 88 : sourceTierValue === 1 ? 68 : sourceTierValue === 2 ? 56 : 42;
  // Distinct domains improve confidence, but do not automatically prove independent
  // corroboration because syndicated copies may share the same origin.
  score += Math.min(8, Math.max(0, sourceCount - 1) * 2);
  for (const term of CERTAINTY_UP) if (normalized.includes(term)) score += 4;
  for (const term of CERTAINTY_DOWN) if (normalized.includes(term)) score -= 6;
  return Math.round(clamp(score));
}

export function momentumScore({ articles = [], now = new Date() } = {}) {
  if (!articles.length) return 0;
  let recent6 = 0;
  let recent24 = 0;
  let previous24 = 0;
  for (const article of articles) {
    const ageHours = (now - parseGdeltDate(article.publishedAt || article.seendate)) / 36e5;
    if (ageHours <= 6) recent6 += 1;
    if (ageHours <= 24) recent24 += 1;
    else if (ageHours <= 48) previous24 += 1;
  }
  const diversity = uniqueDomains(articles).length;
  const acceleration = previous24 ? recent24 / previous24 : recent24 > 1 ? 2 : 1;
  const score = recent6 * 10 + recent24 * 3 + diversity * 6 + Math.min(25, acceleration * 8);
  return Math.round(clamp(score));
}

export function trendChange({ articles = [], now = new Date() } = {}) {
  let current = 0;
  let previous = 0;
  for (const article of articles) {
    const ageHours = (now - parseGdeltDate(article.publishedAt || article.seendate)) / 36e5;
    if (ageHours <= 12) current += 1;
    else if (ageHours <= 24) previous += 1;
  }
  if (previous === 0) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

export function predictImportance({ materiality = 0, momentum = 0, certainty = 0, sourceCount = 1, seniority = 0, narrativeRisk = 0 } = {}) {
  const raw = -4.2 + materiality * 0.035 + momentum * 0.028 + certainty * 0.011 + Math.min(12, sourceCount) * 0.08 + seniority * 0.16 + narrativeRisk * 0.018;
  const p24 = Math.round(clamp(logistic(raw) * 100));
  const p6 = Math.round(clamp(p24 * 0.66 + momentum * 0.18));
  const p72 = Math.round(clamp(p24 + (100 - p24) * 0.28));
  const drivers = [];
  if (momentum >= 65) drivers.push('rapid media acceleration');
  if (sourceCount >= 5) drivers.push('broad independent-source pickup');
  if (materiality >= 75) drivers.push('high strategic or reputation consequence');
  if (certainty < 55) drivers.push('uncertainty may drive further coverage');
  if (seniority >= 4) drivers.push('promoter or senior-leadership involvement');
  if (narrativeRisk >= 65) drivers.push('narrative drift or misattribution risk');
  if (!drivers.length) drivers.push('incremental relevance with limited momentum');
  let posture = 'NO ACTION';
  if (p24 >= 82) posture = 'ACT NOW';
  else if (p24 >= 68) posture = 'PREPARE';
  else if (p24 >= 48) posture = 'WATCH';
  else if (materiality >= 55 && mediaTone('', 2) > 0) posture = 'AMPLIFY';
  return { p6, p24, p72, drivers, posture };
}

export function classifyBucket({ materiality = 0, certainty = 0, momentum = 0, p24 = 0, immediate = false } = {}) {
  if ((materiality >= 76 && certainty >= 58) || (immediate && materiality >= 64) || (materiality >= 68 && momentum >= 72 && certainty >= 50)) return 'must';
  // Uncertainty by itself is not news. It can lower confidence, but it must not
  // manufacture urgency. Watch requires consequence, momentum, or a forecast
  // supported by those signals.
  if (p24 >= 58 || materiality >= 58 || (momentum >= 65 && certainty >= 50)) return 'watch';
  return 'other';
}

export function narrativeDriftScore({ headline = '', officialFrame = '', entityMatches = [], sourceCount = 1 } = {}) {
  const h = normalizeText(headline);
  const f = normalizeText(officialFrame);
  if (!officialFrame) return { score: 0, risk: 'LOW', reasons: [] };
  const overlap = jaccardSimilarity(h, f);
  let score = Math.round((1 - overlap) * 55);
  const people = entityMatches.filter((entity) => entity.type === 'person');
  const companies = entityMatches.filter((entity) => ['group','company','business'].includes(entity.type));
  const reasons = [];
  if (people.length && !companies.length) {
    score += 22;
    reasons.push('personality is displacing the institutional frame');
  }
  if (/owner|owns|bought|acquired/.test(h) && !/consortium|group|company/.test(h)) {
    score += 18;
    reasons.push('ownership is being simplified or misattributed');
  }
  if (sourceCount >= 5) score += 8;
  if (overlap < 0.25) reasons.push('emerging headlines differ materially from the verified frame');
  score = Math.round(clamp(score));
  return { score, risk: score >= 72 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW', reasons };
}

export function statusFromCertainty(certainty, official = false) {
  if (official || certainty >= 82) return 'confirmed';
  if (certainty >= 62) return 'strong';
  return 'developing';
}

export function formatLiveArticle(raw = {}) {
  const domain = raw.domain || domainFromUrl(raw.url);
  const parsedDate = parseGdeltDate(raw.seendate || raw.publishedAt || raw.updatedAt);
  return {
    id: raw.url || `${domain}-${raw.seendate || raw.publishedAt || 'undated'}-${raw.title}`,
    title: raw.title || 'Untitled source item',
    description: raw.description || raw.summary || raw.snippet || '',
    url: raw.url || '#',
    domain,
    publishedAt: Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString(),
    tone: raw.tone ?? null,
    language: raw.language || 'English',
    sourceCountry: raw.sourcecountry || raw.sourceCountry || '',
    sourceName: raw.sourceName || raw.source || domain,
    provider: raw.provider || raw.queryGroup || 'Open web',
    queryGroup: raw.queryGroup || '',
    official: Boolean(raw.official),
    sourceId: raw.sourceId || '',
    entityHints: Array.isArray(raw.entityHints) ? raw.entityHints : [],
    channel: raw.channel || (/reddit/i.test(raw.provider || '') ? 'public-conversation' : 'news'),
    engagement: Number(raw.engagement || raw.score || 0) || 0,
    image: raw.socialimage || raw.image || ''
  };
}

function cleanSnippet(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function truncateWords(value = '', limit = 42) {
  const words = cleanSnippet(value).split(/\s+/).filter(Boolean);
  return words.length > limit ? `${words.slice(0, limit).join(' ')}…` : words.join(' ');
}

export function observedPublicSentiment(articles = []) {
  const publicItems = articles.filter((article) => article.channel === 'public-conversation' || /reddit|public conversation/i.test(article.provider || ''));
  if (!publicItems.length) return {
    score: null, sampleSize: 0, channelCount: 0, confidence: 'unavailable', coverage: 'No open-public conversation samples in this event.'
  };
  const channels = new Set(publicItems.map((item) => item.provider || item.domain || 'open-public'));
  const weighted = publicItems.map((item) => {
    const weight = Math.max(1, Math.min(5, 1 + Math.log2(1 + Math.max(0, Number(item.engagement || 0)))));
    return { score: mediaTone(`${item.title || ''} ${item.description || ''}`, item.tone), weight };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / Math.max(1, totalWeight));
  const sampleSize = publicItems.length;
  const confidence = sampleSize >= 25 && channels.size >= 2 ? 'high' : sampleSize >= 8 ? 'medium' : 'low';
  return {
    score,
    sampleSize,
    channelCount: channels.size,
    confidence,
    coverage: `${sampleSize} accessible public-conversation sample${sampleSize === 1 ? '' : 's'} across ${channels.size} channel${channels.size === 1 ? '' : 's'}. Closed-platform coverage is not implied.`
  };
}

function safeLiveSummary({ lead, domains, official, entityName }) {
  const snippet = truncateWords(lead.description || '', 38);
  const opening = official
    ? `An official source has published this development concerning ${entityName}.`
    : `Published coverage across ${domains.length} distinct source domain${domains.length === 1 ? '' : 's'} identifies this development concerning ${entityName}.`;
  const detail = snippet && !normalizeText(snippet).includes(normalizeText(lead.title).slice(0, 36)) ? ` ${snippet}` : '';
  return `${opening}${detail} ABG Pulse has grouped the available items as one event and retained every source link for verification. Live discovery may expose only headlines or short extracts, so details that are not consistent across the evidence remain unconfirmed rather than being completed by the system.`;
}

export function deriveLiveEvent(cluster = [], { entities = [], sources = [], now = new Date() } = {}) {
  if (!cluster.length) return null;
  const ranked = [...cluster].sort((a, b) => {
    const ta = sourceTier(a.domain || domainFromUrl(a.url), sources);
    const tb = sourceTier(b.domain || domainFromUrl(b.url), sources);
    if (ta !== tb) return ta - tb;
    return (parseGdeltDate(b.publishedAt).getTime() || 0) - (parseGdeltDate(a.publishedAt).getTime() || 0);
  });
  const mediaArticles = ranked.filter((article) => article.channel !== 'public-conversation');
  if (!mediaArticles.length) return null;
  const publicArticles = ranked.filter((article) => article.channel === 'public-conversation');
  const lead = mediaArticles[0];
  const allText = mediaArticles.map((article) => `${article.title || ''} ${article.description || ''}`).join(' ');
  const textEntityMatches = matchEntities(allText, entities);
  const hintedEntityMatches = mediaArticles
    .flatMap((article) => article.entityHints || [])
    .map((id) => entities.find((entity) => entity.id === id))
    .filter(Boolean);
  const entityMatches = [...new Map([...textEntityMatches, ...hintedEntityMatches].map((entity) => [entity.id, entity])).values()];
  const primaryEntities = entityMatches.filter((entity) => entity.type !== 'stakeholder');
  if (!primaryEntities.length) return null;
  // Public-conversation samples may describe sentiment, but they never count as
  // corroborating news domains, momentum, certainty or materiality evidence.
  const domains = uniqueDomains(mediaArticles);
  const tiers = mediaArticles.map((article) => sourceTier(article.domain || domainFromUrl(article.url), sources));
  const bestTier = tiers.length ? Math.min(...tiers) : 3;
  const officialArticles = mediaArticles.filter((article) => article.official || sourceTier(article.domain || domainFromUrl(article.url), sources) === 0);
  const official = officialArticles.length > 0;
  const materiality = materialityScore({ text: allText, entities: primaryEntities, sourceCount: domains.length, sourceTierValue: bestTier });
  const certainty = certaintyScore({ text: allText, sourceCount: domains.length, sourceTierValue: bestTier, official });
  const momentum = momentumScore({ articles: mediaArticles, now });
  const change = trendChange({ articles: mediaArticles, now });
  const toneBase = mediaArticles;
  const toneValues = toneBase.map((article) => mediaTone(`${article.title || ''} ${article.description || ''}`, article.tone));
  const tone = Math.round(toneValues.reduce((sum, value) => sum + value, 0) / Math.max(1, toneValues.length));
  const publicSentiment = observedPublicSentiment(publicArticles);
  const seniority = primaryEntities.reduce((max, entity) => Math.max(max, entity.type === 'person' ? 5 - (entity.tier ?? 4) : 0), 0);

  const officialFrame = officialArticles[0]?.title || '';
  const emergingArticle = mediaArticles.find((article) => !officialArticles.includes(article));
  const emergingFrame = emergingArticle?.title || lead.title;
  const drift = officialFrame && emergingFrame && normalizeText(officialFrame) !== normalizeText(emergingFrame)
    ? narrativeDriftScore({ headline: emergingFrame, officialFrame, entityMatches: primaryEntities, sourceCount: domains.length })
    : { score: 0, risk: 'LOW', reasons: [] };

  const forecast = predictImportance({ materiality, momentum, certainty, sourceCount: domains.length, seniority, narrativeRisk: drift.score });
  const bucket = classifyBucket({
    materiality, certainty, momentum, p24: forecast.p24,
    immediate: /court|regulator|resign|accident|fatal|fraud|probe|fire|strike/.test(normalizeText(allText))
  });
  const validTimes = mediaArticles.map((article) => parseGdeltDate(article.publishedAt).getTime()).filter(Number.isFinite);
  const firstReported = validTimes.length ? Math.min(...validTimes) : new Date(now).getTime();
  const lastReported = validTimes.length ? Math.max(...validTimes) : new Date(now).getTime();
  const primaryName = primaryEntities[0]?.name || 'Aditya Birla Group';

  const event = {
    id: `live-${hashString(normalizeText(lead.title))}`,
    headline: lead.title,
    summary: safeLiveSummary({ lead, domains, official, entityName: primaryName }),
    whyItMatters: explainWhy({ materiality, momentum, entityMatches: primaryEntities, headline: lead.title }),
    bucket,
    status: statusFromCertainty(certainty, official),
    category: inferCategory(allText),
    entityIds: entityMatches.map((entity) => entity.id),
    publishedAt: new Date(firstReported).toISOString(),
    updatedAt: new Date(lastReported).toISOString(),
    sources: [...mediaArticles, ...publicArticles].slice(0, 16).map((article) => ({
      name: article.sourceName || article.domain,
      url: article.url,
      publishedAt: article.publishedAt,
      tier: sourceTier(article.domain, sources),
      provider: article.provider || 'Open web',
      channel: article.channel || 'news',
      official: Boolean(article.official)
    })),
    sourceCount: domains.length,
    intelligence: {
      materiality,
      certainty,
      momentum,
      trendChange: change,
      sentiment: tone,
      mediaTone: tone,
      publicSentiment,
      reputationImpact: Math.round(clamp(tone * 0.55 + (materiality - 50) * 0.18, -100, 100)),
      narrativeAlignment: Math.max(0, 100 - drift.score),
      prediction: forecast
    },
    flags: ['live-signal', 'headline-derived', ...(publicArticles.length ? ['open-public-sentiment'] : [])],
    live: true
  };

  if (officialFrame && drift.score >= 35) {
    event.narrative = {
      officialFrame,
      emergingFrame,
      score: drift.score,
      risk: drift.risk,
      reasons: drift.reasons,
      recommendation: drift.score >= 72
        ? 'Clarify the verified institutional frame before the shorthand hardens.'
        : 'Monitor the framing and prepare a fact-based clarification if divergence accelerates.'
    };
  }
  return event;
}

export function inferCategory(text = '') {
  const t = normalizeText(text);
  const map = [
    ['Leadership', /chairman|ceo|cfo|md |director|appointed|resign/],
    ['Regulatory', /sebi|rbi|trai|cci|regulator|court|nclt|nclat|tax/],
    ['Financial', /results|revenue|profit|loss|ebitda|loan|financing|debt|rating/],
    ['M&A', /acquisition|acquire|merger|stake|buyout|sale/],
    ['Operations', /plant|capacity|commission|factory|mine|smelter|network|5g/],
    ['Brand', /campaign|brand|launch|customer|consumer|retail/],
    ['Reputation', /controversy|fraud|probe|accident|fire|strike|protest|narrative/],
    ['Sustainability', /esg|renewable|sustainable|green|emission|certification/],
    ['Technology', /ai |artificial intelligence|digital|technology|virtual/]
  ];
  return map.find(([, pattern]) => pattern.test(t))?.[0] || 'Corporate';
}

export function explainWhy({ materiality = 0, momentum = 0, entityMatches = [], headline = '' } = {}) {
  const entity = entityMatches[0]?.name || 'ABG';
  const normalized = normalizeText(headline);
  if (/court|sebi|rbi|trai|cci|regulator|nclt|tax/.test(normalized)) return `This could affect ${entity}'s regulatory, legal or financial position and merits verified senior-level awareness.`;
  if (/acquisition|merger|stake|financing|loan|investment/.test(normalized)) return `This may alter ${entity}'s capital allocation, ownership or strategic growth trajectory.`;
  if (/ceo|cfo|chairman|director|resign|appointed/.test(normalized)) return `Senior-leadership developments can change governance, accountability and external narrative around ${entity}.`;
  if (/accident|fire|fraud|probe|strike|protest/.test(normalized)) return `The development may create operational or reputation exposure; facts and response posture should be reviewed quickly.`;
  if (momentum >= 65) return `Coverage is accelerating across independent sources and may become more consequential even if the underlying facts remain unchanged.`;
  if (materiality >= 65) return `The subject has sufficient strategic, financial or reputation consequence to change today's picture of ${entity}.`;
  return `Relevant to the Group record, but it does not yet materially change today's operating or reputation picture.`;
}

export function hashString(value = '') {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function dedupeEvents(events = []) {
  const seen = new Set();
  const output = [];
  for (const event of events) {
    const key = event.id || normalizeText(event.headline);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

export function sortEvents(events = []) {
  const bucketWeight = { must: 3, watch: 2, other: 1 };
  return [...events].sort((a, b) => {
    const bucketDiff = (bucketWeight[b.bucket] || 0) - (bucketWeight[a.bucket] || 0);
    if (bucketDiff) return bucketDiff;
    const materialityDiff = (b.intelligence?.materiality || 0) - (a.intelligence?.materiality || 0);
    if (materialityDiff) return materialityDiff;
    return new Date(b.updatedAt || b.publishedAt) - new Date(a.updatedAt || a.publishedAt);
  });
}

/**
 * Resolve a user-selected reporting period into an exact UTC window.
 * The default timezone offset is IST (+05:30) because ABG Pulse is an India-first product.
 */
export function resolvePeriodWindow(preset = '24h', {
  now = new Date(),
  lastOpened = null,
  customStart = null,
  customEnd = null,
  timezoneOffsetMinutes = 330
} = {}) {
  const safeNow = validDate(now) || new Date();
  let end = validDate(customEnd) || safeNow;
  let start;
  const durations = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };

  if (preset === 'custom') {
    start = validDate(customStart) || new Date(end.getTime() - durations['24h']);
  } else if (preset === 'since-last-visit') {
    const candidate = validDate(lastOpened);
    start = candidate && candidate < end ? candidate : new Date(end.getTime() - durations['24h']);
  } else if (preset === 'today') {
    start = startOfDayAtOffset(end, timezoneOffsetMinutes);
  } else {
    start = new Date(end.getTime() - (durations[preset] || durations['24h']));
  }

  if (start >= end) {
    const swap = start;
    start = end;
    end = swap;
  }

  return {
    preset,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMs: end.getTime() - start.getTime(),
    timezoneOffsetMinutes
  };
}

export function previousPeriodWindow(window = {}) {
  const start = validDate(window.start);
  const end = validDate(window.end);
  if (!start || !end || start >= end) return null;
  const durationMs = end.getTime() - start.getTime();
  return {
    preset: 'previous',
    start: new Date(start.getTime() - durationMs).toISOString(),
    end: start.toISOString(),
    durationMs,
    timezoneOffsetMinutes: window.timezoneOffsetMinutes ?? 330
  };
}

export function eventOccursInWindow(event = {}, window = {}) {
  const start = validDate(window.start)?.getTime();
  const end = validDate(window.end)?.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const timestamps = [event.publishedAt, event.updatedAt]
    .map((value) => validDate(value)?.getTime())
    .filter(Number.isFinite);
  return timestamps.some((timestamp) => timestamp >= start && timestamp <= end);
}

export function filterEventsByWindow(events = [], window = {}) {
  return events.filter((event) => eventOccursInWindow(event, window));
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDayAtOffset(date, timezoneOffsetMinutes) {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60 * 1000);
  const utcStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(utcStart - timezoneOffsetMinutes * 60 * 1000);
}
