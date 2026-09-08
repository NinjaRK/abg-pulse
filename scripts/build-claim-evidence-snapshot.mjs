import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildClaimEvidenceGraph, findPotentialContradictions } from '../lib/claim-evidence.mjs';

import { DEFAULT_LIVE_SNAPSHOT_URL } from '../lib/live-snapshot.mjs';
const boundedNumber = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
};

async function loadInput() {
  const file = process.env.CLAIM_EVIDENCE_INPUT_FILE;
  if (file) return JSON.parse(await readFile(resolve(file), 'utf8'));
  const url = process.env.CLAIM_EVIDENCE_INPUT_URL || DEFAULT_LIVE_SNAPSHOT_URL;
  const controller = new AbortController();
  const timeoutMs = boundedNumber(process.env.CLAIM_EVIDENCE_FETCH_TIMEOUT_MS, 20_000, 3_000, 60_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ABG-Pulse/1.0 claim-evidence builder' }
    });
    if (!response.ok) throw new Error(`Governed snapshot returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Governed snapshot timed out after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function eventMateriality(event = {}) {
  const candidates = [
    event?.intelligence?.materiality,
    event?.scores?.materiality,
    event?.materiality,
    event?.priorityScore
  ];
  const value = candidates.map(Number).find(Number.isFinite);
  return value === undefined ? 0 : Math.max(0, Math.min(100, value));
}

function validateInput(snapshot, now, staleAfterMinutes) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Governed snapshot is not an object.');
  if (!Array.isArray(snapshot.events)) throw new Error('Governed snapshot has no events array.');
  const generatedAt = new Date(snapshot.generatedAt || snapshot?.meta?.snapshotGeneratedAt || snapshot?.meta?.scannedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Governed snapshot generation time is invalid.');
  const ageMinutes = Math.max(0, (now.getTime() - generatedAt.getTime()) / 60_000);
  if (ageMinutes > staleAfterMinutes) throw new Error(`Governed snapshot is stale at ${Math.round(ageMinutes)} minutes; limit is ${staleAfterMinutes}.`);
  if (snapshot?.meta?.registryReconciled === false) throw new Error('Governed entity registry is not reconciled.');
  if (!snapshot?.source?.commitSha && !snapshot?.meta?.sourceCommit) throw new Error('Governed snapshot source commit is missing.');
  return { generatedAt: generatedAt.toISOString(), ageMinutes: Number(ageMinutes.toFixed(1)) };
}

const now = new Date();
const staleAfterMinutes = boundedNumber(process.env.CLAIM_EVIDENCE_INPUT_STALE_MINUTES, 180, 30, 24 * 60);
const materialityFloor = boundedNumber(process.env.UNSUPPORTED_MATERIALITY_FLOOR, 65, 1, 100);
const outputPath = resolve(process.env.CLAIM_EVIDENCE_OUTPUT || 'out/claim-evidence.json');
const manifestPath = resolve(process.env.CLAIM_EVIDENCE_MANIFEST_OUTPUT || 'out/claim-evidence.manifest.json');
const snapshot = await loadInput();
const input = validateInput(snapshot, now, staleAfterMinutes);
const sourceCommit = snapshot?.source?.commitSha || snapshot?.meta?.sourceCommit || null;
const graph = buildClaimEvidenceGraph(snapshot.events, {
  generatedAt: now.toISOString(),
  sourceCommit
});

const eventById = new Map(snapshot.events.map((event) => [event.id, event]));
const unsupportedMaterialClaims = graph.claims
  .filter((claim) => claim.kind === 'fact' && claim.supportStatus === 'unsupported')
  .map((claim) => ({
    claimId: claim.id,
    eventId: claim.eventId,
    entityIds: claim.entityIds,
    materiality: eventMateriality(eventById.get(claim.eventId)),
    text: claim.text
  }))
  .filter((claim) => claim.materiality >= materialityFloor);

const contradictions = findPotentialContradictions(graph.claims);
const payload = {
  ...graph,
  input: {
    governedSnapshotGeneratedAt: input.generatedAt,
    governedSnapshotAgeMinutes: input.ageMinutes,
    governedSnapshotSourceCommit: sourceCommit,
    governedSnapshotWorkflowRunId: snapshot?.source?.workflowRunId || snapshot?.meta?.workflowRunId || null,
    governedSnapshotEventCount: snapshot.events.length
  },
  quality: {
    materialityFloor,
    unsupportedMaterialClaimCount: unsupportedMaterialClaims.length,
    potentialContradictionCount: contradictions.length,
    publishable: unsupportedMaterialClaims.length === 0,
    rule: 'No unsupported factual claim at or above the materiality floor may be published as a dependable claim graph.'
  },
  unsupportedMaterialClaims,
  contradictions
};

if (!payload.summary.eventCount) throw new Error('Claim-evidence graph contains no events; no operational proof can be created.');
if (!payload.summary.factClaimCount) throw new Error('Claim-evidence graph contains no factual claims.');
if (!payload.summary.evidenceCount) throw new Error('Claim-evidence graph contains no traceable evidence.');
if (!payload.quality.publishable) {
  const preview = unsupportedMaterialClaims.slice(0, 5).map((item) => `${item.eventId}: ${item.text}`).join(' | ');
  throw new Error(`Unsupported material claims block publication: ${preview}`);
}

const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const digest = createHash('sha256').update(serialized).digest('hex');
const manifest = {
  schemaVersion: '1.0.0',
  generatedAt: payload.generatedAt,
  sha256: digest,
  bytes: Buffer.byteLength(serialized),
  sourceCommit,
  input: payload.input,
  summary: payload.summary,
  quality: payload.quality,
  workflow: {
    repository: process.env.GITHUB_REPOSITORY || 'NinjaRK/abg-pulse',
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    workflow: process.env.GITHUB_WORKFLOW || 'local'
  }
};

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(outputPath, serialized, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
