import {
  dedupeEvents,
  sortEvents,
  normalizeText,
  titleTokens,
  matchEntities,
  formatLiveArticle,
  clusterArticles,
  deriveLiveEvent,
  domainFromUrl,
  resolvePeriodWindow,
  previousPeriodWindow,
  filterEventsByWindow,
  eventOccursInWindow
} from './core.mjs';

const STORAGE = {
  watched: 'abg-pulse:watched:v1',
  preferences: 'abg-pulse:preferences:v1',
  feedback: 'abg-pulse:feedback:v1',
  liveEvents: 'abg-pulse:live-events:v1',
  liveMeta: 'abg-pulse:live-meta:v2',
  knownEvents: 'abg-pulse:known-events:v1',
  lastOpened: 'abg-pulse:last-opened:v1',
  period: 'abg-pulse:period:v1'
};

const DEFAULT_PREFERENCES = {
  liveScan: true,
  showForecasts: true,
  reduceNoise: true
};

const REPORTING_TIMEZONE = 'Asia/Kolkata';
const REPORTING_OFFSET_MINUTES = 330;
const PERIOD_LABELS = {
  'since-last-visit': 'Since my last visit',
  '1h': 'Last 1 hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom period'
};

const state = {
  entities: [],
  sources: [],
  entityUniverse: {},
  buildPlan: {},
  demoEvents: [],
  demoMode: false,
  events: [],
  liveEvents: [],
  rawArticleCount: 0,
  currentView: 'today',
  searchFilter: 'all',
  searchQuery: '',
  watched: new Set(),
  feedback: [],
  preferences: { ...DEFAULT_PREFERENCES },
  liveStatus: 'idle',
  lastScanAt: null,
  liveMeta: {},
  newEventIds: new Set(),
  installPrompt: null,
  toastTimer: null,
  periodPreset: '24h',
  periodWindow: null,
  comparePeriod: false,
  previousOpenedAt: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeUrl(value = '') {
  try {
    const url = new URL(value, location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

function loadJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 6500);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function entityById(id) {
  return state.entities.find((entity) => entity.id === id);
}

function entitiesForEvent(event) {
  return (event.entityIds || []).map(entityById).filter(Boolean);
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unavailable';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const ranges = [
    ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size || unit === 'minute') return formatter.format(Math.round(seconds / size), unit);
  }
  return 'now';
}

function formatDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: REPORTING_TIMEZONE }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: REPORTING_TIMEZONE }).format(date);
}


function parseIstDateTimeLocal(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 16)}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIstDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() + REPORTING_OFFSET_MINUTES * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

function exactPeriodLabel(window = state.periodWindow) {
  if (!window) return 'Period unavailable';
  return `${formatDate(window.start, true)} – ${formatDate(window.end, true)} IST`;
}

function resolveSelectedPeriod(preset = state.periodPreset) {
  const customStart = preset === 'custom' ? parseIstDateTimeLocal($('#custom-period-start')?.value) : null;
  const customEnd = preset === 'custom' ? parseIstDateTimeLocal($('#custom-period-end')?.value) : null;
  return resolvePeriodWindow(preset, {
    now: new Date(),
    lastOpened: state.previousOpenedAt,
    customStart,
    customEnd,
    timezoneOffsetMinutes: REPORTING_OFFSET_MINUTES
  });
}

function periodEvents() {
  return sortEvents(filterEventsByWindow(visibleEvents(), state.periodWindow || resolveSelectedPeriod()));
}

function previousPeriodEvents() {
  const previous = previousPeriodWindow(state.periodWindow);
  return previous ? sortEvents(filterEventsByWindow(visibleEvents(), previous)) : [];
}

function evidenceSourcesForEvents(events = []) {
  const map = new Map();
  for (const event of events) {
    for (const source of event.sources || []) {
      const url = source.url ? safeUrl(source.url) : '#';
      const domain = url === '#' ? '' : domainFromUrl(url);
      const key = domain || normalizeText(source.name || 'unknown-source');
      if (!key || map.has(key)) continue;
      const registry = domain ? state.sources.find((item) => item.domain === domain || domain.endsWith(`.${item.domain}`)) : null;
      map.set(key, {
        name: source.name || registry?.name || domain || 'Unnamed source',
        domain,
        tier: source.tier ?? registry?.tier ?? 3,
        class: registry?.class || sourceClassFromTier(source.tier),
        provider: source.provider || ''
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name));
}

function sourceClassFromTier(tier) {
  if (Number(tier) === 0) return 'official';
  if (Number(tier) === 1) return 'major-media';
  if (Number(tier) === 2) return 'specialist-media';
  return 'discovery-index';
}

function coverageGroupForSource(source = {}) {
  const cls = source.class || sourceClassFromTier(source.tier);
  if (['official', 'official-filing'].includes(cls)) return 'Official company / IR';
  if (['exchange', 'regulator'].includes(cls)) return 'Exchanges & regulators';
  if (cls === 'major-media') return 'Major journalism';
  if (['specialist-media', 'regional'].includes(cls)) return 'Specialist & regional media';
  if (cls === 'discovery-index') return 'Open discovery';
  return 'Other evidence';
}

function coverageSnapshot(events = periodEvents()) {
  const configured = state.sources.filter((source) => source.active !== false);
  const evidence = evidenceSourcesForEvents(events);
  const groups = ['Official company / IR', 'Exchanges & regulators', 'Major journalism', 'Specialist & regional media', 'Open discovery', 'Other evidence']
    .map((name) => ({
      name,
      configured: configured.filter((source) => coverageGroupForSource(source) === name).length,
      evidence: evidence.filter((source) => coverageGroupForSource(source) === name).length
    }))
    .filter((group) => group.configured || group.evidence);
  const attemptedChecks = Number(state.liveMeta?.queryCount || 0);
  const successfulChecks = Number(state.liveMeta?.successfulQueries || 0);
  const errors = Array.isArray(state.liveMeta?.errors) ? state.liveMeta.errors : [];
  return { configured, evidence, groups, attemptedChecks, successfulChecks, errors };
}

function averageSentiment(events = []) {
  if (!events.length) return 0;
  return Math.round(events.reduce((sum, event) => sum + Number(event.intelligence?.sentiment || 0), 0) / events.length);
}

function signedDifference(value) {
  const number = Number(value) || 0;
  return `${number > 0 ? '+' : ''}${number}`;
}

function sourceItemCount(events = []) {
  return events.reduce((sum, event) => sum + getSourceCount(event), 0);
}

function periodPresetLabel(preset = state.periodPreset) {
  return PERIOD_LABELS[preset] || PERIOD_LABELS['24h'];
}

function scoreColor(score, type = 'standard') {
  if (type === 'sentiment') return score < 0 ? 'var(--red)' : score > 20 ? 'var(--sage)' : 'var(--slate)';
  if (score >= 75) return 'var(--wine)';
  if (score >= 55) return 'var(--amber)';
  return 'var(--slate)';
}


const METHODOLOGY = {
  must: { title: 'Must Know', lead: 'Materially changes today’s senior-management picture and is supported strongly enough to brief now.', formula: 'Must Know when materiality ≥76 and certainty ≥58; or an immediate high-impact event reaches materiality 64; or materiality ≥68 with momentum ≥72 and certainty ≥50.', note: 'Article volume alone cannot make a story Must Know.' },
  watch: { title: 'Watch', lead: 'May change tomorrow’s picture, is accelerating, or needs stronger confirmation.', formula: 'Watch when 24-hour importance ≥52%, materiality ≥58, momentum ≥62, or a relevant signal has certainty below 48.', note: 'Watch means prepare and verify—not automatically respond.' },
  other: { title: 'Other Developments', lead: 'Relevant to the ABG record, but does not change what a senior leader needs to know now.', formula: 'A relevant event that does not cross Must Know or Watch thresholds.', note: 'Most developments can correctly sit here. That is signal discipline.' },
  materiality: { title: 'Materiality', lead: 'Potential consequence for ABG—not the loudness of coverage.', formula: 'Weighted event type + entity seniority + source quality + source breadth, capped at 100.', note: 'This is decision support, not a SEBI materiality determination.' },
  certainty: { title: 'Certainty', lead: 'Strength of evidence supporting the factual core.', formula: 'Base by source tier + limited corroboration + confirmation terms − speculative language.', note: 'Several domains can still repeat one wire story, so count is not proof.' },
  momentum: { title: 'Momentum / Trending', lead: 'How quickly media attention is building in the selected period.', formula: 'Recent item volume + independent-source diversity + acceleration; capped at 100.', note: 'Momentum is attention, not importance or approval.' },
  sentiment: { title: 'Media Tone Score', lead: 'Positive or negative language used toward the relevant ABG entity in published coverage.', formula: 'Favourable and adverse language is normalised from −100 to +100. Radar uses materiality-weighted entity averages.', note: 'It is media language—not public opinion, reputation value or business impact.' },
  'public-sentiment': { title: 'Observed Public Sentiment', lead: 'Direction of accessible public-conversation language around an ABG event.', formula: 'Open-public posts are scored from −100 to +100 and weighted modestly by accessible engagement. Sample size, channel count and confidence are always shown.', note: 'This is not “full public sentiment”. X, LinkedIn, Instagram, YouTube comments and other closed-platform data require authorised or licensed access.' },
  narrative: { title: 'Narrative Drift', lead: 'Where emerging shorthand moves away from verified institutional facts.', formula: 'Headline/frame divergence + personality displacement + ownership simplification + source spread.', note: 'A drift signal asks for human review; it does not prescribe a response.' },
  forecast: { title: 'Likely to Become Important', lead: 'Heuristic probability that a story becomes more important in 6, 24 or 72 hours.', formula: 'Logistic model using materiality, momentum, certainty, source breadth, seniority and narrative risk.', note: 'Forecasts are decision support, never fact. They must be graded against later outcomes.' },
  coverage: { title: 'Coverage', lead: 'Separates what is registered, what was successfully checked and what actually supports an event.', formula: 'Registered ≠ checked ≠ evidence. Each is shown separately.', note: 'A healthy scan does not prove universal internet coverage.' },
  universe: { title: 'ABG Entity Universe', lead: 'The governed list of companies, people, brands, initiatives and material stakeholders that Pulse is designed to recognise.', formula: 'The company and leadership registers are reconciled to ABG’s official public pages; aliases, relationships and verification dates are stored with each entity.', note: 'Organisations and roles change. The verification date is therefore as important as the count.' },
  gaps: { title: 'What We May Have Missed', lead: 'Shows source failures, thin corroboration and visible coverage gaps.', formula: 'Post-scan checks inspect provider errors, entity-universe reconciliation, public-conversation availability and evidence quality.', note: 'No warning means no configured anomaly—not guaranteed completeness.' },
  audit: { title: 'Auditability', lead: 'Makes the path from event to score, label and source traceable.', formula: 'Entity → event → claim/evidence → intelligence score → classification.', note: 'Explainability cannot improve the quality of a weak source.' },
  scores: { title: 'How the Scores Work', lead: 'Each score answers a different question so consequence, truth, public response and attention are never confused.', formula: 'Materiality = consequence · Certainty = evidence · Momentum = attention · Media tone = published language · Observed public sentiment = accessible public conversation · Forecast = future importance · Drift = framing risk.', note: 'The platform exposes its rules rather than hiding heuristics behind “AI”.' },
  progress: { title: 'Job Meter', lead: 'Two numbers prevent activity from being confused with achievement: verified completion and implementation completed.', formula: 'Verified = weighted work with acceptance evidence. Built = weighted code or operating capability already implemented. The amber gap is built work still awaiting live or independent proof.', note: 'The verified number is the product truth. The built number shows momentum without pretending that unproven work is delivered.' }
};

function toneClass(value) {
  const number = Number(value) || 0;
  return number >= 25 ? 'positive' : number <= -25 ? 'negative' : 'neutral';
}

function toneLabel(value) {
  const number = Number(value) || 0;
  return number >= 25 ? 'Positive' : number <= -25 ? 'Negative' : 'Neutral / mixed';
}

function openMethodology(key = 'scores') {
  const method = METHODOLOGY[key] || METHODOLOGY.scores;
  const dialog = $('#methodology-dialog');
  $('#methodology-eyebrow').textContent = 'Transparent intelligence';
  $('#methodology-title').textContent = method.title;
  $('#methodology-body').innerHTML = `<p class="methodology-lead">${escapeHtml(method.lead)}</p><div class="methodology-grid"><div class="methodology-card"><span>What it answers</span><strong>${escapeHtml(method.lead)}</strong></div><div class="methodology-card"><span>How to use it</span><strong>Read it with evidence status, sample size and source links—not alone.</strong></div></div><div class="methodology-formula">${escapeHtml(method.formula)}</div><div class="methodology-note"><strong>Limitation:</strong> ${escapeHtml(method.note)}</div>`;
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function bindMethodology() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-method]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    openMethodology(target.dataset.method);
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target.closest?.('[data-method][role="button"]');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openMethodology(target.dataset.method);
    }
  });
}

