import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithTimeout } from '../api/scan.js';

test('source timeout is a hard wall-clock bound even when work ignores AbortSignal', async () => {
  let capturedSignal;
  const startedAt = Date.now();
  await assert.rejects(
    runWithTimeout((signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    }, 25),
    (error) => error?.code === 'source_timeout' && /25ms/.test(error.message)
  );
  const elapsed = Date.now() - startedAt;
  assert.equal(capturedSignal.aborted, true);
  assert.ok(elapsed < 250, `Hard timeout took ${elapsed}ms.`);
});

test('source timeout returns successful work and clears the timer', async () => {
  const value = await runWithTimeout(async (signal) => {
    assert.equal(signal.aborted, false);
    return 'healthy';
  }, 100);
  assert.equal(value, 'healthy');
});
