import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  return source.replace(before, after);
}

const sourceHealth = `function n(value, fallback = 0) {
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

function tier(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pct(a, b) {
  return b ? Math.round((a / b) * 10000) / 100 : 0;
}

export function evaluateSourceHealth({ sourceChecks = [], baselines = {}, minimumSamplesBeforeEnforcement = 5, now = new Date() } = {}) {
  const checks = sourceChecks.map((check) => {
    const sourceId = key(check);
    const baseline = baselines[sourceId] || {};
    const itemCount = n(check.itemCount);
    const expectedMinimum = n(baseline.minimumItems);
    const expectedTypical = n(baseline.typicalItems);
    const samples = Array.isArray(baseline.samples) ? baseline.samples.length : 0;
    const baselineReady = baseline.reviewed === true || samples >= minimumSamplesBeforeEnforcement || baseline.enforce === true;
    const emptyIsValid = check.emptyIsValid === true || baseline.emptyIsValid === true;
    const explicitFailure = status(check) === 'failed' || check.schemaValidated === false;
    const degraded = status(check) === 'degraded';
    const volumeRulesActive = baselineReady && !emptyIsValid;
    const anomalousZero = !explicitFailure && volumeRulesActive && expectedMinimum > 0 && itemCount < expectedMinimum;
    const volumeDrop = !explicitFailure && volumeRulesActive && expectedTypical > 0 && itemCount < Math.max(expectedMinimum, expectedTypical * 0.2);
    const registryDrift = check.registryAudit?.reconciled === false;
    const silentFailure = Boolean(anomalousZero || volumeDrop || registryDrift);
    const isTier0 = tier(check.tier || baseline.tier) === 'tier0';
    const issues = [];
    if (explicitFailure) issues.push(check.schemaValidated === false ? 'invalid_schema' : 'request_failed');
    if (degraded) issues.push('provider_degraded');
    if (anomalousZero) issues.push('below_minimum_volume');
    if (volumeDrop) issues.push('severe_volume_drop');
    if (registryDrift) issues.push('registry_drift');
    if (!check.durationMs && !check.latencyMs) issues.push('latency_unmeasured');
    if (!baselineReady) issues.push('baseline_learning');

    return {
      sourceId,
      provider: check.provider || baseline.provider || null,
      tier: check.tier || baseline.tier || null,
      isTier0,
      reportedStatus: check.status || (check.ok === false ? 'failed' : 'healthy'),
      itemCount,
      expectedMinimum,
      expectedTypical,
      samples,
      baselineReady,
      emptyIsValid,
      schemaValidated: check.schemaValidated !== false,
      durationMs: n(check.durationMs || check.latencyMs, 0) || null,
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
  const baselineReady = checks.filter((check) => check.baselineReady).length;
  const tier0Checks = checks.filter((check) => check.isTier0);
  const tier0SilentFailures = silentFailures.filter((check) => check.isTier0);
  const tier0ExplicitFailures = explicitFailures.filter((check) => check.isTier0);

  return {
    evaluatedAt: new Date(now).toISOString(),
    summary: {
      checks: checks.length,
      healthy: healthy.length,
      degraded: degradedChecks.length,
      explicitFailures: explicitFailures.length,
      silentFailures: silentFailures.length,
      successRatePct: pct(healthy.length, checks.length),
      baselineReady,
      baselineCoveragePct: pct(baselineReady, checks.length),
      tier0Checks: tier0Checks.length,
      tier0Healthy: tier0Checks.filter((check) => !check.explicitFailure && !check.silentFailure && check.reportedStatus !== 'degraded').length,
      tier0ExplicitFailures: tier0ExplicitFailures.length,
      tier0SilentFailures: tier0SilentFailures.length
    },
    gates: {
      tier0Configured: tier0Checks.length > 0,
      noExplicitTier0Failure: tier0Checks.length > 0 && tier0ExplicitFailures.length === 0,
      noSilentTier0Failure: tier0Checks.length > 0 && tier0SilentFailures.length === 0,
      minimumOverallSuccessRate: checks.length > 0 && pct(healthy.length, checks.length) >= 90,
      baselineCoverageComplete: checks.length > 0 && baselineReady === checks.length
    },
    checks,
    failures: explicitFailures,
    silentFailures,
    tier0Failures: [...tier0ExplicitFailures, ...tier0SilentFailures],
    unbaselined: checks.filter((check) => !check.baselineReady)
  };
}

export function updateSourceBaselines({ existing = {}, sourceChecks = [], date = new Date() } = {}) {
  const next = { ...existing };
  for (const check of sourceChecks) {
    const sourceId = key(check);
    const count = n(check.itemCount);
    const current = next[sourceId] || {};
    const samples = Array.isArray(current.samples) ? current.samples.slice(-29) : [];
    samples.push({ date: new Date(date).toISOString(), itemCount: count, ok: check.ok !== false && check.schemaValidated !== false });
    const successful = samples.filter((sample) => sample.ok).map((sample) => n(sample.itemCount)).sort((a, b) => a - b);
    const typical = successful.length ? successful[Math.floor(successful.length / 2)] : 0;
    const nonZero = successful.filter((value) => value > 0);
    const minimum = nonZero.length >= 5 && check.emptyIsValid !== true
      ? Math.max(1, Math.floor(nonZero[Math.floor(nonZero.length * 0.1)] * 0.5))
      : n(current.minimumItems);
    next[sourceId] = {
      ...current,
      provider: check.provider || current.provider || null,
      tier: check.tier || current.tier || null,
      emptyIsValid: check.emptyIsValid === true || current.emptyIsValid === true,
      typicalItems: typical,
      minimumItems: minimum,
      lastObservedAt: new Date(date).toISOString(),
      samples
    };
  }
  return next;
}
`;
writeFileSync('lib/source-health.mjs', sourceHealth);

