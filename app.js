const IST = 'Asia/Kolkata';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const state = { events:[], meta:null, progress:null, health:null, window:null, scanning:false };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const explanations = {
  brief:{ title:'The sharp conclusion', body:'A plain-English editorial summary of the selected period: how many developments materially changed today’s picture, what remains on Watch, and whether the overall coverage tone is positive, mixed or negative. It is generated only after the live source scan completes.' },
  must:{ title:'Must Know', body:'A development that materially changes today’s senior-management picture and is supported strongly enough to brief now. Current gate: authoritative confirmation with materiality of at least 62, or materiality of at least 72 with confidence of at least 76. Article volume alone cannot make a story Must Know.' },
  watch:{ title:'Watch', body:'A development that may become important, needs more confirmation, or is accelerating fast enough to prepare for now. Watch is not a claim that the underlying report is true.' },
  events:{ title:'Actual events', body:'Articles about the same underlying development are collapsed into one event using headline similarity, shared entities, numerical anchors, timing and source lineage. One event may therefore represent many articles.' },
  articles:{ title:'Relevant articles', body:'Retrieved articles within the exact selected period that matched a governed ABG entity after ambiguity checks. Raw search results and unrelated Birla or Vi matches are excluded.' },
  coverage:{ title:'Source coverage', body:'The numerator is checks that actually completed during this scan. The denominator is checks attempted. A successful HTTP response with zero items is shown separately from a failed source. Registered sources are never presented as if they were checked.' },
  mediaTone:{ title:'Media Tone', body:'A directional score from −100 to +100 based on positive and negative language in retrieved media coverage, with simple negation handling. It measures article tone—not consumer opinion, reputation value or the views of the whole public. Broader public sentiment requires authorised social-listening data.' },
  radar:{ title:'Narrative Radar', body:'An early-warning view combining news momentum, entity-specific Media Tone, official-versus-media framing and a probabilistic importance estimate. These signals help decide what to inspect; they are not facts.' },
  momentum:{ title:'Momentum', body:'A 0–100 signal based on recency, article volume and independent source-family breadth. Sister publications are collapsed into one family so syndication does not masquerade as independent acceleration.' },
  prediction:{ title:'Likely importance', body:'A transparent heuristic estimate for whether an event may become more important within 24 hours, based on materiality, momentum and uncertainty. It is explicitly labelled uncalibrated until enough real outcomes have been graded.' },
  drift:{ title:'Narrative alignment', body:'Where both authoritative and media headlines exist, the product compares their framing. Low textual alignment is a prompt for human review—not automatic proof of misinformation or narrative loss.' },
  misses:{ title:'What we may have missed', body:'Visible evidence of possible blind spots: failed or timed-out source checks, incomplete official-register extraction, or source categories not yet connected. Dependability means exposing uncertainty, not decorating it away.' },
  jobMeter:{ title:'Job Meter', body:'The overall percentage is the weighted completion of all milestones. Progress is credited only when evidence exists. Drafted code, an unconnected workflow or a visually complete screen does not count as an operational capability.' }
};

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g,(character)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[character]));
}

function formatDate(date, includeTime=true) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', includeTime
    ? { day:'2-digit', month:'short', hour:'numeric', minute:'2-digit', timeZone:IST }
    : { day:'2-digit', month:'short', year:'numeric', timeZone:IST }
  ).format(value);
}

function startOfToday(now=new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{ year:'numeric',month:'2-digit',day:'2-digit',timeZone:IST }).format(now);
  return new Date(`${parts}T00:00:00+05:30`);
}

function lastVisit() {
  const stored = localStorage.getItem('abgPulseLastVisit');
  const parsed = stored ? new Date(stored) : new Date(Date.now() - DAY);
  return Number.isNaN(parsed.getTime()) ? new Date(Date.now() - DAY) : parsed;
}

