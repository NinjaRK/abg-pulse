import { createHash } from 'node:crypto';

export const CLOCK_SKEW_MS = 60_000;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const digestPattern = /^[a-f0-9]{64}$/;
export function fail(code, message, detail = {}) {
  throw Object.assign(new Error(message), { code, status: 503, detail });
}

// Production records use explicit UTC timestamps. Reject Date's coercions and
// calendar rollover (null, booleans, date-only strings and 30 February).
export function utcTime(value, field = 'timestamp', code = 'data_timestamp_invalid') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    fail(code, `${field} must be an explicit UTC timestamp.`);
  }
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical) fail(code, `${field} is not a valid calendar time.`);
  return time;
}
export function clockTime(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('data_clock_invalid', 'A valid current clock is required.');
  return now.getTime();
}
export function positiveLimit(value, fallback, code = 'data_config_invalid', maximum = Infinity) {
  if (value === undefined) value = fallback;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) fail(code, 'The configured limit must be a finite positive number within its allowed range.');
  return value;
}
export function freshness(value, now, limit, prefix, field = 'generatedAt') {
  const current = clockTime(now);
  const time = utcTime(value, field, `${prefix}_timestamp_invalid`);
  if (time > current + CLOCK_SKEW_MS) fail(`${prefix}_timestamp_future`, `${field} is in the future.`);
  const ageMinutes = Math.max(0, (current - time) / 60_000);
  if (ageMinutes > limit) fail(`${prefix}_stale`, `${field} exceeds the freshness limit.`, { ageMinutes, staleAfterMinutes: limit });
  return ageMinutes;
}

// This is the existing snapshot's SHA-256(JSON.stringify(payload with hash=null))
// format. It detects content changes; it is NOT a signature or factual proof.
export function payloadHash(payload) {
  const copy = structuredClone(payload);
  copy.integrity = { ...copy.integrity, payloadHash: null };
  return sha256(JSON.stringify(copy));
}
export function sealPayload(payload) {
  const copy = structuredClone(payload);
  copy.integrity = { algorithm: 'sha256', payloadHash: null };
  copy.integrity.payloadHash = payloadHash(copy);
  return copy;
}
export function verifyPayloadHash(payload, prefix) {
  if (payload?.integrity?.algorithm !== 'sha256' || !digestPattern.test(payload?.integrity?.payloadHash || '')) {
    fail(`${prefix}_integrity_missing`, 'A SHA-256 content hash is required; regenerate legacy data before release.');
  }
  if (payloadHash(payload) !== payload.integrity.payloadHash) fail(`${prefix}_integrity_mismatch`, 'The data does not match its recorded content hash.');
  return payload.integrity.payloadHash;
}
export function validateSourceCounts(meta, eventCount) {
  const invalid = message => fail('snapshot_source_counts_invalid', message);
  if (!meta || !Number.isSafeInteger(meta.queryCount) || meta.queryCount < 1 || !Number.isSafeInteger(meta.successfulQueries)
      || meta.successfulQueries < 0 || meta.successfulQueries > meta.queryCount) invalid('Source totals must be consistent non-negative integer counts.');
  if (!Array.isArray(meta.sourceChecks) || meta.sourceChecks.length !== meta.queryCount) invalid('Individual source checks do not match the attempted total.');
  const names = new Set();
  for (const check of meta.sourceChecks) {
    if (!check || typeof check.name !== 'string' || !check.name.trim() || names.has(check.name)) invalid('Each source check requires a unique name.');
    names.add(check.name);
    if (typeof check.ok !== 'boolean') invalid('Every source result requires a boolean outcome.');
    if (check.status !== undefined && !(check.ok ? ['healthy', 'degraded'] : ['failed']).includes(check.status)) invalid('A source status contradicts its outcome.');
    if (check.itemCount !== undefined && (!Number.isSafeInteger(check.itemCount) || check.itemCount < 0)) invalid('A source item count is invalid.');
  }
  if (meta.sourceChecks.filter(check => check.ok).length !== meta.successfulQueries) invalid('Successful source total does not match individual outcomes.');
  if (meta.eventCount !== undefined && meta.eventCount !== eventCount) invalid('Event total does not match the stored event array.');
  const ratio = meta.successfulQueries / meta.queryCount;
  if (meta.successRatio !== undefined && (typeof meta.successRatio !== 'number' || !Number.isFinite(meta.successRatio)
      || Math.abs(meta.successRatio - ratio) > 0.000051)) invalid('Source-success ratio does not match the reconciled counts.');
  return ratio;
}

