import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJobs, isTransientSourceError } from '../lib/job-executor.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('preserves result order while running jobs concurrently', async () => {
  const jobs = [30, 5, 15].map((delay, index) => ({
    id: `job-${index}`,
    async run() { await wait(delay); return [index]; }
  }));
  const execution = await executeJobs(jobs, { concurrency: 3, timeoutMs: 1000, maxAttempts: 1 });
  assert.deepEqual(execution.results.map((result) => result.value[0]), [0, 1, 2]);
  assert.equal(execution.meta.fulfilled, 3);
});

test('retries transient failures and records attempt count', async () => {
  let calls = 0;
  const execution = await executeJobs([{ id: 'flaky', async run() {
    calls += 1;
    if (calls === 1) throw new Error('HTTP 503 temporary upstream error');
    return ['ok'];
  } }], { timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 1 });
  assert.equal(execution.results[0].status, 'fulfilled');
  assert.equal(execution.results[0].attempts, 2);
  assert.equal(execution.meta.retried, 1);
});

test('does not retry schema errors that indicate a deterministic parser problem', async () => {
  let calls = 0;
  const execution = await executeJobs([{ id: 'bad-schema', async run() {
    calls += 1;
    throw new Error('returned non-array JSON');
  } }], { timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 1 });
  assert.equal(calls, 1);
  assert.equal(execution.results[0].status, 'rejected');
  assert.equal(execution.results[0].attempts, 1);
});

test('times out a stalled source without blocking other jobs', async () => {
  const jobs = [
    { id: 'stalled', run: () => new Promise(() => {}) },
    { id: 'fast', run: async () => ['fast'] }
  ];
  const execution = await executeJobs(jobs, { concurrency: 2, timeoutMs: 30, maxAttempts: 1, deadlineMs: 200 });
  assert.equal(execution.results[0].status, 'rejected');
  assert.match(String(execution.results[0].reason?.message), /timeout/);
  assert.equal(execution.results[1].status, 'fulfilled');
});

test('marks jobs skipped by the global deadline visibly', async () => {
  let clock = 0;
  const now = () => clock;
  const jobs = [
    { id: 'one', async run() { clock = 100; return []; } },
    { id: 'two', async run() { return []; } }
  ];
  const execution = await executeJobs(jobs, { concurrency: 1, timeoutMs: 10, deadlineMs: 50, maxAttempts: 1, now });
  assert.equal(execution.results[0].status, 'fulfilled');
  assert.equal(execution.results[1].deadlineSkipped, true);
  assert.equal(execution.meta.deadlineSkipped, 1);
});

test('transient error classifier is conservative', () => {
  assert.equal(isTransientSourceError(new Error('fetch failed ECONNRESET')), true);
  assert.equal(isTransientSourceError(new Error('HTTP 429 rate limit')), true);
  assert.equal(isTransientSourceError(new Error('invalid JSON schema')), false);
});