function selectedWindow() {
  const end = new Date();
  const value = $('#periodSelect').value;
  let start;
  if (value === 'last_visit') start = lastVisit();
  else if (value === '1h') start = new Date(end.getTime() - HOUR);
  else if (value === '6h') start = new Date(end.getTime() - 6 * HOUR);
  else if (value === '24h') start = new Date(end.getTime() - DAY);
  else if (value === 'today') start = startOfToday(end);
  else if (value === '7d') start = new Date(end.getTime() - 7 * DAY);
  else if (value === '30d') start = new Date(end.getTime() - 30 * DAY);
  else {
    start = new Date($('#customStart').value);
    const customEnd = new Date($('#customEnd').value);
    if (!Number.isNaN(customEnd.getTime())) return { start:Number.isNaN(start.getTime()) ? new Date(end.getTime()-DAY) : start, end:customEnd };
  }
  return { start, end };
}

function updateWindowLabel() {
  state.window = selectedWindow();
  $('#coverageWindow').textContent = `${formatDate(state.window.start)} – ${formatDate(state.window.end)} IST`;
}

async function fetchJson(url) {
  const response = await fetch(url,{ cache:'no-store' });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`Expected JSON but received ${response.status} ${response.statusText}.`); }
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
  return payload;
}

function setBanner(message='', type='') {
  const node = $('#statusBanner');
  node.hidden = !message;
  node.className = `status-banner ${type}`.trim();
  node.innerHTML = message;
}

function toneLabel(score) {
  if (!Number.isFinite(score)) return 'No measured tone';
  if (score >= 25) return 'Positive';
  if (score <= -25) return 'Negative';
  return 'Neutral / mixed';
}

function aggregateTone(events) {
  if (!events.length) return null;
  let weighted = 0, weight = 0;
  events.forEach((event)=>{
    const score = Number(event.intelligence?.mediaTone ?? event.intelligence?.sentiment);
    if (!Number.isFinite(score)) return;
    const eventWeight = Math.max(1, Number(event.articleCount || event.sourceCount || 1));
    weighted += score * eventWeight; weight += eventWeight;
  });
  return weight ? Math.round(weighted / weight) : null;
}

function updateSummary() {
  const events = state.events;
  const must = events.filter((event)=>event.bucket === 'must');
  const watch = events.filter((event)=>event.bucket === 'watch');
  const tone = aggregateTone(events);
  $('#mustCount').textContent = must.length;
  $('#watchCount').textContent = watch.length;
  $('#eventCount').textContent = events.length;
  $('#sourceCount').textContent = state.meta ? `${state.meta.successfulChecks}/${state.meta.totalChecks}` : '—';
  $('#articleCount').textContent = state.meta?.articleCount ?? '—';
  $('#toneScore').textContent = tone === null ? '—' : `${tone > 0 ? '+' : ''}${tone}`;
  $('#toneLabel').textContent = toneLabel(tone);
  $('#tonePointer').style.left = `${tone === null ? 50 : Math.max(0,Math.min(100,(tone + 100)/2))}%`;

  if (!state.meta) {
    $('#briefHeadline').textContent = 'No completed scan yet';
    $('#briefSummary').textContent = 'Refresh intelligence to check the selected period.';
    return;
  }
  if (!events.length) {
    $('#briefHeadline').textContent = 'Nothing material found in this window';
    $('#briefSummary').textContent = `${state.meta.successfulChecks} of ${state.meta.totalChecks} checks completed. Review Coverage before treating this as a clean bill of health.`;
    return;
  }
  $('#briefHeadline').textContent = must.length ? `${must.length} ${must.length === 1 ? 'development changes' : 'developments change'} today’s picture` : `${watch.length} ${watch.length === 1 ? 'development needs' : 'developments need'} watching`;
  const top = [...must,...watch].slice(0,2).map((event)=>event.headline).join(' · ');
  $('#briefSummary').textContent = `${top || 'Relevant developments were found.'} Overall Media Tone is ${toneLabel(tone).toLowerCase()}.`;
}

function scoreChip(label,value,kind='') {
  return `<span class="score-chip ${kind}">${escapeHtml(label)} ${escapeHtml(value)}</span>`;
}

