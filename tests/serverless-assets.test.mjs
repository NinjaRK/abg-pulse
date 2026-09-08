import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import coverageHandler from '../api/coverage.js';
import dependabilityHandler from '../api/dependability.js';

function mockResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); },
    json() { return JSON.parse(this.body); },
    headers
  };
}

test('coverage endpoint returns a structured audit from governed assets', () => {
  const res = mockResponse();
  coverageHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(['complete', 'gaps_visible'].includes(body.status));
  assert.equal(typeof body.summary?.priorityEntities, 'number');
  assert.ok(body.summary.priorityEntities > 0);
  assert.equal(typeof body.summary?.officialCompanies, 'number');
  assert.ok(body.summary.officialCompanies > 0);
  assert.equal(typeof body.gates, 'object');
  assert.ok(Array.isArray(body.gaps?.entitiesWithoutDirectSource));
  assert.ok(Array.isArray(body.entities));
  assert.ok(Array.isArray(body.sources));
});

test('coverage endpoint rejects unsupported methods', () => {
  const res = mockResponse();
  coverageHandler({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.json().error, 'method_not_allowed');
});

test('dependability endpoint remains explicit that proof is incomplete', () => {
  const res = mockResponse();
  dependabilityHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.objectiveAchieved, 'boolean');
  assert.equal(body.objectiveAchieved, false);
  assert.equal(body.proofWindowDays, 30);
  assert.ok(Number.isFinite(body.daysRemaining));
  assert.ok(Array.isArray(body.acceptanceGates));
});

test('serverless coverage assets use literal traceable paths', () => {
  const source = readFileSync(new URL('../api/coverage.js', import.meta.url), 'utf8');
  for (const path of [
    '../data/entities.json',
    '../data/source-registry.json',
    '../config/official-sources.json',
    '../config/queries.json'
  ]) {
    assert.match(source, new RegExp(path.replaceAll('.', '\\.').replaceAll('/', '\\/')));
  }
  assert.doesNotMatch(source, /new URL\(\s*path\s*,\s*import\.meta\.url\s*\)/);
  assert.doesNotMatch(source, /const\s+readJson\s*=\s*\(path\)/);
});
