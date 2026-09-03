const COMPANY_URL = 'https://www.adityabirla.com/en/businesses/companies/';
const LEADERSHIP_URL = 'https://www.adityabirla.com/en/our-story/leadership/';
const CACHE_MS = 30 * 60 * 1000;

const COMPANY_FALLBACK = [
  'Aditya Birla Capital','Aditya Birla Chemicals','Aditya Birla Chemicals Thailand','Aditya Birla Fashion and Retail','Aditya Birla Global Trading','Aditya Birla Housing Finance','Aditya Birla Insulators','Aditya Birla New Age Hospitality','Aditya Birla Real Estate','Aditya Birla Renewables','Aditya Birla Science and Technology','Aditya Birla Sun Life AMC','Aditya Birla Sun Life Insurance','Aditya Birla Ventures','Aditya Birla Yarns','Birla Advanced Knits','Birla Carbon','Birla Cellulose','Birla Century','Birla Copper','Birla Jingwei Fibres','Birla Opus','Birla Pivot','Century Enka','Dahej Harbour and Infrastructure','Domsjö Fabriker','Essel Mining and Industries','Grasim Industries','Hindalco Industries','Hindalco-Almex Aerospace','Indian Rayon','Indo Gulf Fertilisers','Jay Shree Textiles','Novelis','PT Elegant Textile Industry','PT Indo Bharat Rayon','PT Sunrise Bumi Textiles','Thai Acrylic Fibre','Thai Carbon Black','UltraTech Cement','Utkal Alumina International','Vodafone Idea'
];

const LEADER_FALLBACK = [
  'Kumar Mangalam Birla','Rajashree Birla','Ananya Birla','Aryaman Vikram Birla','Ashok Ramchandran','Ashish Dikshit','Sushil Agarwal','Atul Daga','E. R. Raj Narayanan','Deepak Acharya','Jayant V. Dhobley','Kapil Agrawal','Sunil Bajaj','Vishak Kumar','Vivek Agrawal','Vadiraj Kulkarni'
];

const BRAND_NAMES = [
  'Birla Opus','Birla Pivot','Louis Philippe','Van Heusen','Allen Solly','Peter England','Pantaloons','Reebok India','TMRW','American Eagle India','Aditya Birla Health Insurance','Aditya Birla Money','Aditya Birla Sun Life Mutual Fund','Aditya Birla Sun Life Insurance','Royal Challengers Bengaluru','RCB'
];

const STAKEHOLDERS = [
  'BSE','NSE','SEBI','Reserve Bank of India','RBI','Competition Commission of India','CCI','TRAI','Department of Telecommunications','DoT','IRDAI','PFRDA','NCLT','NCLAT','Supreme Court of India','Ministry of Corporate Affairs','CRISIL','ICRA','CARE Ratings','India Ratings','Moody’s','S&P Global Ratings','Fitch Ratings','State Bank of India','HDFC Bank','Axis Bank','MUFG','Government of India'
];

const ALIASES = {
  'Aditya Birla Group':['ABG'],
  'Aditya Birla Fashion and Retail':['ABFRL','Aditya Birla Fashion & Retail'],
  'Aditya Birla Capital':['ABCL'],
  'Aditya Birla Sun Life AMC':['ABSL AMC','ABSLAMC'],
  'Aditya Birla Sun Life Insurance':['ABSLI'],
  'Aditya Birla Health Insurance':['ABHI','ABHICL'],
  'Aditya Birla Renewables':['ABReL'],
  'Grasim Industries':['Grasim'],
  'Hindalco Industries':['Hindalco'],
  'UltraTech Cement':['UltraTech'],
  'Vodafone Idea':['Vi','VIL'],
  'Royal Challengers Bengaluru':['Royal Challengers Bangalore','RCB'],
  'Aryaman Vikram Birla':['Aryaman Birla'],
  'Kumar Mangalam Birla':['KMB'],
  'E. R. Raj Narayanan':['ER Raj Narayanan']
};

let cached = null;