function eventCard(event) {
  const tone = Number(event.intelligence?.mediaTone ?? event.intelligence?.sentiment ?? 0);
  const toneKind = tone >= 25 ? 'positive' : tone <= -25 ? 'negative' : '';
  const p24 = event.intelligence?.prediction?.p24 ?? event.intelligence?.prediction24 ?? '—';
  return `<article class="story-card ${escapeHtml(event.bucket || 'other')}">
    <div class="card-top"><span class="entity-line">${escapeHtml(event.entity || event.primaryEntity?.name || 'ABG')} · ${escapeHtml(event.category || 'Corporate')}</span><span class="status-pill">${escapeHtml(event.status || 'Developing')}</span></div>
    <h3>${escapeHtml(event.headline || event.title)}</h3>
    <p class="summary">${escapeHtml(event.summary || '')}</p>
    <div class="why"><b>Why it matters:</b> ${escapeHtml(event.whyItMatters || event.interpretation || '')}</div>
    <div class="score-row">
      ${scoreChip('Materiality',event.intelligence?.materiality ?? '—')}
      ${scoreChip('Momentum',event.intelligence?.momentum ?? '—')}
      ${scoreChip('Tone',`${tone > 0 ? '+' : ''}${tone}`,toneKind)}
      ${scoreChip('24h',`${p24}%`)}
    </div>
    <div class="meta-row"><span>${event.sourceCount || 0} independent source families</span><span>${event.articleCount || event.sources?.length || 0} articles</span><span>Updated ${formatDate(event.updatedAt)}</span></div>
    <div class="card-actions"><button data-story="${escapeHtml(event.id)}">Evidence & method</button></div>
  </article>`;
}

function renderSection(target,title,description,events) {
  const node = $(target);
  node.innerHTML = `<section class="section-block"><div class="section-heading"><div><h2>${title} <button class="info" data-info="${title === 'Must Know' ? 'must' : title === 'Watch' ? 'watch' : 'events'}">i</button></h2><p>${description}</p></div><p>${events.length}</p></div>${events.length ? `<div class="story-grid">${events.map(eventCard).join('')}</div>` : `<div class="empty-state">Nothing in this category for the selected period.</div>`}</section>`;
}

function renderToday() {
  renderSection('#mustSection','Must Know','Changes today’s senior-management picture.',state.events.filter((event)=>event.bucket === 'must'));
  renderSection('#watchSection','Watch','May become important; prepare or verify.',state.events.filter((event)=>event.bucket === 'watch'));
  renderSection('#otherSection','Other Developments','Relevant to the record, but not urgent.',state.events.filter((event)=>event.bucket === 'other'));
  const caught = $('#caughtUp');
  caught.hidden = !state.meta;
  if (state.meta) $('#caughtUpText').textContent = `${state.meta.articleCount || 0} relevant articles collapsed into ${state.events.length} actual events. ${state.meta.failedChecks || 0} source checks failed and remain visible in Coverage.`;
  bindDynamicControls();
}