function eventSearchText(event) {
  const names = entitiesForEvent(event).map((entity) => `${entity.name} ${(entity.aliases || []).join(' ')}`).join(' ');
  return normalizeText(`${event.headline} ${event.summary} ${event.whyItMatters} ${event.category} ${names} ${(event.flags || []).join(' ')}`);
}

function eventIsRoutineNoise(event) {
  const text = eventSearchText(event);
  return /share price|stock rises|stock falls|market today|trading call|technical chart/.test(text)
    && !/results|filing|acquisition|regulator|court|ceo|cfo|chairman/.test(text);
}

function visibleEvents() {
  const events = state.preferences.reduceNoise ? state.events.filter((event) => !eventIsRoutineNoise(event)) : state.events;
  return sortEvents(events);
}

function bucketLabel(bucket) {
  return bucket === 'must' ? 'Must know' : bucket === 'watch' ? 'Watch' : 'Other';
}

function statusLabel(status) {
  return status === 'confirmed' ? 'Confirmed' : status === 'strong' ? 'Strong reporting' : 'Developing';
}

function watchStateLabel(value) {
  const labels = {
    'new-update': 'New update',
    tracking: 'Tracking',
    'no-change': 'No material change',
    developing: 'Developing',
    'case-study': 'Case study',
    stable: 'Stable'
  };
  return labels[value] || 'Tracking';
}

function getSourceCount(event) {
  return Math.max(event.sourceCount || 0, event.sources?.length || 0);
}

function storyCard(event, { compact = false } = {}) {
  const entities = entitiesForEvent(event);
  const primaryEntities = entities.filter((entity) => entity.type !== 'stakeholder').slice(0, 3).map((entity) => entity.name).join(' · ');
  const intelligence = event.intelligence || {};
  const prediction = intelligence.prediction || {};
  const publicSentiment = intelligence.publicSentiment || {};
  const watched = state.watched.has(event.id);
  const sourceCount = getSourceCount(event);
  const publicPill = Number.isFinite(Number(publicSentiment.score)) && Number(publicSentiment.sampleSize) > 0
    ? `<span class="tone-pill ${toneClass(publicSentiment.score)}">Public ${signed(publicSentiment.score)} · n=${Number(publicSentiment.sampleSize)}</span>`
    : '';
  const scores = compact ? '' : `
    <aside class="story-score-rail" aria-label="Intelligence scores">
      <div class="score-stack">
        ${scoreItem('Materiality', intelligence.materiality ?? 0, 'materiality')}
        ${scoreItem('Momentum', intelligence.momentum ?? 0, 'momentum')}
        ${scoreItem('Certainty', intelligence.certainty ?? 0, 'certainty')}
        ${sentimentScoreItem(intelligence.mediaTone ?? intelligence.sentiment ?? 0)}
      </div>
      ${state.preferences.showForecasts ? `<div class="forecast-mini">24-hour importance<strong>${escapeHtml(prediction.p24 ?? 0)}%</strong></div>` : ''}
    </aside>`;

  return `
    <article class="story-card bucket-${escapeHtml(event.bucket || 'other')} ${event.live ? 'is-live' : ''}" data-event-id="${escapeHtml(event.id)}">
      <div class="story-main">
        <div class="story-meta">
          <span class="status-pill ${escapeHtml(event.status || 'developing')}">${escapeHtml(statusLabel(event.status))}</span>
          <span class="category-pill">${escapeHtml(event.category || 'Corporate')}</span>
          <span class="tone-pill ${toneClass(intelligence.mediaTone ?? intelligence.sentiment)}">Tone ${signed(intelligence.mediaTone ?? intelligence.sentiment)} · ${toneLabel(intelligence.mediaTone ?? intelligence.sentiment)}</span>
          ${publicPill}
          ${event.live ? '<span>Live discovery signal</span>' : ''}
          ${state.newEventIds.has(event.id) ? '<span class="new-pill">New since last visit</span>' : ''}
          <span>${escapeHtml(primaryEntities || 'Aditya Birla Group')}</span>
        </div>
        <h3>${escapeHtml(event.headline)}</h3>
        <p class="story-summary">${escapeHtml(event.summary)}</p>
        <div class="why-block"><span>Why it matters</span><p>${escapeHtml(event.whyItMatters)}</p></div>
        <div class="story-footer">
          <span class="story-proof">Updated ${escapeHtml(relativeTime(event.updatedAt || event.publishedAt))} · ${sourceCount} source${sourceCount === 1 ? '' : 's'}${event.flags?.includes('headline-derived') ? ' · headline-derived' : ''}</span>
          <div class="story-actions">
            <button class="action-button ${watched ? 'is-watched' : ''}" data-action="watch" data-event-id="${escapeHtml(event.id)}">${watched ? 'Watching' : 'Watch this'}</button>
            <button class="action-button" data-action="ask" data-event-id="${escapeHtml(event.id)}">Ask Pulse</button>
            <button class="action-button" data-action="detail" data-event-id="${escapeHtml(event.id)}">Evidence</button>
          </div>
        </div>
      </div>
      ${scores}
    </article>`;
}

