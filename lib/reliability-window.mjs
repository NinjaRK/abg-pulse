import { dateParts, safeSourceUrl } from './entity-history.mjs';
const DAY = 86400000;
const count = n => Number.isSafeInteger(n) && n >= 0;
export function assessReliabilityWindow(ledger, now = new Date()) {
  const reasons = []; const days = Array.isArray(ledger?.days) ? ledger.days : [];
  if (!Number.isFinite(now.getTime())) return { eligibleForIndependentReview:false, proven:false, reasons:['Invalid clock.'], observedDays:0 };
  if (ledger?.referenceSet?.status !== 'connected' || ledger?.referenceSet?.owner !== 'independent') reasons.push('Independent reference set is not connected.');
  if (!ledger?.operationalPrerequisites || ['deployment','persistence','sourceCoverage'].some(k => ledger.operationalPrerequisites[k] !== true)) reasons.push('Production prerequisites are not evidenced.');
  if (days.length !== 30) reasons.push('Exactly 30 complete consecutive daily records are required.');
  const dates = days.map(day => dateParts(day?.date, false)?.time);
  if (dates.some(x => x === undefined) || new Set(dates).size !== dates.length) reasons.push('Daily dates are invalid or duplicated.');
  const sorted = dates.filter(Number.isFinite).sort((a,b)=>a-b);
  if (sorted.some((date,i) => date + DAY > now.getTime() || (i > 0 && date - sorted[i-1] !== DAY))) reasons.push('Days must be elapsed, complete and consecutive.');
  let criticalTotal=0, criticalDetected=0, highTotal=0, highDetected=0;
  for (const day of days) {
    const m=day.metrics || {};
    const keys=['criticalEvents','criticalEventsDetected','highMaterialityWeight','detectedHighMaterialityWeight','unsupportedMaterialClaims','silentTier0Outages'];
    if (keys.some(k=>!count(m[k])) || m.criticalEventsDetected > m.criticalEvents || m.detectedHighMaterialityWeight > m.highMaterialityWeight) { reasons.push(`Invalid daily counters: ${day.date}`); continue; }
    if (m.criticalEvents !== m.criticalEventsDetected || m.unsupportedMaterialClaims !== 0 || m.silentTier0Outages !== 0) reasons.push(`A daily safety gate failed: ${day.date}`);
    for (const field of ['productionEvidence','independentEvidence']) {
      const e=day[field];if (!e || !safeSourceUrl(e.url) || !/^[a-f0-9]{64}$/.test(e.sha256 || '')) reasons.push(`Missing evidence descriptor: ${day.date}/${field}`);
    }
    if (!dateParts(day.recordedAt?.slice(0,10),false) || !Number.isFinite(Date.parse(day.recordedAt)) || Date.parse(day.recordedAt) < (dateParts(day.date,false)?.time || Infinity)+DAY || Date.parse(day.recordedAt)>now.getTime()) reasons.push(`Invalid observation time: ${day.date}`);
    criticalTotal+=m.criticalEvents;criticalDetected+=m.criticalEventsDetected;highTotal+=m.highMaterialityWeight;highDetected+=m.detectedHighMaterialityWeight;
  }
  if (!criticalTotal || criticalDetected!==criticalTotal) reasons.push('The full window must demonstrate complete critical-event recall.');
  if (!highTotal || highDetected/highTotal < .98) reasons.push('The high-materiality weighted recall threshold is not demonstrated.');
  return { eligibleForIndependentReview:reasons.length===0, proven:false, observedDays:days.length, reasons:[...new Set(reasons)], note:'This structural and arithmetic check does not authenticate remote evidence, prove factual entailment, or certify the service. Independent evidence review is still required.' };
}