function renderRadar() {
  const sorted = [...state.events].sort((a,b)=>Number(b.intelligence?.momentum||0)-Number(a.intelligence?.momentum||0));
  $('#trendingList').innerHTML = sorted.length ? sorted.slice(0,8).map((event,index)=>`<div class="trend-row"><div><b>${index+1}. ${escapeHtml(event.headline)}</b><div class="bar"><i style="width:${Math.max(0,Math.min(100,event.intelligence?.momentum||0))}%"></i></div><small>${escapeHtml(event.entity || event.primaryEntity?.name || 'ABG')}</small></div><span class="trend-score">${event.intelligence?.momentum || 0}</span></div>`).join('') : '<div class="empty-state">No live trend signal in this period.</div>';

  const predicted = [...state.events].filter((event)=>Number(event.intelligence?.prediction?.p24 ?? event.intelligence?.prediction24 ?? 0) >= 55).sort((a,b)=>Number(b.intelligence?.prediction?.p24||0)-Number(a.intelligence?.prediction?.p24||0));
  $('#predictionList').innerHTML = predicted.length ? predicted.slice(0,7).map((event)=>`<div class="prediction-item"><strong>${event.intelligence?.prediction?.p24 ?? event.intelligence?.prediction24}%</strong> · ${escapeHtml(event.headline)}<br><small>${escapeHtml(event.status)} · heuristic until calibrated</small></div>`).join('') : '<div class="empty-state">No story crosses the current threshold.</div>';

  const byEntity = new Map();
  state.events.forEach((event)=>{
    const name = event.entity || event.primaryEntity?.name || 'ABG';
    const score = Number(event.intelligence?.mediaTone ?? event.intelligence?.sentiment);
    if (!Number.isFinite(score)) return;
    const row = byEntity.get(name) || { total:0,weight:0 };
    const weight = Math.max(1,event.articleCount || 1); row.total += score*weight; row.weight += weight; byEntity.set(name,row);
  });
  const entityRows = [...byEntity.entries()].map(([name,row])=>[name,Math.round(row.total/row.weight)]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,10);
  $('#entityTone').innerHTML = entityRows.length ? entityRows.map(([name,score])=>`<div class="tone-row"><b>${escapeHtml(name)}</b><span>${score > 0 ? '+' : ''}${score}</span><div class="tone-mini"><i style="left:${Math.max(0,Math.min(100,(score+100)/2))}%"></i></div></div>`).join('') : '<div class="empty-state">No entity-level tone signal.</div>';

  const drift = state.events.filter((event)=>event.intelligence?.narrativeDrift?.score !== null && event.intelligence?.narrativeDrift?.score !== undefined).sort((a,b)=>b.intelligence.narrativeDrift.score-a.intelligence.narrativeDrift.score);
  $('#driftList').innerHTML = drift.length ? drift.slice(0,7).map((event)=>`<div class="drift-item"><b>${escapeHtml(event.headline)}</b><br><span>${escapeHtml(event.intelligence.narrativeDrift.label)} · ${event.intelligence.narrativeDrift.score}/100</span></div>`).join('') : '<div class="empty-state">Insufficient official-versus-media pairs to calculate narrative alignment.</div>';
}

function renderSearch() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const events = state.events.filter((event)=>!query || JSON.stringify(event).toLowerCase().includes(query));
  $('#searchResults').innerHTML = events.length ? `<div class="story-grid">${events.map(eventCard).join('')}</div>` : '<div class="empty-state">No matching evidence-led development in this period.</div>';
  bindDynamicControls();
}

function renderCoverage() {
  const meta = state.meta;
  if (!meta) {
    $('#coverageSummary').innerHTML = '';
    $('#coverageTable').innerHTML = '<div class="empty-state">Complete a scan to see actual source health.</div>';
    $('#possibleMisses').innerHTML = '<div class="miss-item">No source-health evidence yet.</div>';
    return;
  }
  $('#coverageSummary').innerHTML = [
    ['Attempted',meta.totalChecks],['Succeeded',meta.successfulChecks],['Failed',meta.failedChecks],['Relevant items',meta.articleCount]
  ].map(([label,value])=>`<article><strong>${value ?? '—'}</strong><span>${label}</span></article>`).join('');
  const rows = meta.sourceChecks || [];
  $('#coverageTable').innerHTML = `<div class="coverage-row head"><span>Source check</span><span>Provider</span><span>Items</span><span>Status</span></div>${rows.map((check)=>`<div class="coverage-row"><b>${escapeHtml(check.name)}</b><span>${escapeHtml(check.provider)}</span><span>${check.itemCount ?? 0}</span><span class="${check.ok ? 'health-ok' : 'health-fail'}">${check.ok ? 'Healthy' : 'Failed'}</span></div>`).join('')}`;
  const misses = [];
  if (meta.failedChecks) misses.push(`${meta.failedChecks} attempted checks failed or timed out.`);
  if (meta.entityAudit && !meta.entityAudit.companyRegisterComplete) misses.push('The official company register did not meet the expected coverage gate during this scan.');
  if (meta.entityAudit && !meta.entityAudit.leadershipRegisterComplete) misses.push('The official leadership register did not meet the expected coverage gate during this scan.');
  if (!state.health?.database?.configured) misses.push('Persistent central history is not connected; this scan is live but stateless across users.');
  misses.push('Closed social platforms, print-only and broadcast sources are not comprehensive until authorised or licensed feeds are connected.');
  $('#possibleMisses').innerHTML = misses.map((item)=>`<div class="miss-item">${escapeHtml(item)}</div>`).join('');
}