function scoreItem(label, value, method = 'scores') {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="score-item"><button class="score-item-label" data-method="${escapeHtml(method)}">${escapeHtml(label)}</button><strong>${score}</strong><div class="score-bar"><i style="width:${score}%;background:${scoreColor(score)}"></i></div></div>`;
}

function sentimentScoreItem(value) {
  const score = Math.max(-100, Math.min(100, Number(value) || 0));
  const cls = toneClass(score);
  const position = 50 + score / 2;
  return `<div class="score-item sentiment-score"><button class="score-item-label" data-method="sentiment">Media tone</button><strong class="${cls}">${signed(score)}</strong><div class="sentiment-scale"><i style="left:${position}%"></i></div></div>`;
}

function renderDateAndGreeting() {
  const now = new Date();
  const dateText = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: REPORTING_TIMEZONE }).format(now);
  $('#current-date').textContent = dateText;
  const hourPart = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: REPORTING_TIMEZONE }).formatToParts(now).find((part) => part.type === 'hour');
  const hour = Number(hourPart?.value || 12);
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('#today-heading').textContent = `${greeting}, Rishi.`;
}

function todayEvents() {
  return periodEvents();
}


function renderScopeToolbar() {
  if (!state.periodWindow) state.periodWindow = resolveSelectedPeriod();
  const events = periodEvents();
  const coverage = coverageSnapshot(events);
  const selected = $('#period-select');
  if (selected && selected.value !== state.periodPreset) selected.value = state.periodPreset;
  $('#custom-period').hidden = state.periodPreset !== 'custom';
  $('#period-window-label').textContent = exactPeriodLabel();
  $('#compare-period-toggle').checked = state.comparePeriod;
  $('#coverage-button-count').textContent = `${coverage.evidence.length} evidence · ${coverage.configured.length} registered`;
  const scanText = coverage.attemptedChecks
    ? `${coverage.successfulChecks}/${coverage.attemptedChecks} automated checks succeeded${coverage.errors.length ? ` · ${coverage.errors.length} degraded` : ''}`
    : 'Live scan health has not yet been metered in this session';
  const universe = entityUniverseCounts();
  $('#scope-proof').textContent = `${universe.companies.length}/${universe.expectedCompanies} official companies · ${universe.leadership.length}/${universe.expectedLeadership} official leaders · ${events.length} deduplicated development${events.length === 1 ? '' : 's'} · ${sourceItemCount(events)} source item${sourceItemCount(events) === 1 ? '' : 's'} · ${scanText}.`;
  $('#trend-period-button').textContent = periodPresetLabel();
  renderCoverageDialog(events, coverage);
}

function renderPeriodComparison(events) {
  const panel = $('#period-comparison');
  if (!state.comparePeriod) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const previous = previousPeriodEvents();
  const currentMust = events.filter((event) => event.bucket === 'must').length;
  const previousMust = previous.filter((event) => event.bucket === 'must').length;
  const eventDiff = events.length - previous.length;
  const mustDiff = currentMust - previousMust;
  const sourceDiff = sourceItemCount(events) - sourceItemCount(previous);
  const sentimentDiff = averageSentiment(events) - averageSentiment(previous);
  const metric = (value, label) => `<div class="comparison-metric"><strong class="${value > 0 ? 'comparison-positive' : value < 0 ? 'comparison-negative' : ''}">${escapeHtml(signedDifference(value))}</strong><span>${escapeHtml(label)}</span></div>`;
  panel.hidden = false;
  panel.innerHTML = `<div class="comparison-title"><div><p class="eyebrow">Compared with the immediately preceding period</p><h2>${escapeHtml(periodPresetLabel())}</h2></div><span class="metric-chip">${escapeHtml(formatDate(previousPeriodWindow(state.periodWindow)?.start, true))} – ${escapeHtml(formatDate(previousPeriodWindow(state.periodWindow)?.end, true))}</span></div><div class="comparison-grid">${metric(eventDiff, 'Developments')}${metric(mustDiff, 'Must Know')}${metric(sourceDiff, 'Source items')}${metric(sentimentDiff, 'Avg media tone')}</div>`;
}

function renderCoverageDialog(events = periodEvents(), coverage = coverageSnapshot(events)) {
  $('#coverage-period-copy').textContent = `${periodPresetLabel()} · ${exactPeriodLabel()}`;
  const scanValue = coverage.attemptedChecks ? `${coverage.successfulChecks}/${coverage.attemptedChecks}` : '—';
  $('#coverage-metrics').innerHTML = [
    [coverage.evidence.length, 'Evidence source domains'],
    [coverage.configured.length, 'Governed source registry'],
    [scanValue, 'Latest checks succeeded'],
    [coverage.errors.length, 'Checks degraded']
  ].map(([value, label]) => `<div class="coverage-metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');

  $('#coverage-class-list').innerHTML = coverage.groups.map((group) => `<div class="coverage-class-row"><div><strong>${escapeHtml(group.name)}</strong><small>${group.evidence ? `${group.evidence} evidence source${group.evidence === 1 ? '' : 's'} in this window` : 'No attached evidence in this window'}</small></div><span>${group.configured} registered</span><span class="coverage-class-status ${group.evidence ? 'present' : 'none'}">${group.evidence ? 'Covered' : 'No event evidence'}</span></div>`).join('');

  $('#coverage-domain-list').innerHTML = coverage.evidence.length
    ? coverage.evidence.map((source) => `<span class="coverage-domain-chip" title="${escapeHtml(source.domain || source.name)}">${escapeHtml(source.name)}${source.domain ? ` · ${escapeHtml(source.domain)}` : ''}</span>`).join('')
    : '<div class="empty-state"><h2>No event evidence in this window</h2><p>This does not mean the registry was not checked; it means no source is attached to a qualifying event in the selected period.</p></div>';

  const scannedAt = state.liveMeta?.scannedAt || state.lastScanAt;
  const scanCopy = coverage.attemptedChecks
    ? `${coverage.successfulChecks} of ${coverage.attemptedChecks} configured automated checks succeeded${scannedAt ? ` at ${formatDate(scannedAt, true)}` : ''}.`
    : 'No live-scan health record is available in this session. The evidence record remains usable, but successful-check coverage cannot be claimed.';
  const capCopy = state.liveMeta?.windowCapped
    ? 'The automated live scan was capped to the latest 30 days. The selected period still filters all evidence already stored in Pulse.'
    : '';
  $('#coverage-scan-health').innerHTML = `<div class="coverage-scan-card"><strong>${escapeHtml(scanCopy)}</strong><p>${escapeHtml((state.liveMeta?.providers || []).join(' · ') || 'Providers not yet metered.')}</p>${capCopy ? `<p><strong>${escapeHtml(capCopy)}</strong></p>` : ''}${coverage.errors.length ? `<ul class="coverage-error-list">${coverage.errors.slice(0, 8).map((error) => `<li>${escapeHtml(error.provider || 'Source check')} · ${escapeHtml(error.query || 'unknown')} · ${escapeHtml(error.error || 'degraded')}</li>`).join('')}</ul>` : ''}</div>`;
}

