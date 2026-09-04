import { attachEvidenceChain } from './evidence-chain.mjs';

function currentClassification(event = {}) {
  return String(event?.intelligence?.classification || event.classification || event.bucket || '').trim();
}

function lower(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function setClassification(event, classification, reason) {
  return {
    ...event,
    classification,
    bucket: classification,
    intelligence: {
      ...(event.intelligence || {}),
      classification,
      verificationPolicyReason: reason
    }
  };
}

export function applyEvidencePolicy(event = {}, cluster = {}, options = {}) {
  let attached = attachEvidenceChain(event, cluster, options);
  const chain = attached.evidenceChain;
  const original = currentClassification(attached);
  const normalized = lower(original);
  const status = chain?.verification?.status || 'single-source';
  const confirmed = status === 'confirmed';
  const corroborated = /corroborated/.test(status);
  const disputed = status === 'disputed' || (chain?.contradictions?.length || 0) > 0;
  const noEvidence = !chain || chain.evidenceCount === 0;
  const unsupportedMaterialClaims = chain?.unsupportedMaterialClaims || [];

  if (disputed) {
    attached = setClassification(attached, 'Watch', 'Conflicting source claims require resolution before escalation.');
  } else if (noEvidence) {
    attached = setClassification(attached, 'Other', 'No traceable evidence record is available.');
  } else if (['must_know', 'mustknow'].includes(normalized) && !confirmed && !corroborated) {
    attached = setClassification(attached, 'Watch', 'Must Know requires a Tier-0 source or two independent source origins.');
  }

  const supportedClaims = (chain?.claimGroups || []).filter((claim) => claim.supported).map((claim) => ({
    id: claim.id,
    text: claim.canonicalText,
    evidenceIds: claim.evidenceIds,
    verification: claim.verification,
    confidence: claim.confidence
  }));
  const unresolvedClaims = (chain?.claimGroups || []).filter((claim) => !claim.supported).map((claim) => ({
    id: claim.id,
    text: claim.canonicalText,
    evidenceIds: claim.evidenceIds,
    reason: claim.material ? 'material-single-source' : 'single-source'
  }));

  return {
    ...attached,
    evidencePolicy: {
      originalClassification: original || null,
      publishedClassification: currentClassification(attached) || null,
      verificationStatus: status,
      mustKnowEligible: confirmed || corroborated,
      factClaims: supportedClaims,
      unresolvedSourceClaims: unresolvedClaims,
      unsupportedMaterialClaimCount: unsupportedMaterialClaims.length,
      disputed,
      noEvidence,
      rule: 'Must Know requires direct Tier-0 evidence or at least two independent source origins. Disputed items remain Watch.'
    }
  };
}