const tests = `import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceHealth, updateSourceBaselines } from '../lib/source-health.mjs';

test('explicit Tier-0 failure is a hard gate failure even without a baseline record', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'bse', provider: 'BSE', tier: 'tier0', ok: false, status: 'failed', itemCount: 0, error: 'timeout' }],
    baselines: {}
  });
  assert.equal(result.summary.tier0Checks, 1);
  assert.equal(result.summary.tier0ExplicitFailures, 1);
  assert.equal(result.gates.noExplicitTier0Failure, false);
});

test('HTTP success with abnormal zero volume is a silent failure when a reviewed baseline requires volume', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'news', provider: 'News', tier: 'tier1', ok: true, status: 'healthy', itemCount: 0, durationMs: 120 }],
    baselines: { news: { reviewed: true, minimumItems: 2, typicalItems: 12 } }
  });
  assert.equal(result.summary.explicitFailures, 0);
  assert.equal(result.summary.silentFailures, 1);
  assert.ok(result.silentFailures[0].issues.includes('below_minimum_volume'));
});

test('valid empty filing response is healthy rather than a false silent outage', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'nse:GRASIM', provider: 'NSE', tier: 'tier0', ok: true, status: 'healthy', itemCount: 0, emptyIsValid: true, schemaValidated: true, durationMs: 120 }],
    baselines: { 'nse:GRASIM': { reviewed: true, minimumItems: 2, typicalItems: 8, tier: 'tier0' } }
  });
  assert.equal(result.summary.tier0Healthy, 1);
  assert.equal(result.summary.silentFailures, 0);
  assert.equal(result.gates.noSilentTier0Failure, true);
});

test('invalid schema is an explicit failure', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'sec', tier: 'tier0', ok: true, status: 'healthy', schemaValidated: false, itemCount: 0 }]
  });
  assert.equal(result.summary.tier0ExplicitFailures, 1);
  assert.ok(result.failures[0].issues.includes('invalid_schema'));
});

test('baseline coverage is visibly incomplete rather than assumed healthy', () => {
  const result = evaluateSourceHealth({
    sourceChecks: [{ name: 'official', ok: true, status: 'healthy', itemCount: 3, durationMs: 80 }],
    baselines: {}
  });
  assert.equal(result.gates.baselineCoverageComplete, false);
  assert.equal(result.summary.baselineCoveragePct, 0);
});

test('baseline learner retains a rolling history and computes typical volume', () => {
  let baselines = {};
  for (const count of [8, 10, 12, 9, 11, 10]) {
    baselines = updateSourceBaselines({
      existing: baselines,
      sourceChecks: [{ name: 'source-a', provider: 'Official', tier: 'tier1', ok: true, itemCount: count }],
      date: new Date('2026-09-01T00:00:00Z')
    });
  }
  assert.equal(baselines['source-a'].samples.length, 6);
  assert.equal(baselines['source-a'].typicalItems, 10);
  assert.ok(baselines['source-a'].minimumItems >= 1);
});
`;
writeFileSync('tests/source-health.test.mjs', tests);

