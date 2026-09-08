import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentStatus } from '../api/deployment-status.js';

test('healthy observed deployment status retains freshness', () => {
  const result = validateDeploymentStatus({
    observedAt: '2026-09-08T10:00:00.000Z',
    state: 'healthy'
  }, {
    now: new Date('2026-09-08T12:00:00.000Z'),
    staleAfterHours: 24
  });
  assert.equal(result.ageHours, 2);
  assert.equal(result.stale, false);
});

test('old deployment observations are labelled stale rather than silently trusted', () => {
  const result = validateDeploymentStatus({
    observedAt: '2026-09-01T10:00:00.000Z',
    state: 'failed'
  }, {
    now: new Date('2026-09-08T12:00:00.000Z'),
    staleAfterHours: 24
  });
  assert.equal(result.stale, true);
  assert.equal(result.ageHours, 170);
});

test('unknown deployment states fail closed', () => {
  assert.throws(() => validateDeploymentStatus({
    observedAt: '2026-09-08T10:00:00.000Z',
    state: 'readyish'
  }), (error) => error.code === 'deployment_status_invalid');
});

test('missing observation times fail closed', () => {
  assert.throws(() => validateDeploymentStatus({ state: 'healthy' }), (error) => error.code === 'deployment_status_invalid');
});
