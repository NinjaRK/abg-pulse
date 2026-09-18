import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateLiveSnapshot, filterLiveSnapshot } from '../lib/live-snapshot.mjs';
import { validateClaimEvidenceGraph, projectClaimGraph } from '../api/claims.js';
import { applyEventSupportPolicy, applyClaimSupportPolicy, CLAIM_SUPPORT_POLICY } from '../lib/claim-support.mjs';
import { snapshotIdentity, graphIdentity, freshness, sha256 } from '../lib/data-integrity.mjs';

export function verifySnapshotPublication(expected, published, now = new Date()) {
  validateLiveSnapshot(expected); validateLiveSnapshot(published);
  freshness(published.generatedAt, now, 90, 'snapshot');
  freshness(published.windowEnd, now, 90, 'snapshot');
  assert.deepEqual(snapshotIdentity(published), snapshotIdentity(expected), 'The exact snapshot generation and content hash must be published.');
  return { generationId: snapshotIdentity(expected).generationId, payloadHash: expected.integrity.payloadHash };
}
export function verifySnapshotConsumer(expected, response, now = new Date()) {
  validateLiveSnapshot(expected);
  assert.equal(response.meta?.deliveryMode, 'governed-snapshot');
  assert.equal(response.meta?.snapshot?.integrityVerified, true);
  assert.equal(response.meta?.snapshot?.fresh, true);
  const identity = snapshotIdentity(expected);
  for (const [key, value] of Object.entries(identity)) assert.deepEqual(response.meta.snapshot[key], value, `Consumer must use the exact snapshot ${key}.`);
  const projection = filterLiveSnapshot(expected, { start: response.meta.windowStart, end: response.meta.windowEnd }, { now, allowTrailingLag: true });
  assert.deepEqual(response.events, projection.events.map(applyEventSupportPolicy), 'The served events must match the verified source and support-policy projection.');
  assert.deepEqual(response.meta.sourceChecks, expected.meta.sourceChecks);
  assert.equal(response.meta.queryCount, expected.meta.queryCount);
  assert.equal(response.meta.successfulQueries, expected.meta.successfulQueries);
  assert.equal(response.meta.eventCount, response.events.length);
  for (const key of ['coverageComplete', 'coverageThrough', 'coverageLagMinutes', 'coverageNotice']) assert.deepEqual(response.meta.snapshot[key], projection.meta.snapshot[key]);
  return { generationId: identity.generationId, payloadHash: identity.payloadHash, eventCount: response.events.length, verifiedAt: now.toISOString() };
}
export function verifyClaimPublication(expected, published, now = new Date()) {
  validateClaimEvidenceGraph(expected, { now }); validateClaimEvidenceGraph(published, { now });
  assert.deepEqual(graphIdentity(published), graphIdentity(expected), 'The exact claims generation, input identity and content hash must be published.');
  return graphIdentity(expected);
}
export function verifyClaimManifest(expected, published, publishedText) {
  assert.deepEqual(published, expected, 'Published manifest must describe the exact expected graph generation.');
  assert.equal(sha256(publishedText), expected.sha256, 'The published graph bytes must match the expected manifest digest.');
  assert.equal(Buffer.byteLength(publishedText), expected.bytes);
  return { manifestSha256: expected.sha256, bytes: expected.bytes, generatedAt: expected.generatedAt };
}
export function verifyClaimConsumer(expected, response, now = new Date()) {
  validateClaimEvidenceGraph(expected, { now });
  const identity = graphIdentity(expected);
  assert.equal(response.freshness?.integrityVerified, true);
  assert.equal(response.freshness?.graphGenerationId, identity.generationId);
  assert.equal(response.freshness?.originalGraphPayloadHash, identity.payloadHash);
  assert.equal(response.freshness?.inputGenerationId, identity.inputGenerationId);
  assert.equal(response.freshness?.inputPayloadHash, expected.input.governedSnapshotIdentity.payloadHash);
  assert.equal(response.generatedAt, expected.generatedAt);
  assert.equal(response.sourceCommit, expected.sourceCommit);
  assert.deepEqual(response.input, expected.input);
  assert.equal(response.supportPolicy, CLAIM_SUPPORT_POLICY);
  assert.equal(response.statementVerification, 'not_performed');
  assert.ok(Object.values(response.filters || {}).every(value => value === null || value === undefined), 'Generation check requires the unfiltered claims summary.');
  const safe = applyClaimSupportPolicy(expected);
  assert.deepEqual(response.summary, safe.summary);
  assert.deepEqual(response.quality, safe.quality);
  assert.deepEqual(response.filteredSummary, projectClaimGraph(safe, {}, { summaryOnly: true }).filteredSummary);
  return { ...identity, verifiedAt: now.toISOString() };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checks = { 'snapshot-publication': verifySnapshotPublication, 'snapshot-consumer': verifySnapshotConsumer,
    'claims-publication': verifyClaimPublication, 'claims-consumer': verifyClaimConsumer };
  try {
    const check = checks[process.argv[2]];
    assert.ok((check || process.argv[2] === 'claims-manifest') && process.argv[3] && process.argv[4], 'Usage: verify-data-generation.mjs MODE EXPECTED_JSON ACTUAL_JSON');
    const expected = JSON.parse(readFileSync(process.argv[3], 'utf8')), actual = JSON.parse(readFileSync(process.argv[4], 'utf8'));
    const result = process.argv[2] === 'claims-manifest'
      ? verifyClaimManifest(expected, actual, readFileSync(process.argv[5], 'utf8')) : check(expected, actual);
    console.log(JSON.stringify({ check: process.argv[2], passed: true, ...result }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ check: process.argv[2], passed: false, error: error.code || error.message, detail: error.message }));
    process.exitCode = 1;
  }
}