function renderToday() {
  const events = todayEvents();
  const must = events.filter((event) => event.bucket === 'must');
  const watch = events.filter((event) => event.bucket === 'watch');
  const other = events.filter((event) => !['must', 'watch'].includes(event.bucket));
  const coverage = coverageSnapshot(events);

  $('#must-list').innerHTML = must.map((event) => storyCard(event)).join('') || emptyCard('No Must Know developments in this period', 'That is a valid outcome—not a monitoring failure.');
  $('#watch-list').innerHTML = watch.map((event) => storyCard(event)).join('') || emptyCard('Nothing is escalating in this period', 'Pulse will keep monitoring developing signals.');
  $('#other-list').innerHTML = other.map((event) => storyCard(event, { compact: true })).join('') || emptyCard('No other developments in this period', 'The selected evidence record is clear.');

  $('#must-count').textContent = must.length;
  $('#watch-count').textContent = watch.length;
  $('#other-count').textContent = other.length;
  $('#matter-count').textContent = must.length;
  $('#matter-label').textContent = must.length === 1 ? 'thing matters in this period' : 'things matter in this period';
  $('#nav-today-count').textContent = must.length;

  const articleCount = sourceItemCount(events);
  $('#source-scan-count').textContent = coverage.evidence.length;
  $('#source-scan-label').textContent = 'evidence sources';
  $('#article-scan-count').textContent = articleCount;
  $('#event-scan-count').textContent = events.length;
  $('#scan-summary').textContent = `${articleCount} source items from ${coverage.evidence.length} evidence source domain${coverage.evidence.length === 1 ? '' : 's'} collapsed into ${events.length} actual development${events.length === 1 ? '' : 's'}.`;
  $('#caught-up-copy').textContent = `${articleCount} source items reviewed · ${events.length} developments · ${must.length} deserved Must Know attention · ${exactPeriodLabel()}.`;
  $('#today-subtitle').textContent = must.length
    ? `${periodPresetLabel()}: what changed around the Group—and what deserves attention now.`
    : `${periodPresetLabel()}: no development currently changes the Group picture. Watch items remain under review.`;

  const words = [...must, ...watch].reduce((sum, event) => sum + String(event.summary).split(/\s+/).length + 14, 0);
  const seconds = events.length ? Math.max(20, Math.min(120, Math.round(words / 3.5))) : 12;
  $('#reading-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  $('#other-details').open = other.length <= 2;
  renderPeriodComparison(events);
  bindStoryActions($('#view-today'));
}

function emptyCard(title, copy) {
  return `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>`;
}

function renderWatching() {
  const allWatched = visibleEvents().filter((event) => state.watched.has(event.id));
  const events = [...allWatched].sort((a, b) => {
    const aCurrent = eventOccursInWindow(a, state.periodWindow) ? 1 : 0;
    const bCurrent = eventOccursInWindow(b, state.periodWindow) ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    return new Date(b.updatedAt || b.publishedAt) - new Date(a.updatedAt || a.publishedAt);
  });
  const changedInPeriod = events.filter((event) => eventOccursInWindow(event, state.periodWindow));
  $('#nav-watch-count').textContent = allWatched.length;
  const groups = {
    updates: changedInPeriod.filter((event) => event.watchState === 'new-update').length,
    developing: changedInPeriod.filter((event) => ['tracking', 'developing', 'case-study'].includes(event.watchState)).length,
    stable: events.length - changedInPeriod.length + changedInPeriod.filter((event) => ['stable', 'no-change'].includes(event.watchState)).length,
    total: events.length
  };
  $('#watch-status-strip').innerHTML = [
    ['New updates in period', groups.updates], ['Developing in period', groups.developing], ['No material change', groups.stable], ['Total watched', groups.total]
  ].map(([label, value]) => `<div class="watch-stat"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join('');

  $('#watching-empty').hidden = events.length > 0;
  $('#watching-list').innerHTML = events.map((event) => {
    const changed = eventOccursInWindow(event, state.periodWindow);
    const copy = changed
      ? (event.watchState === 'new-update' ? event.summary : event.whyItMatters)
      : `No material update during ${periodPresetLabel().toLowerCase()} (${exactPeriodLabel()}).`;
    const status = changed ? watchStateLabel(event.watchState) : 'No change in period';
    const indicator = changed ? (event.watchState || 'tracking') : 'no-change';
    return `<article class="watch-row" data-event-id="${escapeHtml(event.id)}">
      <span class="watch-indicator ${escapeHtml(indicator)}"></span>
      <div><h3>${escapeHtml(event.headline)}</h3><p>${escapeHtml(copy)}</p></div>
      <button class="watch-status" data-action="detail" data-event-id="${escapeHtml(event.id)}">${escapeHtml(status)}</button>
    </article>`;
  }).join('');
  bindStoryActions($('#view-watching'));
}

function aggregateEntitySentiment(events) {
  const map = new Map();
  for (const event of events) {
    const tone = Number(event.intelligence?.sentiment || 0);
    const weight = Math.max(1, Number(event.intelligence?.materiality || 25) / 25);
    for (const id of event.entityIds || []) {
      const entity = entityById(id);
      if (!entity || entity.tier > 2) continue;
      const current = map.get(id) || { entity, total: 0, weight: 0, count: 0 };
      current.total += tone * weight;
      current.weight += weight;
      current.count += 1;
      map.set(id, current);
    }
  }
  return [...map.values()]
    .filter((item) => item.count >= 1)
    .map((item) => ({ entity: item.entity, value: Math.round(item.total / item.weight), count: item.count }))
    .sort((a, b) => (b.count * 10 + Math.abs(b.value)) - (a.count * 10 + Math.abs(a.value)))
    .slice(0, 7);
}

function aggregateObservedPublicSentiment(events = []) {
  const observations = events
    .map((event) => event.intelligence?.publicSentiment)
    .filter((item) => item && Number.isFinite(Number(item.score)) && Number(item.sampleSize) > 0);
  if (!observations.length) return { score: null, sampleSize: 0, channelCount: 0, confidence: 'unavailable' };
  const totalWeight = observations.reduce((sum, item) => sum + Math.max(1, Number(item.sampleSize)), 0);
  const score = Math.round(observations.reduce((sum, item) => sum + Number(item.score) * Math.max(1, Number(item.sampleSize)), 0) / totalWeight);
  const sampleSize = observations.reduce((sum, item) => sum + Number(item.sampleSize || 0), 0);
  const channelCount = Math.max(...observations.map((item) => Number(item.channelCount || 0)));
  const confidence = sampleSize >= 50 && channelCount >= 2 ? 'high' : sampleSize >= 12 ? 'medium' : 'low';
  return { score, sampleSize, channelCount, confidence };
}

function renderPublicSentiment(events = []) {
  const node = $('#public-sentiment-summary');
  if (!node) return;
  const observed = aggregateObservedPublicSentiment(events);
  const meta = state.liveMeta?.sentimentCoverage || {};
  if (!Number.isFinite(Number(observed.score))) {
    node.innerHTML = `<div class="public-sentiment-head"><div><span>Observed public sentiment</span><strong>Not available in this period</strong></div><button class="method-link" data-method="public-sentiment">What this includes</button></div><p class="public-sentiment-proof">No accessible public-conversation sample was attached to a qualifying event. ${escapeHtml(meta.closedSocial || 'Closed social platforms require authorised or licensed access.')}</p>`;
    return;
  }
  const score = Number(observed.score);
  const position = 50 + score / 2;
  node.innerHTML = `<div class="public-sentiment-head"><div><span>Observed public sentiment</span><strong class="${toneClass(score)}">${signed(score)} · ${toneLabel(score)}</strong></div><button class="method-link" data-method="public-sentiment">What this includes</button></div><div class="public-sentiment-meter"><span>−100</span><div class="sentiment-track"><i class="${score < 0 ? 'negative' : ''}" style="left:${Math.min(99, Math.max(1, position))}%;width:2px"></i></div><span>+100</span></div><p class="public-sentiment-proof"><span class="public-sentiment-status">${escapeHtml(observed.confidence)} confidence</span> ${observed.sampleSize} accessible public sample${observed.sampleSize === 1 ? '' : 's'} across ${observed.channelCount} channel${observed.channelCount === 1 ? '' : 's'}. ${escapeHtml(meta.closedSocial || 'Closed-platform coverage is not implied.')}</p>`;
}

function renderRadar() {
  const events = periodEvents();
  const trending = [...events].sort((a, b) => (b.intelligence?.momentum || 0) - (a.intelligence?.momentum || 0)).slice(0, 6);
  $('#trend-list').innerHTML = trending.map((event, index) => {
    const momentum = event.intelligence?.momentum || 0;
    const change = event.intelligence?.trendChange || 0;
    return `<button class="trend-row" data-action="detail" data-event-id="${escapeHtml(event.id)}" style="border-left:0;border-right:0;border-top:0;background:transparent;width:100%;text-align:left;cursor:pointer">
      <span class="trend-rank">${index + 1}</span>
      <span class="trend-name"><strong>${escapeHtml(event.headline)}</strong><small>${escapeHtml(entitiesForEvent(event)[0]?.name || event.category)}</small></span>
      <span class="trend-score"><strong>${momentum}</strong><small class="${change < 0 ? 'down' : ''}">${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}%</small></span>
    </button>`;
  }).join('');

  const sentiments = aggregateEntitySentiment(events);
  $('#sentiment-list').innerHTML = sentiments.map(({ entity, value }) => {
    const left = value >= 0 ? 50 : Math.max(0, 50 + value / 2);
    const width = Math.max(2, Math.abs(value) / 2);
    return `<div class="sentiment-row"><span>${escapeHtml(entity.name)}</span><div class="sentiment-track"><i class="${value < 0 ? 'negative' : ''}" style="left:${left}%;width:${width}%"></i></div><strong class="sentiment-value">${value > 0 ? '+' : ''}${value}</strong></div>`;
  }).join('') || '<p class="method-note">Insufficient entity-level evidence.</p>';
  renderPublicSentiment(events);

  const narrativeEvent = [...events].filter((event) => event.narrative).sort((a, b) => (b.narrative?.score || 0) - (a.narrative?.score || 0))[0];
  if (narrativeEvent) {
    const narrative = narrativeEvent.narrative;
    const badge = $('#narrative-risk-badge');
    badge.textContent = `${narrative.risk} risk`;
    badge.className = `risk-badge ${String(narrative.risk).toLowerCase()}`;
    $('#narrative-card').innerHTML = `
      <div class="narrative-layout">
        <div>
          <div class="narrative-frames">
            <div class="frame-card"><span>Verified frame</span><p>${escapeHtml(narrative.officialFrame)}</p></div>
            <div class="frame-arrow" aria-hidden="true">→</div>
            <div class="frame-card emerging"><span>Emerging shorthand</span><p>${escapeHtml(narrative.emergingFrame)}</p></div>
          </div>
          <p class="narrative-takeaway"><strong>Recommended posture:</strong> ${escapeHtml(narrative.recommendation)}</p>
          <div class="narrative-actions"><span class="posture-pill">${escapeHtml(narrativeEvent.intelligence?.prediction?.posture || 'WATCH')}</span><button class="action-button" data-action="detail" data-event-id="${escapeHtml(narrativeEvent.id)}">Open evidence</button></div>
        </div>
        <div class="drift-meter"><div class="drift-circle" style="--score:${Number(narrative.score) || 0}"><div><strong>${Number(narrative.score) || 0}</strong><span>drift score</span></div></div></div>
      </div>`;
  } else {
    $('#narrative-risk-badge').textContent = 'No active drift';
    $('#narrative-risk-badge').className = 'risk-badge low';
    $('#narrative-card').innerHTML = '<div class="empty-state"><h2>No narrative divergence detected</h2><p>The verified and emerging frames currently remain aligned.</p></div>';
  }

  const forecastEvents = [...events]
    .filter((event) => event.intelligence?.prediction)
    .sort((a, b) => (b.intelligence.prediction.p24 || 0) - (a.intelligence.prediction.p24 || 0))
    .slice(0, 3);
  $('#forecast-grid').innerHTML = forecastEvents.map((event) => {
    const p = event.intelligence.prediction;
    return `<button class="forecast-card" data-action="detail" data-event-id="${escapeHtml(event.id)}" style="text-align:left;cursor:pointer;color:inherit">
      <h3>${escapeHtml(event.headline)}</h3>
      <div class="forecast-probabilities"><div><strong>${p.p6}%</strong><span>6 hrs</span></div><div><strong>${p.p24}%</strong><span>24 hrs</span></div><div><strong>${p.p72}%</strong><span>72 hrs</span></div></div>
      <p class="forecast-driver"><strong>${escapeHtml(p.posture || 'WATCH')}</strong> · ${escapeHtml((p.drivers || []).slice(0, 2).join(' · '))}</p>
    </button>`;
  }).join('');

  bindStoryActions($('#view-radar'));
}

function renderSearch() {
  const query = normalizeText(state.searchQuery);
  const queryTokens = new Set(titleTokens(query));
  let events = periodEvents().filter((event) => {
    if (!query) return true;
    const text = eventSearchText(event);
    if (text.includes(query)) return true;
    const eventTokens = new Set(titleTokens(text));
    const overlap = [...queryTokens].filter((token) => eventTokens.has(token)).length;
    return overlap >= Math.max(1, Math.ceil(queryTokens.size * 0.5));
  });

  const filter = state.searchFilter;
  if (filter !== 'all') {
    events = events.filter((event) => {
      if (['must', 'watch'].includes(filter)) return event.bucket === filter;
      if (filter === 'confirmed') return event.status === 'confirmed';
      return event.category === filter;
    });
  }
  $('#search-results-meta').textContent = `${events.length} development${events.length === 1 ? '' : 's'} found in ${periodPresetLabel().toLowerCase()}${query ? ` for “${state.searchQuery}”` : ''} · ${exactPeriodLabel()}.`;
  $('#search-results').innerHTML = events.map((event) => storyCard(event, { compact: true })).join('') || emptyCard('No matching evidence', 'Try a company, person, brand or topic already present in the verified record.');
  bindStoryActions($('#view-search'));
}

function answerQuestion(question) {
  const q = normalizeText(question);
  const events = periodEvents();
  let matches = [];
  let intro = 'These are the most relevant evidence-backed developments in the current record.';

  if (/chairman|must know|what matters|today/.test(q)) {
    matches = todayEvents().filter((event) => event.bucket === 'must').slice(0, 4);
    intro = matches.length ? 'The current Must Know brief contains the developments most likely to change today’s Group picture.' : 'No current development meets the Must Know threshold.';
  } else if (/narrative|drift|misattrib|reputation/.test(q)) {
    matches = events.filter((event) => event.narrative || event.category === 'Reputation').sort((a, b) => (b.narrative?.score || 0) - (a.narrative?.score || 0)).slice(0, 4);
    intro = 'These events carry the clearest narrative or reputation signals in the current record.';
  } else if (/unconfirmed|developing|uncertain|remain/.test(q)) {
    matches = events.filter((event) => event.status !== 'confirmed').sort((a, b) => (b.intelligence?.materiality || 0) - (a.intelligence?.materiality || 0)).slice(0, 5);
    intro = 'These developments still contain reported or unresolved elements. Their status should not be presented as final fact.';
  } else if (/positive|amplif|good news|sentiment/.test(q)) {
    matches = events.filter((event) => (event.intelligence?.sentiment || 0) > 20).sort((a, b) => (b.intelligence?.sentiment || 0) - (a.intelligence?.sentiment || 0)).slice(0, 5);
    intro = 'These developments currently show positive media tone. Positive tone alone does not automatically mean narrative alignment.';
  } else {
    const matchedEntities = matchEntities(question, state.entities);
    const entityIds = new Set(matchedEntities.map((entity) => entity.id));
    const tokens = new Set(titleTokens(q));
    matches = events.map((event) => {
      const textTokens = new Set(titleTokens(eventSearchText(event)));
      const tokenScore = [...tokens].filter((token) => textTokens.has(token)).length;
      const entityScore = (event.entityIds || []).filter((id) => entityIds.has(id)).length * 4;
      return { event, score: tokenScore + entityScore };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || (b.event.intelligence?.materiality || 0) - (a.event.intelligence?.materiality || 0)).slice(0, 5).map((item) => item.event);
    if (matchedEntities.length) intro = `The current record contains the following verified or clearly labelled developments involving ${matchedEntities.map((entity) => entity.name).join(', ')}.`;
  }

  return { intro, matches };
}

function renderAnswer(question) {
  const answer = answerQuestion(question);
  const card = $('#answer-card');
  card.hidden = false;
  const sourceLinks = [];
  for (const event of answer.matches) for (const source of event.sources || []) if (!sourceLinks.some((item) => item.url === source.url)) sourceLinks.push(source);
  card.innerHTML = `
    <p class="eyebrow">Answer from the evidence record</p>
    <h2>${escapeHtml(question)}</h2>
    <p>${escapeHtml(answer.intro)}</p>
    ${answer.matches.length ? `<ul class="answer-list">${answer.matches.map((event) => `<li><strong>${escapeHtml(event.headline)}</strong><span>${escapeHtml(event.whyItMatters)}</span><button class="text-button" data-action="detail" data-event-id="${escapeHtml(event.id)}">Open evidence →</button></li>`).join('')}</ul>` : '<div class="empty-state"><h2>No supported answer</h2><p>The current evidence record does not support a reliable answer to that question.</p></div>'}
    <div class="answer-sources">Based on ${answer.matches.length} event${answer.matches.length === 1 ? '' : 's'} and ${sourceLinks.length} linked source${sourceLinks.length === 1 ? '' : 's'}. No facts were added from generic model knowledge.</div>`;
  bindStoryActions(card);
}

function entityUniverseCounts() {
  const officialCompanyUrl = state.entityUniverse?.sourceOfTruth?.companies || 'https://www.adityabirla.com/en/businesses/companies/';
  const officialLeadershipUrl = state.entityUniverse?.sourceOfTruth?.leadership || 'https://www.adityabirla.com/en/our-story/leadership/';
  const companies = state.entities.filter((entity) => entity.type === 'company' && entity.officialCompanyEntry === true);
  const leadership = state.entities.filter((entity) => entity.type === 'person' && entity.sourceUrl === officialLeadershipUrl);
  const stakeholders = state.entities.filter((entity) => entity.type === 'stakeholder');
  const brands = state.entities.filter((entity) => entity.type === 'brand');
  return { companies, leadership, stakeholders, brands, expectedCompanies: Number(state.entityUniverse?.officialCompanyEntries || companies.length), expectedLeadership: Number(state.entityUniverse?.officialLeadershipEntries || leadership.length), total: state.entities.length, officialCompanyUrl, officialLeadershipUrl };
}

function renderEntityUniverse() {
  const counts = entityUniverseCounts();
  const companyPass = counts.companies.length === counts.expectedCompanies;
  const leadershipPass = counts.leadership.length === counts.expectedLeadership;
  $('#universe-coverage-ratio').textContent = `${counts.companies.length}/${counts.expectedCompanies} companies · ${counts.leadership.length}/${counts.expectedLeadership} leaders`;
  $('#universe-summary').innerHTML = [[counts.companies.length, 'Official company entries'],[counts.leadership.length, 'Official leadership entries'],[counts.brands.length, 'Brands mapped'],[counts.stakeholders.length, 'Material stakeholders mapped']].map(([value, label]) => `<div class="universe-stat"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('');
  $('#company-universe-count').textContent = `${counts.companies.length}/${counts.expectedCompanies} reconciled`;
  $('#leadership-universe-count').textContent = `${counts.leadership.length}/${counts.expectedLeadership} reconciled`;
  $('#company-universe').innerHTML = counts.companies.sort((a, b) => Number(a.officialCompanyIndex || 999) - Number(b.officialCompanyIndex || 999)).map((entity) => `<span class="universe-chip">${escapeHtml(entity.name)}</span>`).join('');
  $('#leadership-universe').innerHTML = counts.leadership.map((entity) => `<span class="universe-chip person"><strong>${escapeHtml(entity.name)}</strong><small>${escapeHtml(entity.role || 'Role monitored')}</small></span>`).join('');
  const verified = state.entityUniverse?.verifiedAt || counts.companies[0]?.lastVerifiedAt || counts.leadership[0]?.lastVerifiedAt || 'not recorded';
  const liveAudits = Array.isArray(state.liveMeta?.registryAudits) ? state.liveMeta.registryAudits : [];
  const liveReconciled = liveAudits.length === 2 && liveAudits.every((audit) => audit.reconciled);
  const liveProof = liveAudits.length ? ` Latest live registry check: ${liveReconciled ? '<strong>reconciled</strong>' : '<strong>change detected</strong>'} across ${liveAudits.map((audit) => `${audit.matchedCount}/${audit.expectedCount}`).join(' and ')} entries.` : ' A live registry drift check will run with the next successful source scan.';
  $('#universe-verification-note').innerHTML = `${companyPass && leadershipPass ? '<strong>Local reconciliation passed.</strong>' : '<strong>Local reconciliation incomplete.</strong>'} Verified ${escapeHtml(verified)} against the <a href="${escapeHtml(safeUrl(counts.officialCompanyUrl))}" target="_blank" rel="noopener noreferrer">official company register ↗</a> and <a href="${escapeHtml(safeUrl(counts.officialLeadershipUrl))}" target="_blank" rel="noopener noreferrer">official leadership register ↗</a>.${liveProof} Roles and entities remain date-sensitive.`;
}

function boundedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function weightedProgress(milestones = [], field = 'completion') {
  const weightTotal = milestones.reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0);
  if (!weightTotal) return 0;
  const weighted = milestones.reduce((sum, milestone) => {
    const value = field === 'implementationCompletion'
      ? (milestone.implementationCompletion ?? milestone.completion ?? 0)
      : (milestone.completion ?? 0);
    return sum + Number(milestone.weight || 0) * boundedPercent(value) / 100;
  }, 0);
  return Math.round(weighted / weightTotal * 100);
}

function buildProgressSnapshot() {
  const plan = state.buildPlan && typeof state.buildPlan === 'object' ? state.buildPlan : {};
  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  const weightTotal = milestones.reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0);
  const verified = weightedProgress(milestones, 'completion');
  const built = Math.max(verified, weightedProgress(milestones, 'implementationCompletion'));
  const builtAwaitingProof = Math.max(0, built - verified);
  const notYetBuilt = Math.max(0, 100 - built);
  const counts = milestones.reduce((acc, milestone) => {
    const key = String(milestone.status || 'not_started').replaceAll('_', '-');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dependencies = Array.isArray(plan.resources?.externalDependencies) ? plan.resources.externalDependencies : [];
  const activeDependencies = dependencies.filter((item) => !['available', 'connected', 'complete', 'resolved'].includes(String(item.currentState || '').toLowerCase()));
  const activeMilestones = milestones.filter((item) => item.active === true);
  return { plan, milestones, weightTotal, verified, built, builtAwaitingProof, notYetBuilt, counts, activeDependencies, activeMilestones };
}

function buildStatusLabel(status = '') {
  return String(status).replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderBuildProgress() {
  const snapshot = buildProgressSnapshot();
  const {
    plan,
    milestones,
    verified,
    built,
    builtAwaitingProof,
    notYetBuilt,
    counts,
    activeDependencies,
    activeMilestones
  } = snapshot;
  const sidebarValue = $('#sidebar-build-progress');
  if (!sidebarValue) return;

  sidebarValue.textContent = `${verified}%`;
  $('#sidebar-build-progress-bar').style.width = `${verified}%`;
  $('#sidebar-build-progress-copy').textContent = `${built}% built · ${builtAwaitingProof}% awaiting proof · ${notYetBuilt}% not built`;

  $('#objective-progress-value').textContent = `${verified}%`;
  $('#objective-progress-built-value').textContent = `${built}% built`;
  $('#objective-progress-bar').style.width = `${verified}%`;
  $('#objective-progress-proof-bar').style.left = `${verified}%`;
  $('#objective-progress-proof-bar').style.width = `${builtAwaitingProof}%`;
  $('#objective-progress-track').setAttribute('aria-valuenow', String(verified));
  $('#objective-progress-track').setAttribute('aria-valuetext', `${verified}% verified, ${built}% built`);
  $('#objective-progress-objective').textContent = plan.objective || 'Progress is counted only when milestone evidence exists.';
  $('#objective-progress-meta').innerHTML = [
    ['verified', `${verified}%`, 'verified complete'],
    ['built', `${built}%`, 'built'],
    ['proof', `${builtAwaitingProof}%`, 'awaiting proof'],
    ['unbuilt', `${notYetBuilt}%`, 'not yet built'],
    ['dependency', activeDependencies.length, 'unresolved dependencies']
  ].map(([cls, value, label]) => `<span class="progress-chip ${escapeHtml(cls)}"><i></i><strong>${escapeHtml(value)}</strong> ${escapeHtml(label)}</span>`).join('');
  $('#milestone-summary-count').textContent = `${milestones.length} milestones · weighted`;
  $('#resource-summary-count').textContent = `${activeDependencies.length} unresolved`;

  const sprint = plan.programme?.currentSprint || {};
  const sprintTarget = $('#active-sprint');
  if (sprintTarget) {
    const deliverables = Array.isArray(sprint.deliverables) ? sprint.deliverables : [];
    sprintTarget.innerHTML = sprint.name ? `
      <div class="sprint-head">
        <div><span>Active build</span><strong>${escapeHtml(sprint.name)}</strong></div>
        <span class="sprint-count">${activeMilestones.length} active milestone${activeMilestones.length === 1 ? '' : 's'}</span>
      </div>
      <p>${escapeHtml(sprint.objective || '')}</p>
      ${deliverables.length ? `<div class="sprint-deliverables">${deliverables.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
    ` : '<p>No active sprint is recorded.</p>';
  }

  $('#milestone-list').innerHTML = milestones.map((milestone) => {
    const statusClass = String(milestone.status || 'not_started').replaceAll('_', '-');
    const evidence = Array.isArray(milestone.evidence) ? milestone.evidence : [];
    const verifiedMilestone = boundedPercent(milestone.completion || 0);
    const builtMilestone = Math.max(verifiedMilestone, boundedPercent(milestone.implementationCompletion ?? milestone.completion ?? 0));
    const proofGap = Math.max(0, builtMilestone - verifiedMilestone);
    return `<details class="milestone-card ${milestone.active ? 'active' : ''}" ${milestone.active || milestone.status === 'blocked' ? 'open' : ''}>
      <summary>
        <span class="milestone-id">${escapeHtml(milestone.id)}</span>
        <span class="milestone-title"><strong>${escapeHtml(milestone.title)}</strong><small>${escapeHtml(buildStatusLabel(milestone.status))} · weight ${escapeHtml(milestone.weight)}%</small></span>
        <span class="milestone-score"><strong>${escapeHtml(verifiedMilestone)}%</strong><small>verified · ${escapeHtml(builtMilestone)}% built</small></span>
      </summary>
      <div class="milestone-progress-track" aria-label="${escapeHtml(milestone.title)} progress">
        <i class="verified" style="width:${verifiedMilestone}%"></i>
        <i class="proof" style="left:${verifiedMilestone}%;width:${proofGap}%"></i>
      </div>
      <div class="milestone-card-body">
        <span class="milestone-status ${escapeHtml(statusClass)}">${escapeHtml(buildStatusLabel(milestone.status))}</span>
        <p><strong>Outcome:</strong> ${escapeHtml(milestone.outcome)}</p>
        <p><strong>Pass gate:</strong> ${escapeHtml(milestone.acceptanceGate)}</p>
        <p><strong>Next:</strong> ${escapeHtml(milestone.nextAction)}</p>
        <p><strong>Dependency:</strong> ${escapeHtml(milestone.dependency || 'None')}</p>
        ${evidence.length ? `<div class="milestone-evidence">${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      </div>
    </details>`;
  }).join('') || '<div class="empty-state"><h2>No milestone plan loaded</h2><p>The job meter cannot calculate completion without the governed milestone file.</p></div>';

  const available = Array.isArray(plan.resources?.availableNow) ? plan.resources.availableNow : [];
  const required = Array.isArray(plan.resources?.externalDependencies) ? plan.resources.externalDependencies : [];
  $('#resources-available').innerHTML = available.map((item) => `<div class="resource-item"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.detail)}</p><span class="resource-state">${escapeHtml(buildStatusLabel(item.status))}</span></div>`).join('');
  $('#resources-required').innerHTML = required.map((item) => `<div class="resource-item"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.requiredFor)}</p><p><strong>Needed:</strong> ${escapeHtml(item.ownerAction)}</p><span class="resource-state">${escapeHtml(buildStatusLabel(item.currentState))}</span></div>`).join('');
}

function renderControlRoom() {
  renderBuildProgress();
  const events = periodEvents();
  const confirmed = events.filter((event) => event.status === 'confirmed').length;
  const headlineDerived = events.filter((event) => event.flags?.includes('headline-derived')).length;
  const coverage = coverageSnapshot(events);
  const gaps = buildCoverageGaps(events);
  const universe = entityUniverseCounts();
  const healthCards = [
    ['Official companies', `${universe.companies.length}/${universe.expectedCompanies}`, 'official register reconciled'],
    ['Official leadership', `${universe.leadership.length}/${universe.expectedLeadership}`, 'current public register reconciled'],
    ['Latest scan checks', coverage.attemptedChecks ? `${coverage.successfulChecks}/${coverage.attemptedChecks}` : '—', coverage.attemptedChecks ? `${coverage.errors.length} degraded` : 'not metered'],
    ['Open coverage gaps', gaps.length, gaps.length ? 'visible, not hidden' : 'none detected']
  ];
  $('#health-grid').innerHTML = healthCards.map(([label, value, copy]) => `<div class="health-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(copy)}</small></div>`).join('');

  const providerErrors = Array.isArray(state.liveMeta?.errors) ? state.liveMeta.errors : [];
  const providerErrorCount = (provider) => providerErrors.filter((item) => String(item.provider).toLowerCase().includes(provider.toLowerCase())).length;
  const groups = [
    ['Authoritative registry', state.sources.filter((s) => s.tier === 0), 'Official, exchange and regulator', 'Official source'],
    ['Major journalism', state.sources.filter((s) => s.tier === 1), 'High-quality independent reporting', 'Google News'],
    ['Specialist media', state.sources.filter((s) => s.tier === 2), 'Sector and regional depth', 'GDELT'],
    ['Open discovery', state.sources.filter((s) => s.tier >= 3), 'GDELT and Google News safety nets', 'Discovery']
  ];
  $('#source-health-list').innerHTML = groups.map(([name, sources, copy, provider], index) => {
    const failures = provider === 'Discovery' ? providerErrors.length : providerErrorCount(provider);
    const degraded = state.liveStatus === 'error' || failures > 0;
    const status = degraded ? 'warning' : 'healthy';
    const statusText = degraded ? `${failures || '—'} failed check${failures === 1 ? '' : 's'}` : (state.liveStatus === 'success' ? 'healthy' : 'configured');
    return `<div class="source-health-row"><span class="status-light ${status}"></span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(copy)} · ${sources.length} registered</small></div><span>${escapeHtml(statusText)}</span></div>`;
  }).join('');
  $('#healthy-source-ratio').textContent = `${coverage.evidence.length} evidenced · ${coverage.configured.length} registered`;

  $('#gap-list').innerHTML = gaps.map((gap) => `<div class="gap-item"><strong>${escapeHtml(gap.title)}</strong><p>${escapeHtml(gap.copy)}</p></div>`).join('') || '<div class="gap-item"><strong>No active gap signal</strong><p>That does not prove universal completeness; it means no configured anomaly is currently visible.</p></div>';

  const decisions = [...events].sort((a, b) => new Date(b.updatedAt || b.publishedAt) - new Date(a.updatedAt || a.publishedAt)).slice(0, 8);
  $('#audit-body').innerHTML = decisions.map((event) => `<tr><td>${escapeHtml(formatDate(event.updatedAt || event.publishedAt, true))}</td><td>${escapeHtml(bucketLabel(event.bucket))}: ${escapeHtml(event.headline)}</td><td>${getSourceCount(event)} source${getSourceCount(event) === 1 ? '' : 's'} · certainty ${event.intelligence?.certainty ?? '—'}</td><td class="audit-outcome ${event.bucket === 'watch' ? 'watch' : ''}">${escapeHtml(event.status === 'confirmed' ? 'Published' : 'Labelled')}</td></tr>`).join('');

  renderEntityUniverse();

  if (headlineDerived) {
    $('#gap-list').insertAdjacentHTML('beforeend', `<div class="gap-item"><strong>${headlineDerived} headline-derived live signal${headlineDerived === 1 ? '' : 's'}</strong><p>These items remain visibly labelled and should not be treated as full-article verification.</p></div>`);
  }
}

function buildCoverageGaps(events) {
  const gaps = [];
  if (state.liveStatus === 'error') gaps.push({ title: 'Open-web discovery temporarily unavailable', copy: 'The last successful local live record remains visible, but one or more discovery providers could not be refreshed in this session.' });
  const providerErrors = Array.isArray(state.liveMeta?.errors) ? state.liveMeta.errors : [];
  if (providerErrors.length) gaps.push({ title: `${providerErrors.length} configured source check${providerErrors.length === 1 ? '' : 's'} degraded`, copy: providerErrors.slice(0, 3).map((item) => `${item.provider}: ${item.query}`).join(' · ') });
  const universe = entityUniverseCounts();
  if (universe.companies.length !== universe.expectedCompanies) gaps.push({ title: 'Official company universe is not fully reconciled', copy: `${universe.companies.length} of ${universe.expectedCompanies} official company entries are present.` });
  if (universe.leadership.length !== universe.expectedLeadership) gaps.push({ title: 'Official leadership universe is not fully reconciled', copy: `${universe.leadership.length} of ${universe.expectedLeadership} official leadership entries are present.` });
  const registryAudits = Array.isArray(state.liveMeta?.registryAudits) ? state.liveMeta.registryAudits : [];
  for (const audit of registryAudits.filter((item) => !item.reconciled)) gaps.push({ title: `${audit.sourceName || audit.registryId} has changed`, copy: `${audit.matchedCount} of ${audit.expectedCount} governed entries were found in the latest live registry check. Missing entries are flagged for reconciliation.` });
  const currentEventEntities = new Set(events.flatMap((event) => event.entityIds || []));
  const priorityMissing = state.entities.filter((entity) => entity.coverageRequired && entity.tier <= 1 && !currentEventEntities.has(entity.id));
  if (priorityMissing.length) gaps.push({ title: `${priorityMissing.length} priority entities have no current event`, copy: `Examples: ${priorityMissing.slice(0, 4).map((entity) => entity.name).join(', ')}. Absence may be normal; it is not treated as a missed story by itself.` });
  const lowCertaintyHighImpact = events.filter((event) => (event.intelligence?.materiality || 0) >= 70 && (event.intelligence?.certainty || 0) < 65);
  if (lowCertaintyHighImpact.length) gaps.push({ title: `${lowCertaintyHighImpact.length} high-impact development${lowCertaintyHighImpact.length === 1 ? '' : 's'} need stronger corroboration`, copy: lowCertaintyHighImpact.slice(0, 2).map((event) => event.headline).join(' · ') });
  if (Number(state.liveMeta?.publicConversationChecks || 0) && Number(state.liveMeta?.publicConversationChecksSucceeded || 0) === 0) gaps.push({ title: 'Open-public conversation sources were unavailable', copy: 'Public-sentiment scoring is withheld rather than inferred from media tone.' });
  gaps.push({ title: 'Closed-social listening is not connected', copy: 'X, LinkedIn, Instagram, YouTube comments and other closed-platform conversation require authorised or licensed access. Observed Public Sentiment therefore states its coverage explicitly.' });
  return gaps;
}

function renderAll() {
  renderDateAndGreeting();
  renderScopeToolbar();
  renderToday();
  renderWatching();
  renderRadar();
  renderSearch();
  renderControlRoom();
  updateLastScanLabel();
}

function updateLastScanLabel() {
  const label = $('#last-scan-label');
  if (state.liveStatus === 'loading') label.textContent = 'Scanning live public sources…';
  else if (state.liveStatus === 'success' && state.lastScanAt) label.textContent = `Live scan ${relativeTime(state.lastScanAt)}`;
  else if (state.liveStatus === 'error') label.textContent = 'Verified brief active · live discovery degraded';
  else label.textContent = 'Forward monitoring active';
}

function switchView(view) {
  if (!document.querySelector(`[data-view-panel="${CSS.escape(view)}"]`)) return;
  state.currentView = view;
  if (!globalThis.__ABG_PULSE_QA__ && history?.replaceState) history.replaceState(null, '', `#${view}`);
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
  $$('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (button.closest('.side-nav')) active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
  });
  if (view === 'search') setTimeout(() => $('#search-input')?.focus(), 100);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindNavigation() {
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-go-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.goView)));
}

function bindStoryActions(root = document) {
  $$('[data-action]', root).forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = state.events.find((candidate) => candidate.id === button.dataset.eventId);
      if (!item) return;
      if (button.dataset.action === 'watch') toggleWatch(item.id);
      if (button.dataset.action === 'detail') openStory(item);
      if (button.dataset.action === 'ask') {
        switchView('ask');
        $('#ask-input').value = `Why does “${item.headline}” matter to ABG?`;
        renderAnswer($('#ask-input').value);
      }
    });
  });
}