function renderBuild() {
  const progress = state.progress;
  if (!progress) return;
  $('#objectiveText').textContent = progress.objective;
  $('#sideProgress').textContent = `${progress.overallPercent}%`;
  $('#sideProgressBar').style.width = `${progress.overallPercent}%`;
  $('#jobPercent').textContent = `${progress.overallPercent}%`;
  $('#jobRing').style.background = `conic-gradient(var(--wine) ${progress.overallPercent}%,var(--paper-2) 0)`;
  $('#milestoneList').innerHTML = progress.milestones.map((milestone)=>`<article class="milestone"><div class="milestone-top"><span class="milestone-id">${escapeHtml(milestone.id)}</span><span class="milestone-name">${escapeHtml(milestone.name)}</span><span class="milestone-percent">${milestone.complete}%</span></div><div class="milestone-bar"><i style="width:${milestone.complete}%"></i></div><div class="milestone-details"><span class="milestone-status">${escapeHtml(milestone.status)}</span><span><b>Evidence:</b> ${escapeHtml(milestone.evidence)}</span><span><b>Next:</b> ${escapeHtml(milestone.next || 'Gate passed.')}</span>${milestone.dependency ? `<span><b>Dependency:</b> ${escapeHtml(milestone.dependency)}</span>` : ''}</div></article>`).join('');
  $('#dependencyList').innerHTML = progress.unresolvedExternalDependencies.map((item)=>`<div class="dependency-item">${escapeHtml(item)}</div>`).join('');
}

function openInfo(key) {
  const info = explanations[key];
  if (!info) return;
  $('#infoTitle').textContent = info.title;
  $('#infoBody').innerHTML = `<p>${escapeHtml(info.body)}</p>`;
  $('#infoDialog').showModal();
}

function openStory(id) {
  const event = state.events.find((item)=>item.id === id);
  if (!event) return;
  $('#storyKicker').textContent = `${event.entity || event.primaryEntity?.name || 'ABG'} · ${event.status} · ${event.action || ''}`;
  $('#storyTitle').textContent = event.headline || event.title;
  const sources = (event.sources || []).map((source)=>`<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name || source.domain || 'Source')}</a>`).join('');
  $('#storyBody').innerHTML = `<div class="dialog-section"><h3>Reported facts</h3><div class="claim">${escapeHtml(event.summary || '')}</div></div><div class="dialog-section"><h3>Interpretation</h3><p>${escapeHtml(event.whyItMatters || event.interpretation || '')}</p></div><div class="dialog-section"><h3>Evidence sources</h3><div class="source-list">${sources || 'No accessible source link.'}</div></div><div class="dialog-section"><h3>Why this classification</h3><p>Materiality ${event.intelligence?.materiality ?? '—'} · confidence ${event.intelligence?.confidence ?? event.intelligence?.certainty ?? '—'} · momentum ${event.intelligence?.momentum ?? '—'} · ${event.sourceCount || 0} independent source families.</p></div>`;
  $('#storyDialog').showModal();
}

function bindDynamicControls() {
  $$('[data-info]').forEach((button)=>{ button.onclick = (event)=>{ event.stopPropagation(); openInfo(button.dataset.info); }; });
  $$('[data-story]').forEach((button)=>{ button.onclick = ()=>openStory(button.dataset.story); });
}

function activateView(view) {
  $$('.view').forEach((node)=>node.classList.toggle('active',node.id === `view-${view}`));
  $$('.nav-item,.mobile-nav button').forEach((button)=>button.classList.toggle('active',button.dataset.view === view));
  if (view === 'radar') renderRadar();
  if (view === 'search') renderSearch();
  if (view === 'coverage') renderCoverage();
  if (view === 'build') renderBuild();
  window.scrollTo({ top:0,behavior:'smooth' });
}