export function snapshotIdentity(snapshot) {
  const identity = {
    generatedAt: snapshot.generatedAt, windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd,
    sourceCommit: snapshot.source?.commitSha, sourceRepository: snapshot.source?.repository || null,
    sourceWorkflowRun: snapshot.source?.workflowRunId || null,
    sourceWorkflowRunAttempt: snapshot.source?.workflowRunAttempt || null,
    payloadHash: snapshot.integrity?.payloadHash
  };
  validateSnapshotIdentity(identity);
  return { ...identity, generationId: sha256(JSON.stringify(identity)) };
}
export function validateSnapshotIdentity(identity) {
  if (!identity || typeof identity !== 'object') fail('snapshot_identity_invalid', 'Snapshot identity is missing.');
  const from = utcTime(identity.windowStart), through = utcTime(identity.windowEnd), generated = utcTime(identity.generatedAt);
  if (from >= through || through > generated + CLOCK_SKEW_MS) fail('snapshot_identity_invalid', 'Snapshot coverage dates are inconsistent.');
  if (!/^[a-f0-9]{40}$/.test(identity.sourceCommit || '') || !digestPattern.test(identity.payloadHash || '')) fail('snapshot_identity_invalid', 'Snapshot commit or content hash is invalid.');
  for (const field of ['sourceRepository', 'sourceWorkflowRun', 'sourceWorkflowRunAttempt']) {
    if (identity[field] !== null && (typeof identity[field] !== 'string' || !identity[field].trim())) fail('snapshot_identity_invalid', `Invalid ${field}.`);
  }
  if (identity.generationId !== undefined) {
    const { generationId, ...fields } = identity;
    if (sha256(JSON.stringify(fields)) !== generationId) fail('snapshot_identity_invalid', 'Generation identity does not match its fields.');
  }
}
export function graphIdentity(graph) {
  const fields = { generatedAt: graph.generatedAt, sourceCommit: graph.sourceCommit,
    inputGenerationId: graph.input?.governedSnapshotIdentity?.generationId, payloadHash: graph.integrity?.payloadHash };
  return { ...fields, generationId: sha256(JSON.stringify(fields)) };
}

export function uncachedUrl(value, now = new Date()) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) fail('data_source_url_invalid', 'A credential-free HTTPS source URL is required.');
  url.searchParams.set('abg_read', String(clockTime(now)));
  return url.href;
}

export function validateGraphInput(graph, now, inputLimit = 180) {
  const identity = graph.input?.governedSnapshotIdentity;
  validateSnapshotIdentity(identity);
  if (!digestPattern.test(identity.generationId || '')) fail('claim_graph_input_invalid', 'The upstream generation identifier is missing.');
  if (graph.input.governedSnapshotGeneratedAt !== identity.generatedAt || graph.sourceCommit !== identity.sourceCommit
      || graph.input.governedSnapshotSourceCommit !== identity.sourceCommit
      || graph.input.governedSnapshotWorkflowRunId !== identity.sourceWorkflowRun
      || graph.input.governedSnapshotWorkflowRunAttempt !== identity.sourceWorkflowRunAttempt) {
    fail('claim_graph_input_invalid', 'Claims and upstream generation metadata disagree.');
  }
  const generated = utcTime(graph.generatedAt);
  if (utcTime(identity.generatedAt) > generated + CLOCK_SKEW_MS || utcTime(identity.windowEnd) > generated + CLOCK_SKEW_MS) {
    fail('claim_graph_input_invalid', 'The graph cannot precede its input snapshot.');
  }
  const inputAgeMinutes = freshness(identity.generatedAt, now, inputLimit, 'claim_graph_input', 'input.generatedAt');
  const inputCoverageAgeMinutes = freshness(identity.windowEnd, now, inputLimit, 'claim_graph_input', 'input.windowEnd');
  if (!Number.isSafeInteger(graph.input.governedSnapshotEventCount) || graph.input.governedSnapshotEventCount < 1
      || graph.input.governedSnapshotEventCount !== graph.eventSummaries.length) fail('claim_graph_input_invalid', 'Input events do not reconcile with graph events.');
  return { inputAgeMinutes, inputCoverageAgeMinutes, inputStaleAfterMinutes: inputLimit, inputGenerationId: identity.generationId, inputPayloadHash: identity.payloadHash };
}