function toggleWatch(id) {
  if (state.watched.has(id)) {
    state.watched.delete(id);
    showToast('Removed from Watching.');
  } else {
    state.watched.add(id);
    showToast('Added to Watching. Pulse will carry it forward.');
  }
  saveJsonStorage(STORAGE.watched, [...state.watched]);
  renderToday();
  renderWatching();
}

function openStory(event) {
  const dialog = $('#story-dialog');
  const intelligence = event.intelligence || {};
  const prediction = intelligence.prediction || {};
  const entities = entitiesForEvent(event);
  const narrative = event.narrative;
  const sources = event.sources || [];
  $('#dialog-content').innerHTML = `
    <div class="story-meta"><span class="status-pill ${escapeHtml(event.status)}">${escapeHtml(statusLabel(event.status))}</span><span class="category-pill">${escapeHtml(event.category)}</span><span>${escapeHtml(bucketLabel(event.bucket))}</span></div>
    <h2 class="dialog-headline" id="dialog-headline">${escapeHtml(event.headline)}</h2>
    <p class="dialog-summary">${escapeHtml(event.summary)}</p>
    <section class="dialog-section"><h3>Why it matters · interpretation</h3><p>${escapeHtml(event.whyItMatters)}</p></section>
    <section class="dialog-section"><h3>Entities</h3><p>${escapeHtml(entities.map((entity) => entity.name).join(' · ') || 'Aditya Birla Group')}</p></section>
    ${narrative ? `<section class="dialog-section"><h3>Narrative radar</h3><div class="narrative-frames"><div class="frame-card"><span>Verified frame</span><p>${escapeHtml(narrative.officialFrame)}</p></div><div class="frame-arrow">→</div><div class="frame-card emerging"><span>Emerging shorthand</span><p>${escapeHtml(narrative.emergingFrame)}</p></div></div><p class="narrative-takeaway"><strong>Recommendation:</strong> ${escapeHtml(narrative.recommendation)}</p></section>` : ''}
    <section class="dialog-section"><h3>Intelligence scores</h3><div class="intelligence-grid">
      ${intelligenceTile('Materiality', intelligence.materiality)}${intelligenceTile('Certainty', intelligence.certainty)}${intelligenceTile('Momentum', intelligence.momentum)}${intelligenceTile('Media tone', signed(intelligence.mediaTone ?? intelligence.sentiment))}${intelligenceTile('Observed public sentiment', Number.isFinite(Number(intelligence.publicSentiment?.score)) ? `${signed(intelligence.publicSentiment.score)} · n=${intelligence.publicSentiment.sampleSize || 0}` : 'Unavailable')}${intelligenceTile('Narrative alignment', intelligence.narrativeAlignment)}${intelligenceTile('24h importance', prediction.p24 !== undefined ? `${prediction.p24}%` : '—')}
    </div>${prediction.drivers?.length ? `<p class="method-note">Forecast drivers: ${escapeHtml(prediction.drivers.join(' · '))}. Posture: ${escapeHtml(prediction.posture || 'WATCH')}.</p>` : ''}</section>
    <section class="dialog-section"><h3>Evidence and sources</h3>${sources.length ? `<ul class="source-list">${sources.map((source) => `<li><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(source.name || domainFromUrl(source.url))}</span><small>Tier ${source.tier ?? '—'} ↗</small></a></li>`).join('')}</ul>` : '<p>No external source link is available. The item must not be treated as operationally verified.</p>'}<p class="method-note">Published ${escapeHtml(formatDate(event.publishedAt, true))}. Updated ${escapeHtml(formatDate(event.updatedAt || event.publishedAt, true))}. Facts above are derived from the linked evidence; “Why it matters” and forecasts are labelled interpretation.</p></section>
    <section class="dialog-section"><h3>Improve the system</h3><div class="feedback-row">${['Useful','Not important','Wrong entity','Duplicate','Missing context','Wrong summary'].map((label) => `<button data-feedback="${escapeHtml(label)}" data-event-id="${escapeHtml(event.id)}">${escapeHtml(label)}</button>`).join('')}</div></section>`;
  $$('[data-feedback]', dialog).forEach((button) => button.addEventListener('click', () => recordFeedback(button.dataset.eventId, button.dataset.feedback)));
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function intelligenceTile(label, value) {
  return `<div class="intelligence-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;
}

function signed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number}`;
}

function recordFeedback(eventId, feedback) {
  state.feedback.push({ eventId, feedback, at: new Date().toISOString() });
  saveJsonStorage(STORAGE.feedback, state.feedback.slice(-250));
  showToast(`Feedback saved: ${feedback}.`);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3100);
}

