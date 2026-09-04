function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function transient(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /timeout|timed out|abort|fetch|network|socket|econn|enotfound|eai_again|429|50[0-9]|51[0-9]|52[0-9]|53[0-9]|temporar|rate limit/.test(message);
}

function makeTimeoutError(job, milliseconds) {
  const error = new Error(`${job?.provider || job?.id || 'source'} timeout after ${milliseconds}ms`);
  error.code = 'SOURCE_TIMEOUT';
  return error;
}

async function runAttempt(job, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(makeTimeoutError(job, timeoutMs)), timeoutMs);
  try {
    return await job.run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && !error?.code) throw makeTimeoutError(job, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeJobs(jobs = [], {
  concurrency = 28,
  timeoutMs = 10000,
  maxAttempts = 2,
  retryDelayMs = 180,
  deadlineMs = 50000,
  now = () => Date.now()
} = {}) {
  const startedAt = now();
  const deadlineAt = startedAt + Math.max(timeoutMs, deadlineMs);
  const results = new Array(jobs.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      const job = jobs[index];
      const jobStartedAt = now();
      if (jobStartedAt >= deadlineAt) {
        const reason = new Error('scan_deadline_exceeded_before_source_start');
        reason.code = 'SCAN_DEADLINE';
        results[index] = {
          status: 'rejected',
          reason,
          durationMs: 0,
          attempts: 0,
          retryable: false,
          deadlineSkipped: true
        };
        continue;
      }

      const configuredAttempts = job.maxAttempts ?? maxAttempts;
      const attemptsAllowed = Math.max(1, Math.min(3, Number(configuredAttempts) || 1));
      const configuredTimeout = Math.max(1000, Number(job.timeoutMs || timeoutMs));
      let attempts = 0;
      let lastError = null;

      while (attempts < attemptsAllowed && now() < deadlineAt) {
        attempts += 1;
        const remaining = deadlineAt - now();
        const attemptTimeout = Math.max(1000, Math.min(configuredTimeout, remaining));
        try {
          const value = await runAttempt(job, attemptTimeout);
          results[index] = {
            status: 'fulfilled',
            value,
            durationMs: Math.max(0, now() - jobStartedAt),
            attempts,
            retryable: job.retryable !== false
          };
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const shouldRetry = job.retryable !== false && attempts < attemptsAllowed && transient(error) && now() + retryDelayMs < deadlineAt;
          if (!shouldRetry) break;
          await sleep(retryDelayMs * attempts);
        }
      }

      if (!results[index]) {
        results[index] = {
          status: 'rejected',
          reason: lastError || new Error('scan_deadline_exceeded'),
          durationMs: Math.max(0, now() - jobStartedAt),
          attempts,
          retryable: job.retryable !== false,
          deadlineSkipped: !lastError
        };
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(jobs.length || 1, Number(concurrency) || 1)) }, () => worker());
  await Promise.all(workers);

  return {
    results,
    meta: {
      jobs: jobs.length,
      concurrency: workers.length,
      timeoutMs,
      maxAttempts,
      deadlineMs,
      durationMs: Math.max(0, now() - startedAt),
      fulfilled: results.filter((result) => result?.status === 'fulfilled').length,
      rejected: results.filter((result) => result?.status === 'rejected').length,
      retried: results.filter((result) => Number(result?.attempts) > 1).length,
      deadlineSkipped: results.filter((result) => result?.deadlineSkipped === true).length
    }
  };
}

export function isTransientSourceError(error) {
  return transient(error);
}
