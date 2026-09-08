import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../n8n/abg-pulse-claim-persistence.json', import.meta.url));
const text = readFileSync(path, 'utf8');
const workflow = JSON.parse(text);
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));

test('claim persistence workflow imports inactive with explicit execution history', () => {
  assert.equal(workflow.name, 'ABG Pulse — Persist Claim Evidence');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.saveExecutionProgress, true);
  assert.equal(workflow.settings.saveDataErrorExecution, 'all');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'all');
});

test('workflow checks the graph, persists it and verifies database health in order', () => {
  for (const name of [
    'Every 30 Minutes',
    'Verify Published Claim Graph',
    'Persist Claim Graph',
    'Verify Persistence Health',
    'Persistence Operational?',
    'Record Success',
    'Fail Visibly'
  ]) assert.ok(nodes.has(name), `Missing node: ${name}`);

  const next = (name, branch = 0) => workflow.connections?.[name]?.main?.[branch]?.[0]?.node;
  assert.equal(next('Every 30 Minutes'), 'Verify Published Claim Graph');
  assert.equal(next('Verify Published Claim Graph'), 'Persist Claim Graph');
  assert.equal(next('Persist Claim Graph'), 'Verify Persistence Health');
  assert.equal(next('Verify Persistence Health'), 'Persistence Operational?');
  assert.equal(next('Persistence Operational?', 0), 'Record Success');
  assert.equal(next('Persistence Operational?', 1), 'Fail Visibly');
});

test('workflow requires environment secrets and never hard-codes them', () => {
  const persist = JSON.stringify(nodes.get('Persist Claim Graph'));
  assert.match(persist, /\$env\.ABG_PULSE_INGEST_SECRET/);
  assert.match(text, /\$env\.ABG_PULSE_BASE_URL/);
  assert.equal(/sk-[A-Za-z0-9_-]{12,}/.test(text), false);
  assert.equal(/sb_secret_[A-Za-z0-9_-]{12,}/.test(text), false);
  assert.equal(/Bearer\s+[A-Za-z0-9._-]{16,}/.test(text), false);
});

test('persistence request is idempotently keyed and accountable', () => {
  const persist = nodes.get('Persist Claim Graph');
  const headers = persist.parameters.headerParameters.parameters;
  assert.equal(headers.find((item) => item.name === 'X-Ingest-Secret').value, '={{$env.ABG_PULSE_INGEST_SECRET}}');
  assert.match(headers.find((item) => item.name === 'X-Request-Id').value, /n8n-claim-persist/);
  assert.match(persist.parameters.body, /n8n-claim-persistence/);
});

test('failed persistence health makes the n8n execution fail visibly', () => {
  const failureCode = nodes.get('Fail Visibly').parameters.jsCode;
  assert.match(failureCode, /throw new Error/);
  assert.match(failureCode, /persistence health failed/i);
});