function bindAsk() {
  $('#ask-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const question = $('#ask-input').value.trim();
    if (!question) return;
    renderAnswer(question);
  });
  $$('#ask-suggestions button').forEach((button) => button.addEventListener('click', () => {
    $('#ask-input').value = button.textContent.trim();
    renderAnswer($('#ask-input').value);
  }));
}

function bindSearch() {
  let timer;
  $('#search-input').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.searchQuery = event.target.value.trim(); renderSearch(); }, 120);
  });
  $$('#search-filters .filter-chip').forEach((button) => button.addEventListener('click', () => {
    state.searchFilter = button.dataset.filter;
    $$('#search-filters .filter-chip').forEach((item) => item.classList.toggle('is-active', item === button));
    renderSearch();
  }));
}


function persistPeriodSettings() {
  saveJsonStorage(STORAGE.period, {
    preset: state.periodPreset,
    compare: state.comparePeriod,
    customStart: $('#custom-period-start')?.value || '',
    customEnd: $('#custom-period-end')?.value || ''
  });
}

function applySelectedPeriod({ refreshLive = true } = {}) {
  state.periodWindow = resolveSelectedPeriod(state.periodPreset);
  persistPeriodSettings();
  renderAll();
  if (refreshLive && state.preferences.liveScan) scanLiveSources({ periodChange: true });
}