let tier0 = readFileSync('lib/tier0-ingestion.mjs', 'utf8');
tier0 = replaceOnce(
  tier0,
  "        rightsStatus: nseConfig.rightsStatus || 'metadata-and-link',\n        entityId:",
  "        rightsStatus: nseConfig.rightsStatus || 'metadata-and-link',\n        emptyIsValid: true,\n        schemaValidated: true,\n        entityId:",
  'NSE empty-response metadata'
);
tier0 = replaceOnce(
  tier0,
  "        rightsStatus: secConfig.rightsStatus || 'public-filing-metadata-and-link',\n        entityId:",
  "        rightsStatus: secConfig.rightsStatus || 'public-filing-metadata-and-link',\n        emptyIsValid: true,\n        schemaValidated: true,\n        entityId:",
  'SEC empty-response metadata'
);
writeFileSync('lib/tier0-ingestion.mjs', tier0);

let scan = readFileSync('api/scan.js', 'utf8');
scan = replaceOnce(
  scan,
  "import { buildTier0Jobs } from '../lib/tier0-ingestion.mjs';",
  "import { buildTier0Jobs } from '../lib/tier0-ingestion.mjs';\nimport { evaluateSourceHealth } from '../lib/source-health.mjs';",
  'scan source-health import'
);
scan = replaceOnce(
  scan,
  "const tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));\nconst entityUniverse",
  "const tier0Config = JSON.parse(readFileSync(fileURLToPath(new URL('../config/tier0-sources.json', import.meta.url)), 'utf8'));\nconst sourceHealthPayload = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-health-baselines.json', import.meta.url)), 'utf8'));\nconst { _meta: sourceHealthMeta, ...sourceHealthBaselines } = sourceHealthPayload;\nconst entityUniverse",
  'scan source-health baseline load'
);
scan = replaceOnce(
  scan,
  "        entityId: jobs[index].entityId || null,\n        ok: result.status === 'fulfilled',",
  "        entityId: jobs[index].entityId || null,\n        emptyIsValid: jobs[index].emptyIsValid === true,\n        schemaValidated: result.status === 'fulfilled' && jobs[index].schemaValidated !== false,\n        durationMs: null,\n        ok: result.status === 'fulfilled',",
  'scan source-health check metadata'
);
scan = replaceOnce(
  scan,
  "    const errors = sourceChecks.filter((check) => !check.ok).map((check) => ({ provider: check.provider, query: check.name, error: check.error }));",
  "    const sourceHealth = evaluateSourceHealth({ sourceChecks, baselines: sourceHealthBaselines, minimumSamplesBeforeEnforcement: sourceHealthMeta?.minimumSamplesBeforeEnforcement || 5, now: startedAt });\n    const errors = sourceChecks.filter((check) => !check.ok).map((check) => ({ provider: check.provider, query: check.name, error: check.error }));",
  'scan source-health evaluation'
);
scan = replaceOnce(
  scan,
  "serviceVersion: '5.5.0',\n        tier0:",
  "serviceVersion: '5.6.0',\n        sourceHealth: { summary: sourceHealth.summary, gates: sourceHealth.gates, failures: sourceHealth.failures, silentFailures: sourceHealth.silentFailures, tier0Failures: sourceHealth.tier0Failures, unbaselinedCount: sourceHealth.unbaselined.length },\n        tier0:",
  'scan source-health response'
);
writeFileSync('api/scan.js', scan);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '5.6.0';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('Source-health evaluation integrated with Tier-0-aware fail-closed semantics.');