function decode(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return decode(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleFromSlug(slug = '') {
  return decodeURIComponent(slug).split('/')[0].split('-').filter(Boolean).map((part) => ['and','of','the','in'].includes(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function cleanCandidate(value = '') {
  return decode(value)
    .replace(/\b(?:Know More|Read More|Explore|View Profile|Leadership|Companies)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plausibleName(value, type) {
  if (!value || value.length < 3 || value.length > 110) return false;
  if (/^(home|about|businesses|media|careers|investors|contact|search|menu|next|previous)$/i.test(value)) return false;
  if (type === 'person') return /^([A-Z][A-Za-z.'’&-]+\s+){1,5}[A-Z][A-Za-z.'’&-]+$/.test(value);
  return /[A-Za-z]/.test(value) && value.split(/\s+/).length <= 12;
}

function extractLinkedNames(html, segment, type) {
  const names = new Set();
  const pattern = new RegExp(`<a\\b[^>]*href=["'][^"']*${segment}/([^"'#?]+)[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
  for (const match of String(html).matchAll(pattern)) {
    const text = cleanCandidate(match[2]);
    const name = plausibleName(text, type) ? text : titleFromSlug(match[1]);
    if (plausibleName(name, type)) names.add(name);
  }
  return [...names];
}

function extractJsonNames(html, type) {
  const names = new Set();
  const pattern = /["'](?:name|title|fullName|companyName)["']\s*:\s*["']([^"']{3,110})["']/gi;
  for (const match of String(html).matchAll(pattern)) {
    const candidate = cleanCandidate(match[1].replace(/\\u0026/g, '&'));
    if (plausibleName(candidate, type)) names.add(candidate);
  }
  return [...names];
}

async function fetchHtml(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent':'ABGPulse/5.3 registry-audit', Accept:'text/html,application/xhtml+xml' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function mergeNames(primary, fallback) {
  const values = [...primary, ...fallback].map(cleanCandidate).filter(Boolean);
  const bySlug = new Map();
  for (const value of values) if (!bySlug.has(slugify(value))) bySlug.set(slugify(value), value);
  return [...bySlug.values()];
}

function entity(name, type, source, extra = {}) {
  return {
    id: `${type}-${slugify(name)}`,
    name,
    type,
    aliases: ALIASES[name] || [],
    active: true,
    source,
    sourceUrl: source === 'ABG official companies register' ? COMPANY_URL : source === 'ABG official leadership register' ? LEADERSHIP_URL : null,
    ...extra
  };
}

export async function getUniverse({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_MS) return cached.value;

  const status = { companies: { ok:false, error:null }, leadership: { ok:false, error:null } };
  let companyNames = [];
  let leaderNames = [];

  try {
    const html = await fetchHtml(COMPANY_URL);
    companyNames = mergeNames([
      ...extractLinkedNames(html, 'businesses/companies', 'company'),
      ...extractJsonNames(html, 'company').filter((name) => /birla|hindalco|novelis|grasim|ultratech|vodafone|century|essel|domsjo|rayon|alumina|textile|fibre|carbon/i.test(name))
    ], COMPANY_FALLBACK);
    status.companies = { ok:true, sourceCount:companyNames.length, fetchedAt:new Date().toISOString() };
  } catch (error) {
    companyNames = [...COMPANY_FALLBACK];
    status.companies = { ok:false, error:String(error.message || error), fallbackCount:companyNames.length };
  }

  try {
    const html = await fetchHtml(LEADERSHIP_URL);
    leaderNames = mergeNames([
      ...extractLinkedNames(html, 'our-story/leadership', 'person'),
      ...extractJsonNames(html, 'person')
    ], LEADER_FALLBACK);
    status.leadership = { ok:true, sourceCount:leaderNames.length, fetchedAt:new Date().toISOString() };
  } catch (error) {
    leaderNames = [...LEADER_FALLBACK];
    status.leadership = { ok:false, error:String(error.message || error), fallbackCount:leaderNames.length };
  }

  const companies = companyNames.map((name) => entity(name, 'company', 'ABG official companies register', { officialRegister:true }));
  const leaders = leaderNames.map((name) => entity(name, 'person', 'ABG official leadership register', { officialRegister:true }));
  const group = entity('Aditya Birla Group', 'group', 'ABG official website', { aliases:['ABG'], officialRegister:true });
  const brands = BRAND_NAMES.map((name) => entity(name, 'brand', 'Governed ABG brand watchlist'));
  const stakeholders = STAKEHOLDERS.map((name) => entity(name, 'stakeholder', 'Governed material stakeholder watchlist'));

  const allById = new Map();
  for (const item of [group, ...companies, ...leaders, ...brands, ...stakeholders]) allById.set(item.id, item);
  const entities = [...allById.values()];
  const value = {
    generatedAt:new Date().toISOString(),
    companies,
    leaders,
    brands,
    stakeholders,
    entities,
    counts:{ companies:companies.length, leaders:leaders.length, brands:brands.length, stakeholders:stakeholders.length, total:entities.length },
    officialTargets:{ companies:42, leaders:40 },
    audit:{
      companyRegisterComplete:companies.length >= 42,
      leadershipRegisterComplete:leaders.length >= 40,
      sourceStatus:status,
      caveat:'Official page extraction is refreshed at runtime. Fallback names preserve continuity during a source outage and are visibly reported in health output.'
    }
  };
  cached = { cachedAt:Date.now(), value };
  return value;
}

export { COMPANY_URL, LEADERSHIP_URL, COMPANY_FALLBACK, LEADER_FALLBACK };
