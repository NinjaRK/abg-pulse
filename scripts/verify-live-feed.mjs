import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'https://abg-pulse-intelligence-v4.vercel.app';
const RAW = 'https://raw.githubusercontent.com/NinjaRK/abg-pulse/live-data';

// Public GET requests only. A working feed is not a production database proof.
export async function verifyLiveFeed({ expectedCommit, fetchImpl = fetch, now = new Date() } = {}) {
  assert.match(expectedCommit || '', /^[a-f0-9]{40}$/);
  const report = { observedAt: now.toISOString(), expectedCommit, writesPerformed: false,
    deploymentVerified: false, feedVerified: false, databaseOperational: null };
  async function read(url) {
    const target = new URL(url);
    target.searchParams.set('verification', String(now.getTime()));
    const response = await fetchImpl(target, { method: 'GET', redirect: 'error',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`${target.pathname}: non-JSON HTTP ${response.status}`); }
    return { status: response.status, body, text };
  }
  try {
    const health = await read(`${BASE}/api/health`);
    report.deployment = { httpStatus: health.status, commit: health.body.deployment?.commitSha };
    assert.equal(health.status, 200);
    assert.equal(health.body.deployment?.commitSha, expectedCommit, 'The exact reviewed code must be live.');
    report.deploymentVerified = true;
    const start = new Date(now.getTime() - 86400_000).toISOString();
    const scan = await read(`${BASE}/api/scan?start=${encodeURIComponent(start)}&end=${encodeURIComponent(now.toISOString())}`);
    report.scan = { httpStatus: scan.status, error: scan.body.error || null,
      eventCount: scan.body.events?.length, snapshot: scan.body.meta?.snapshot || null,
      successfulChecks: scan.body.meta?.successfulQueries, attemptedChecks: scan.body.meta?.queryCount };
    assert.equal(scan.status, 200, `Live scan failed: ${scan.body.error}`);
    assert.equal(scan.body.meta?.deliveryMode, 'governed-snapshot');
    assert.equal(scan.body.meta?.snapshot?.fresh, true);
    assert.ok(Array.isArray(scan.body.events));
    const snapshot = scan.body.meta.snapshot;
    const ageMinutes = (now.getTime() - Date.parse(snapshot.generatedAt)) / 60_000;
    assert.ok(Number.isFinite(ageMinutes) && ageMinutes >= -1 && ageMinutes <= 90);
    if (!snapshot.coverageComplete) {
      assert.ok(snapshot.coverageLagMinutes >= 0 && snapshot.coverageLagMinutes <= 90);
      assert.match(snapshot.coverageNotice || '', /not yet checked/i);
      assert.ok(snapshot.coverageThrough);
    }
    const claims = await read(`${BASE}/api/claims?summaryOnly=true`);
    report.claims = { httpStatus: claims.status, error: claims.body.error || null,
      generatedAt: claims.body.generatedAt, sourceCommit: claims.body.sourceCommit,
      summary: claims.body.summary, quality: claims.body.quality };
    assert.equal(claims.status, 200, `Claims failed: ${claims.body.error}`);
    assert.equal(claims.body.quality?.publishable, true);
    assert.equal(claims.body.quality?.unsupportedMaterialClaimCount, 0);
    assert.ok(claims.body.summary?.claimCount > 0 && claims.body.summary?.evidenceCount > 0);
    assert.equal(claims.body.filteredSummary?.claimCount, claims.body.summary.claimCount);
    const graph = await read(`${RAW}/data/claim-evidence.json`);
    const manifest = await read(`${RAW}/data/claim-evidence.manifest.json`);
    assert.equal(graph.status, 200);
    assert.equal(manifest.status, 200);
    assert.equal(createHash('sha256').update(graph.text).digest('hex'), manifest.body.sha256);
    assert.equal(graph.body.sourceCommit, manifest.body.sourceCommit);
    assert.equal(claims.body.sourceCommit, graph.body.sourceCommit);
    assert.equal(claims.body.summary.claimCount, graph.body.summary.claimCount);
    assert.equal(claims.body.generatedAt, graph.body.generatedAt);
    const inputAge = (now.getTime() - Date.parse(graph.body.input?.governedSnapshotGeneratedAt)) / 60_000;
    assert.ok(Number.isFinite(inputAge) && inputAge >= -1 && inputAge <= 180, 'Upstream claim evidence must remain fresh.');
    report.claims.manifestVerified = true;
    report.claims.inputAgeMinutes = inputAge;
    report.feedVerified = true;
    const persistence = await read(`${BASE}/api/persistence-health`);
    report.persistence = { httpStatus: persistence.status, status: persistence.body.status,
      operational: persistence.body.operational, error: persistence.body.error || null };
    report.databaseOperational = persistence.body.operational === true;
    report.overallProductReady = false;
    report.caveat = 'This verifies feed delivery and traceability, not complete source coverage, factual entailment, production persistence, user acceptance or long-term dependability.';
  } catch (error) {
    report.error = String(error.message || error);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = resolve(process.argv[2] || '/tmp/live-feed-proof/runtime.json');
  mkdirSync(dirname(target), { recursive: true });
  let report;
  for (let attempt = 1; attempt <= 18; attempt++) {
    report = await verifyLiveFeed({ expectedCommit: process.env.EXPECTED_DEPLOYMENT_SHA });
    report.attempt = attempt;
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    if (report.feedVerified && !report.error) break;
    console.log(`Live feed verification attempt ${attempt}: ${report.error}`);
    if (attempt < 18) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.error || !report.feedVerified) process.exitCode = 1;
}
