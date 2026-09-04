import { createHash } from 'node:crypto';

const STOP = new Set([
  'a','an','and','are','as','at','be','been','being','by','for','from','has','have','had','in','is','it','its','of','on','or','that','the','to','was','were','will','with',
  'aditya','birla','group','limited','ltd','company','companies','says','said','reports','reported','report','update','updates','new','latest'
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

function words(value = '') {
  return [...new Set(normalize(value).split(' ').filter((word) => word.length >= 3 && !STOP.has(word)))];
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function list(value) {
  if (Array.isArray(value)) return value.flatMap(list);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return [value.id, value.entityId, value.name, value.text, value.claim, value.url].flatMap(list);
  return [String(value)];
}

function classification(value) {
  const raw = normalize(value).replace(/\s+/g, '');
  if (raw === 'mustknow') return 'Must Know';
  if (raw === 'watch') return 'Watch';
  return 'Other';
}

function classificationRank(value) {
  const bucket = classification(value);
  return bucket === 'Must Know' ? 3 : bucket === 'Watch' ? 2 : 1;
}

function verification(value) {
  return normalize(value).replace(/\s+/g, '-');
}

function verificationRank(value) {
  const status = verification(value);
  if (status === 'confirmed') return 5;
  if (status === 'strongly-corroborated') return 4;
  if (status === 'corroborated') return 3;
  if (status === 'single-source') return 2;
  if (status === 'disputed') return 1;
  return 0;
}

function eventVerification(event = {}) {
  return event.verificationStatus || event.evidenceChain?.verification?.status || event.evidencePolicy?.verificationStatus || 'unverified';
}

function eventClassification(event = {}) {
  return event.intelligence?.classification || event.classification || event.bucket || 'Other';
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function eventMateriality(event = {}) {
  return number(event.materiality ?? event.intelligence?.materiality, 0);
}

function eventAction(event = {}) {
  return normalize(event.actionPosture || event.intelligence?.actionPosture || event.action || '');
}

function eventLifecycle(event = {}) {
  return normalize(event.lifecycleStatus || event.lifecycle || 'emerging').replace(/\s+/g, '_');
}

function eventEntities(event = {}) {
  return [...new Set([
    event.primaryEntityId,
    event.entityId,
    event.entityIds,
    event.entities,
    event.relevantEntities,
    event.primaryEntity
  ].flatMap(list).map(normalize).filter(Boolean))].sort();
}

function claimRows(event = {}) {
  const chainGroups = event.evidenceChain?.claimGroups;
  const rows = Array.isArray(chainGroups) ? chainGroups : Array.isArray(event.claims) ? event.claims : [];
  return rows.map((claim) => ({
    id: claim.id || hash(normalize(claim.canonicalText || claim.text || claim.claim || '')).slice(0, 20),
    text: claim.canonicalText || claim.text || claim.claim || '',
    material: claim.material === true,
    supported: claim.supported === true || /confirmed|corroborated/.test(normalize(claim.verification || claim.verificationStatus || '')),
    verification: claim.verification || claim.verificationStatus || 'single-source',
    topicKey: normalize(claim.topicKey || words(claim.canonicalText || claim.text || '').slice(0, 12).sort().join(' ')),
    numericAnchors: [...new Set(list(claim.numericAnchors).map(normalize).filter((value) => /\d/.test(value)))],
    evidenceIds: [...new Set(list(claim.evidenceIds || claim.evidence).map(String).filter(Boolean))]
  })).filter((claim) => claim.text);
}

function supportedMaterialClaims(event = {}) {
  return claimRows(event).filter((claim) => claim.material && claim.supported);
}

function contradictions(event = {}) {
  return Array.isArray(event.evidenceChain?.contradictions) ? event.evidenceChain.contradictions : [];
}

function tier0Count(event = {}) {
  return number(event.evidenceChain?.tier0EvidenceCount ?? event.persistence?.tier0EvidenceCount, 0);
}

function independentSourceCount(event = {}) {
  return number(event.evidenceChain?.independentSourceCount ?? event.persistence?.independentSourceCount, 0);
}

function evidenceHash(event = {}) {
  return event.evidenceChain?.chainHash || event.evidenceChain?.evidenceHash || event.evidenceChainHash || event.evidenceHash || '';
}

function identity(event = {}) {
  if (event.id) return `id:${event.id}`;
  const entities = eventEntities(event).join('|');
  const topic = words(event.title || event.headline || event.summary || '').slice(0, 12).sort().join('|');
  return `fallback:${hash(`${entities}|${topic}`).slice(0, 24)}`;
}

function jaccard(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

function sameUnderlyingEvent(left = {}, right = {}) {
  if (left.id && right.id && left.id === right.id) return true;
  const entityOverlap = jaccard(eventEntities(left), eventEntities(right));
  const textOverlap = jaccard(words(left.title || left.headline || ''), words(right.title || right.headline || ''));
  return entityOverlap >= 0.5 && textOverlap >= 0.55;
}

function newClaims(current, previous) {
  const prior = supportedMaterialClaims(previous);
  return supportedMaterialClaims(current).filter((claim) => !prior.some((oldClaim) => {
    if (claim.id && oldClaim.id && claim.id === oldClaim.id) return true;
    return jaccard(words(claim.text), words(oldClaim.text)) >= 0.82 && (
      !claim.numericAnchors.length || !oldClaim.numericAnchors.length || claim.numericAnchors.some((anchor) => oldClaim.numericAnchors.includes(anchor))
    );
  }));
}

function numericChanges(current, previous) {
  const prior = supportedMaterialClaims(previous);
  const changes = [];
  for (const claim of supportedMaterialClaims(current)) {
    if (!claim.numericAnchors.length) continue;
    const comparable = prior.find((oldClaim) => {
      if (claim.topicKey && oldClaim.topicKey && jaccard(words(claim.topicKey), words(oldClaim.topicKey)) >= 0.6) return true;
      return jaccard(words(claim.text).filter((word) => !/\d/.test(word)), words(oldClaim.text).filter((word) => !/\d/.test(word))) >= 0.65;
    });
    if (!comparable?.numericAnchors?.length) continue;
    const same = claim.numericAnchors.some((anchor) => comparable.numericAnchors.includes(anchor));
    if (!same) changes.push({ claim, previousClaim: comparable });
  }
  return changes;
}

function verifiedEnough(event = {}) {
  const status = eventVerification(event);
  return verificationRank(status) >= verificationRank('corroborated') && status !== 'disputed';
}

function wordCount(value = '') {
  return String(value).trim().split(/\s+/).filter(Boolean).length;
}

function concise(value = '', maximumWords = 100) {
  const tokens = String(value).trim().split(/\s+/).filter(Boolean);
  return tokens.length <= maximumWords ? tokens.join(' ') : `${tokens.slice(0, maximumWords).join(' ')}…`;
}

function alertSummary(event, reasons) {
  const base = event.summary || event.description || event.title || event.headline || 'Material ABG development.';
  const why = event.whyItMatters || event.intelligence?.whyItMatters || '';
  const combined = [base, why, reasons.length ? `Why this alert fired: ${reasons.join('; ')}.` : ''].filter(Boolean).join(' ');
  const clipped = concise(combined, 100);
  if (wordCount(clipped) >= 45) return clipped;
  return concise(`${clipped} Verification: ${eventVerification(event)}.`, 100);
}

export function compareEventChange(current = {}, previous = null, {
  mustKnowNewThreshold = 60,
  watchNewThreshold = 75,
  notificationThreshold = 50
} = {}) {
  const reasons = [];
  const signals = [];
  const currentBucket = classification(eventClassification(current));
  const currentVerification = eventVerification(current);
  const currentMateriality = eventMateriality(current);
  const currentLifecycle = eventLifecycle(current);
  const isDisputed = currentVerification === 'disputed' || contradictions(current).length > 0;

  if (!previous) {
    if (currentBucket === 'Must Know') {
      reasons.push('new Must Know development');
      signals.push({ name: 'new_must_know', weight: 70 });
    } else if (currentBucket === 'Watch' && currentMateriality >= watchNewThreshold) {
      reasons.push('new high-materiality Watch development');
      signals.push({ name: 'new_high_watch', weight: 52 });
    } else {
      reasons.push('new development below notification threshold');
      signals.push({ name: 'new_low_priority', weight: 20 });
    }
    if (tier0Count(current) > 0) signals.push({ name: 'tier0_confirmation', weight: 18 });
    if (independentSourceCount(current) >= 2) signals.push({ name: 'independent_corroboration', weight: 12 });
  } else {
    const oldBucket = classification(eventClassification(previous));
    const oldVerification = eventVerification(previous);
    const oldLifecycle = eventLifecycle(previous);
    const bucketDelta = classificationRank(currentBucket) - classificationRank(oldBucket);
    const verificationDelta = verificationRank(currentVerification) - verificationRank(oldVerification);
    const materialityDelta = currentMateriality - eventMateriality(previous);
    const addedClaims = newClaims(current, previous);
    const changedNumbers = numericChanges(current, previous);
    const contradictionDelta = contradictions(current).length - contradictions(previous).length;
    const tier0Delta = tier0Count(current) - tier0Count(previous);
    const independentDelta = independentSourceCount(current) - independentSourceCount(previous);
    const actionChanged = eventAction(current) && eventAction(current) !== eventAction(previous);

    if (bucketDelta > 0) {
      reasons.push(`priority escalated from ${oldBucket} to ${currentBucket}`);
      signals.push({ name: 'classification_escalation', weight: currentBucket === 'Must Know' ? 65 : 35 });
    }
    if (verificationDelta > 0) {
      reasons.push(`verification strengthened to ${currentVerification}`);
      signals.push({ name: 'verification_strengthened', weight: currentVerification === 'confirmed' ? 35 : 22 });
    }
    if (tier0Delta > 0) {
      reasons.push('new direct authoritative evidence');
      signals.push({ name: 'new_tier0_evidence', weight: 35 });
    } else if (independentDelta > 0 && independentSourceCount(current) >= 2) {
      reasons.push('new independent corroboration');
      signals.push({ name: 'new_corroboration', weight: 18 });
    }
    if (addedClaims.length) {
      reasons.push(`${addedClaims.length} new supported material claim${addedClaims.length === 1 ? '' : 's'}`);
      signals.push({ name: 'new_material_claim', weight: Math.min(55, 30 + addedClaims.length * 8) });
    }
    if (changedNumbers.length) {
      reasons.push(`${changedNumbers.length} material numeric fact${changedNumbers.length === 1 ? '' : 's'} changed`);
      signals.push({ name: 'numeric_fact_changed', weight: Math.min(60, 40 + changedNumbers.length * 8) });
    }
    if (Math.abs(materialityDelta) >= 15) {
      reasons.push(`materiality changed by ${Math.round(materialityDelta)} points`);
      signals.push({ name: 'materiality_shift', weight: Math.min(35, Math.abs(materialityDelta)) });
    }
    if (actionChanged) {
      reasons.push('recommended action posture changed');
      signals.push({ name: 'action_changed', weight: 24 });
    }
    if (contradictionDelta > 0) {
      reasons.push('new unresolved contradiction');
      signals.push({ name: 'contradiction_appeared', weight: 38 });
    } else if (contradictionDelta < 0) {
      reasons.push('an earlier contradiction was resolved');
      signals.push({ name: 'contradiction_resolved', weight: 35 });
    }
    if (currentLifecycle !== oldLifecycle && ['corrected','retracted'].includes(currentLifecycle)) {
      reasons.push(`event was ${currentLifecycle}`);
      signals.push({ name: currentLifecycle, weight: 90 });
    }
    if (!signals.length) {
      reasons.push('no material fact, priority, verification or action change');
      signals.push({ name: 'source_or_wording_only', weight: 0 });
    }
  }

  const score = Math.min(100, Math.round(signals.reduce((sum, signal) => sum + signal.weight, 0)));
  const correctionOrRetraction = ['corrected','retracted'].includes(currentLifecycle);
  const minimumMateriality = currentBucket === 'Must Know' ? mustKnowNewThreshold : currentBucket === 'Watch' ? watchNewThreshold : 100;
  const eligible = score >= notificationThreshold
    && (verifiedEnough(current) || correctionOrRetraction)
    && !isDisputed
    && (currentMateriality >= minimumMateriality || correctionOrRetraction || signals.some((signal) => signal.name === 'classification_escalation'));
  const reviewRequired = isDisputed || signals.some((signal) => signal.name === 'contradiction_appeared');
  const type = !previous ? 'new' : correctionOrRetraction ? currentLifecycle : score > 0 ? 'material_update' : 'unchanged';
  const notificationKey = hash([
    identity(current),
    type,
    currentBucket,
    currentVerification,
    evidenceHash(current),
    supportedMaterialClaims(current).map((claim) => claim.id).sort().join('|'),
    currentLifecycle
  ].join('|'));

  return {
    eventId: current.id || null,
    identity: identity(current),
    type,
    score,
    notificationEligible: eligible,
    reviewRequired,
    reasons,
    signals,
    notificationKey,
    alertSummary: alertSummary(current, reasons),
    current: {
      classification: currentBucket,
      verification: currentVerification,
      materiality: currentMateriality,
      lifecycle: currentLifecycle,
      tier0EvidenceCount: tier0Count(current),
      independentSourceCount: independentSourceCount(current),
      evidenceHash: evidenceHash(current)
    },
    previous: previous ? {
      classification: classification(eventClassification(previous)),
      verification: eventVerification(previous),
      materiality: eventMateriality(previous),
      lifecycle: eventLifecycle(previous),
      tier0EvidenceCount: tier0Count(previous),
      independentSourceCount: independentSourceCount(previous),
      evidenceHash: evidenceHash(previous)
    } : null
  };
}

export function detectMaterialChanges({ currentEvents = [], previousEvents = [], previouslyNotifiedKeys = [], options = {} } = {}) {
  const previous = [...previousEvents];
  const notified = new Set(previouslyNotifiedKeys.map(String));
  const changes = currentEvents.map((current) => {
    const match = previous.find((candidate) => sameUnderlyingEvent(current, candidate)) || null;
    const change = compareEventChange(current, match, options);
    const duplicateNotification = notified.has(change.notificationKey);
    return {
      ...change,
      duplicateNotification,
      notificationEligible: change.notificationEligible && !duplicateNotification,
      event: current
    };
  });
  const eligible = changes.filter((change) => change.notificationEligible);
  const review = changes.filter((change) => change.reviewRequired);
  const suppressed = changes.filter((change) => !change.notificationEligible);
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      currentEvents: currentEvents.length,
      previousEvents: previousEvents.length,
      materialChanges: changes.filter((change) => change.score > 0).length,
      notificationEligible: eligible.length,
      reviewRequired: review.length,
      suppressed: suppressed.length,
      duplicateNotificationsSuppressed: changes.filter((change) => change.duplicateNotification).length
    },
    changes,
    eligible,
    review,
    suppressed,
    policy: {
      newMustKnow: 'Verified Must Know with materiality at or above 60.',
      newWatch: 'Verified Watch with materiality at or above 75.',
      materialUpdate: 'Priority, verification, authoritative evidence, supported claim, numeric fact, action posture, contradiction or lifecycle changed.',
      noAlert: 'Source-count growth, syndication or headline wording alone does not notify.',
      deduplication: 'Identical notification keys are suppressed.'
    }
  };
}