async function scan() {
  if (state.scanning) return;
  state.scanning = true; updateWindowLabel();
  $('#scanButton').disabled = true; $('#scanButton').textContent = 'Scanning…'; $('#sideStatus').textContent = 'Scanning public sources';
  setBanner('Checking the selected ABG universe. One failing source will not hide the results from healthy sources.','');
  try {
    const params = new URLSearchParams({ start:state.window.start.toISOString(),end:state.window.end.toISOString() });
    const payload = await fetchJson(`/api/scan?${params}`);
    state.events = Array.isArray(payload.events) ? payload.events : [];
    state.meta = payload.meta || null;
    $('#lastScan').textContent = state.meta?.scannedAt ? `${formatDate(state.meta.scannedAt)} IST` : 'Completed';
    $('#sideStatus').textContent = state.meta?.failedChecks ? `${state.meta.failedChecks} source checks failed` : 'Live scan healthy';
    const type = state.meta?.failedChecks ? '' : 'success';
    setBanner(`${state.meta?.successfulChecks || 0} of ${state.meta?.totalChecks || 0} source checks completed. ${state.meta?.failedChecks || 0} failures remain visible in Coverage.`,type);
    updateSummary(); renderToday(); renderRadar(); renderSearch(); renderCoverage();
    localStorage.setItem('abgPulseLastVisit',new Date().toISOString());
  } catch (error) {
    state.events = []; state.meta = null;
    setBanner(`<b>Live scan unavailable.</b> ${escapeHtml(error.message)} No cached story has been presented as current.`,'error');
    $('#sideStatus').textContent = 'Scan failed';
    updateSummary(); renderToday(); renderRadar(); renderSearch(); renderCoverage();
  } finally {
    state.scanning = false; $('#scanButton').disabled = false; $('#scanButton').textContent = 'Refresh intelligence';
  }
}

async function loadSystemState() {
  const [health,progress] = await Promise.allSettled([fetchJson('/api/health'),fetchJson('/api/progress')]);
  if (health.status === 'fulfilled') { state.health = health.value; $('#versionLabel').textContent = `v${health.value.version || '5.3'}`; }
  if (progress.status === 'fulfilled') { state.progress = progress.value; renderBuild(); }
}

function initCustomDates() {
  const local = (date)=>new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);
  const end = new Date(); const start = new Date(end.getTime()-DAY);
  $('#customStart').value = local(start); $('#customEnd').value = local(end);
}

function init() {
  const hour = Number(new Intl.DateTimeFormat('en-IN',{ hour:'2-digit',hour12:false,timeZone:IST }).format(new Date()));
  $('#greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, Rishi`;
  initCustomDates();
  const saved = localStorage.getItem('abgPulsePeriod');
  if (saved && [...$('#periodSelect').options].some((option)=>option.value === saved)) $('#periodSelect').value = saved;
  updateWindowLabel();
  $('#periodSelect').onchange = ()=>{
    const custom = $('#periodSelect').value === 'custom'; $('#customPeriod').hidden = !custom;
    localStorage.setItem('abgPulsePeriod',$('#periodSelect').value); updateWindowLabel(); if (!custom) scan();
  };
  $('#applyCustom').onclick = scan; $('#scanButton').onclick = scan;
  $('#searchInput').oninput = renderSearch;
  $$('.nav-item,.mobile-nav button,.job-mini').forEach((button)=>button.onclick = ()=>activateView(button.dataset.view));
  $('#closeInfo').onclick = ()=>$('#infoDialog').close(); $('#closeStory').onclick = ()=>$('#storyDialog').close();
  $('#shareButton').onclick = async()=>{
    const share = { title:'ABG Pulse',text:'ABG Pulse — one-minute, evidence-led ABG intelligence.',url:location.href };
    if (navigator.share) await navigator.share(share); else { await navigator.clipboard.writeText(location.href); $('#shareButton').textContent = 'Link copied'; setTimeout(()=>$('#shareButton').textContent='Share',1600); }
  };
  bindDynamicControls();
  loadSystemState().finally(scan);
  setInterval(()=>{ if (!document.hidden && !state.scanning) scan(); },5*60_000);
}

document.addEventListener('DOMContentLoaded',init);