function bindPeriodControls() {
  const select = $('#period-select');
  const custom = $('#custom-period');
  select.addEventListener('change', () => {
    state.periodPreset = select.value;
    custom.hidden = state.periodPreset !== 'custom';
    if (state.periodPreset === 'custom') {
      if (!$('#custom-period-start').value) $('#custom-period-start').value = toIstDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000));
      if (!$('#custom-period-end').value) $('#custom-period-end').value = toIstDateTimeLocal(new Date());
      persistPeriodSettings();
      $('#custom-period-start').focus();
      return;
    }
    applySelectedPeriod();
  });
  $('#apply-custom-period').addEventListener('click', () => {
    const start = parseIstDateTimeLocal($('#custom-period-start').value);
    const end = parseIstDateTimeLocal($('#custom-period-end').value);
    if (!start || !end || start >= end) {
      showToast('Choose a valid start and end time.');
      return;
    }
    state.periodPreset = 'custom';
    applySelectedPeriod();
  });
  $('#compare-period-toggle').addEventListener('change', (event) => {
    state.comparePeriod = Boolean(event.target.checked);
    persistPeriodSettings();
    renderAll();
  });
  $('#coverage-button').addEventListener('click', () => {
    renderCoverageDialog();
    $('#coverage-dialog').showModal();
  });
  $('#trend-period-button').addEventListener('click', () => {
    select.focus();
    showToast('Choose a period above. Radar recalculates instantly.');
  });
}

function bindPreferences() {
  const dialog = $('#preferences-dialog');
  $('#profile-button').addEventListener('click', () => {
    $('#live-scan-toggle').checked = state.preferences.liveScan;
    $('#forecast-toggle').checked = state.preferences.showForecasts;
    $('#noise-toggle').checked = state.preferences.reduceNoise;
    dialog.showModal();
  });
  $$('[data-preference-view]', dialog).forEach((button) => button.addEventListener('click', () => {
    dialog.close();
    switchView(button.dataset.preferenceView);
  }));
  $('#save-preferences').addEventListener('click', (event) => {
    event.preventDefault();
    state.preferences = {
      liveScan: $('#live-scan-toggle').checked,
      showForecasts: $('#forecast-toggle').checked,
      reduceNoise: $('#noise-toggle').checked
    };
    saveJsonStorage(STORAGE.preferences, state.preferences);
    dialog.close();
    renderAll();
    showToast('Preferences saved.');
  });
}

