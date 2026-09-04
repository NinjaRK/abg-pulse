function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function key(check = {}) {
  return String(check.id || check.name || check.sourceId || check.url || 'unknown-source');
}

function status(check = {}) {
  if (check.ok === false || check.status === 'failed') return 'failed';
  if (check.status === 'degraded') return 'degraded';
  return 'healthy';
}

function pct(a, b) {
  return b ? Math.round((a / b) * 10000) / 100 : 0;
}

export function evaluateSourceHealth({ sourceChecks = [], baselines = {}, now = new Date() } = {}) {
  const checks = sourceChecks.map((check) => {
    const sourceId = key(check);
    const baseline = baselines[sourceId] || {};
    const itemCount = n(check.itemCount);
    const expectedMinimum = n(baseline.minimumItems);
    const expectedTypical = n(baseline.typicalItems);
    const explicitFailure = status(check) === 'failed';
    const degraded = status(check) === 'degraded';
    const anomalousZero = !explicitFailure && expectedMinimum > 0 && itemCount < expectedMinimum;
    const volumeDrop = !explicitFailure && expectedTypical > 0 && itemCount < Math.max(expectedMinimum, expectedTypical * 0.2);
    const silentFailure = Boolean(anomalousZero || volumeDrop || check.registryAudit?.reconciled === false);
    const issues = [];
    if (explicitFailure) issues.push('request_failed');
    if (degraded) issues.push('provider_degraded');
    if (anomalousZero) issues.push('below_minimum_volume');
    if (volumeDrop) issues.push('severe_volume_drop');
    if (check.registryAudit?.reconciled === false) issues.push('registry_drift');
    if (!check.durationMs && !check.latencyMs) issues.push('latency_unmeasured');
    if (!baseline.lastReviewedAt) issues.push('baseline_unreviewed');

    return {
      sourceId,
      provider: check.provider || baseline.provider || null,
      reportedStatus: check.status || (check.ok === false ? 'failed' : 'healthy'),
      itemCount,
      expectedMinimum,
      expectedTypical,
      explicitFailure,
      silentFailure,
      issues,
      error: check.error || null
    };
  });

  const explicitFailures = checks.filter((check) => check.explicitFailure);
  const silentFailures = checks.filter((check) => check.silentFailure);
  const degradedChecks = checks.filter((check) => check.reportedStatus === 'degraded');
  const healthy = checks.filter((check) => !check.explicitFailure && !check.silentFailure && check.reportedStatus !== 'degraded');
  const baselineCoverage = checks.filter((check) => check.expectedMinimum > 0 || check.expectedTypical > 0).length;

  const tier0Ids = new Set(Object.entries(baselines)
    .filter(([, baseline]) => ['tier0', 'tier-0', '0'].includes(String(baseline.tier || '').toLowerCase()))
    .map(([sourceId]) => sourceId));
  const tier0SilentFailures = silentFailures.filter((check) => tier0Ids.has(check.sourceId));
  const tier0ExplicitFailures = explicitFailures.filter((check) => tier0Ids.has(check.sourceId));

  return {
    evaluatedAt: new Date(now).toISOString(),
    summary: {
      checks: checks.length,
      healthy: healthy.length,
      degraded: degradedChecks.length,
      explicitFailures: explicitFailures.length,
      silentFailures: silentFailures.length,
      successRatePct: pct(healthy.length, checks.length),
      baselineCoverage,
      baselineCoveragePct: pct(baselineCoverage, checks.length),
      tier0ExplicitFailures: tier0ExplicitFailures.length,
      tier0SilentFailures: tier0SilentFailures.length
    },
    gates: {
      noExplicitTier0Failure: tier0ExplicitFailures.length === 0,
      noSilentTier0Failure: tier0SilentFailures.length === 0,
      minimumOverallSuccessRate: checks.length > 0 && pct(healthy.length, checks.length) >= 90,
      baselineCoverageComplete: checks.length > 0 && baselineCoverage === checks.length
    },
    checks,
    failures: explicitFailures,
    silentFailures,
    tier0Failures: [...tier0ExplicitFailures, ...tier0SilentFailures]
  };
}

export function updateSourceBaselines({ existing = {}, sourceChecks = [], date = new Date() } = {}) {
  const next = { ...existing };
  for (const check of sourceChecks) {
    const sourceId = key(check);
    const count = n(check.itemCount);
    const current = next[sourceId] || {};
    const samples = Array.isArray(current.samples) ? current.samples.slice(-29) : [];
    samples.push({ date: new Date(date).toISOString(), itemCount: count, ok: check.ok !== false });
    const successful = samples.filter((sample) => sample.ok).map((sample) => n(sample.itemCount)).sort((a, b) => a - b);
    const typical = successful.length ? successful[Math.floor(successful.length / 2)] : 0;
    const nonZero = successful.filter((value) => value > 0);
    const minimum = nonZero.length >= 5 ? Math.max(1, Math.floor(nonZero[Math.floor(nonZero.length * 0.1)] * 0.5)) : n(current.minimumItems);
    next[sourceId] = {
      ...current,
      provider: check.provider || current.provider || null,
      typicalItems: typical,
      minimumItems: minimum,
      lastObservedAt: new Date(date).toISOString(),
      samples
    };
  }
  return next;
}