function bindInstall() {
  const button = $('#install-button');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    button.hidden = true;
  });
  window.addEventListener('appinstalled', () => showToast('ABG Pulse installed.'));
}

async function scanLiveSources({ manual = false, periodChange = false } = {}) {
  if (!state.preferences.liveScan && !manual) return;
  if (state.periodPreset !== 'custom') state.periodWindow = resolveSelectedPeriod(state.periodPreset);
  state.liveStatus = 'loading';
  updateLastScanLabel();
  $('#refresh-button').classList.add('is-loading');
  try {
    let payload;
    const params = new URLSearchParams({ start: new Date(state.periodWindow.start).toISOString(), end: new Date(state.periodWindow.end).toISOString() });
    try {
      payload = await fetchJson(`/api/scan?${params}`, { timeout: 26000 });
    } catch (error) {
      const localFallbackAllowed = ['localhost', '127.0.0.1'].includes(location.hostname)
        || new URLSearchParams(location.search).has('direct-discovery');
      if (!localFallbackAllowed) throw error;
      payload = await directGdeltScan();
    }
    const liveEvents = Array.isArray(payload?.events) ? payload.events : [];
    state.rawArticleCount = Number(payload?.meta?.articleCount || 0);
    if (payload?.entityUniverse) state.entityUniverse = payload.entityUniverse;
    state.liveEvents = dedupeEvents([...liveEvents, ...state.liveEvents])
      .sort((a, b) => new Date(b.updatedAt || b.publishedAt) - new Date(a.updatedAt || a.publishedAt))
      .filter((event) => Date.now() - new Date(event.updatedAt || event.publishedAt).getTime() <= 45 * 24 * 60 * 60 * 1000)
      .slice(0, 250);
    state.lastScanAt = payload?.meta?.scannedAt || new Date().toISOString();
    state.liveMeta = { ...(payload?.meta || {}), windowStart: state.periodWindow.start, windowEnd: state.periodWindow.end };
    state.liveStatus = 'success';
    const known = new Set(loadJsonStorage(STORAGE.knownEvents, state.demoMode ? state.demoEvents.map((event) => event.id) : []));
    state.newEventIds = new Set(liveEvents.filter((event) => !known.has(event.id) && (event.intelligence?.materiality || 0) >= 55).map((event) => event.id));
    saveJsonStorage(STORAGE.liveEvents, state.liveEvents);
    saveJsonStorage(STORAGE.liveMeta, state.liveMeta);
    state.events = dedupeEvents([...state.liveEvents, ...(state.demoMode ? state.demoEvents : [])]);
    saveJsonStorage(STORAGE.knownEvents, [...new Set([...known, ...state.events.map((event) => event.id)])].slice(-500));
    renderAll();
    if (manual) {
      const newCount = state.newEventIds.size;
      showToast(newCount ? `${newCount} new material development${newCount === 1 ? '' : 's'} found.` : (liveEvents.length ? 'Sources refreshed. No newly material development.' : 'Live sources checked. No new relevant event signal.'));
    } else if (periodChange && state.liveStatus === 'success') {
      showToast(`${periodPresetLabel()} applied. Intelligence and coverage recalculated.`);
    }
  } catch (error) {
    state.liveStatus = 'error';
    updateLastScanLabel();
    renderControlRoom();
    renderScopeToolbar();
    if (manual || periodChange) showToast('Live discovery is temporarily unavailable. The verified period record remains available.');
    console.warn('Live scan unavailable:', error);
  } finally {
    $('#refresh-button').classList.remove('is-loading');
  }
}

function gdeltDateParameter(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

async function directGdeltScan() {
  const query = '("Aditya Birla" OR Grasim OR Hindalco OR UltraTech OR Novelis OR "Vodafone Idea" OR ABFRL)';
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    maxrecords: '125',
    format: 'json',
    sort: 'datedesc',
    startdatetime: gdeltDateParameter(state.periodWindow.start),
    enddatetime: gdeltDateParameter(state.periodWindow.end)
  });
  const payload = await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { timeout: 12000 });
  const rawArticles = Array.isArray(payload?.articles) ? payload.articles : [];
  const formatted = rawArticles.map(formatLiveArticle);
  const relevant = formatted.filter((article) => {
    const published = new Date(article.publishedAt).getTime();
    return published >= new Date(state.periodWindow.start).getTime()
      && published <= new Date(state.periodWindow.end).getTime()
      && matchEntities(article.title, state.entities).length > 0;
  });
  const clusters = clusterArticles(relevant, state.entities);
  const events = clusters.map((cluster) => deriveLiveEvent(cluster, { entities: state.entities, sources: state.sources })).filter(Boolean).filter((event) => (event.intelligence?.materiality || 0) >= 35);
  return {
    events,
    meta: {
      scannedAt: new Date().toISOString(),
      articleCount: relevant.length,
      rawArticleCount: rawArticles.length,
      provider: 'GDELT direct',
      providers: ['GDELT direct'],
      queryCount: 1,
      successfulQueries: 1,
      errors: [],
      windowStart: state.periodWindow.start,
      windowEnd: state.periodWindow.end
    }
  };
}

async function loadInitialData() {
  const embedded = globalThis.__ABG_PULSE_QA_DATA__;
  const params = new URLSearchParams(location.search);
  state.demoMode = Boolean(embedded || globalThis.__ABG_PULSE_QA__ || params.has('qa') || params.has('demo'));
  let entities, sources, universe, buildPlan, demoEvents = [];
  if (embedded) {
    entities = embedded.entities;
    sources = embedded.sources;
    universe = embedded.entityUniverse || {};
    buildPlan = embedded.buildPlan || {};
    demoEvents = embedded.events || [];
  } else {
    [entities, sources, universe, buildPlan] = await Promise.all([
      fetchJson('./data/entities.json'),
      fetchJson('./data/source-registry.json'),
      fetchJson('./data/entity-universe-summary.json'),
      fetchJson('./data/build-milestones.json')
    ]);
    if (state.demoMode) demoEvents = await fetchJson('./data/demo-events.json');
  }
  state.entities = Array.isArray(entities) ? entities : [];
  state.sources = Array.isArray(sources) ? sources : [];
  state.entityUniverse = universe && typeof universe === 'object' ? universe : {};
  state.buildPlan = buildPlan && typeof buildPlan === 'object' ? buildPlan : {};
  state.demoEvents = Array.isArray(demoEvents) ? demoEvents : [];
  state.preferences = { ...DEFAULT_PREFERENCES, ...loadJsonStorage(STORAGE.preferences, {}) };
  state.previousOpenedAt = loadJsonStorage(STORAGE.lastOpened, null);
  const periodSettings = loadJsonStorage(STORAGE.period, {});
  state.periodPreset = PERIOD_LABELS[periodSettings?.preset] ? periodSettings.preset : '24h';
  state.comparePeriod = Boolean(periodSettings?.compare);
  $('#period-select').value = state.periodPreset;
  $('#custom-period-start').value = periodSettings?.customStart || toIstDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000));
  $('#custom-period-end').value = periodSettings?.customEnd || toIstDateTimeLocal(new Date());
  state.periodWindow = resolveSelectedPeriod(state.periodPreset);
  $('#custom-period').hidden = state.periodPreset !== 'custom';
  if (state.demoMode && !params.has('live')) state.preferences.liveScan = false;
  state.feedback = loadJsonStorage(STORAGE.feedback, []);

  const storedWatched = loadJsonStorage(STORAGE.watched, null);
  const defaults = state.demoMode ? state.demoEvents.filter((event) => !['stable'].includes(event.watchState)).map((event) => event.id) : [];
  state.watched = new Set(Array.isArray(storedWatched) ? storedWatched : defaults);

  const cachedLive = loadJsonStorage(STORAGE.liveEvents, []);
  const cachedMeta = loadJsonStorage(STORAGE.liveMeta, {});
  state.liveEvents = Array.isArray(cachedLive) ? cachedLive : [];
  state.liveMeta = cachedMeta || {};
  state.lastScanAt = cachedMeta.scannedAt || cachedMeta.lastScanAt || null;
  state.rawArticleCount = cachedMeta.articleCount || 0;
  state.events = dedupeEvents([...state.liveEvents, ...(state.demoMode ? state.demoEvents : [])]);

  try {
    if (state.demoMode) throw new Error('Demo/QA mode');
    const serverPayload = await fetchJson('/api/events', { timeout: 3500 });
    const serverEvents = Array.isArray(serverPayload?.events) ? serverPayload.events : [];
    if (serverPayload?.entityUniverse) state.entityUniverse = serverPayload.entityUniverse;
    if (serverEvents.length) state.events = dedupeEvents([...serverEvents, ...state.liveEvents]);
  } catch { /* live-on-demand mode remains valid without a persistent database */ }
}

function registerServiceWorker() {
  if (!globalThis.__ABG_PULSE_QA__ && 'serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}

async function init() {
  bindNavigation();
  bindMethodology();
  bindAsk();
  bindSearch();
  bindPeriodControls();
  bindPreferences();
  bindInstall();
  $('#refresh-button').addEventListener('click', () => scanLiveSources({ manual: true }));
  renderDateAndGreeting();

  try {
    await loadInitialData();
    renderAll();
    if (loadJsonStorage(STORAGE.knownEvents, null) === null) saveJsonStorage(STORAGE.knownEvents, state.demoMode ? state.demoEvents.map((event) => event.id) : []);
    saveJsonStorage(STORAGE.lastOpened, new Date().toISOString());
    const requestedView = location.hash.replace('#', '');
    if (requestedView && document.querySelector(`[data-view-panel="${CSS.escape(requestedView)}"]`)) switchView(requestedView);
    if (state.preferences.liveScan) scanLiveSources();
  } catch (error) {
    console.error(error);
    $('#scan-summary').textContent = 'The product could not load its local intelligence record.';
    $('#must-list').innerHTML = emptyCard('Initialisation failed', 'Reload the page. If the problem persists, inspect the Control Room and runtime logs.');
  }
}

registerServiceWorker();
init();
