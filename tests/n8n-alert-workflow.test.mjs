import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = JSON.parse(readFileSync(new URL('../n8n/material-change-alerts.json', import.meta.url), 'utf8'));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));

function connection(from, to, branch = 0) {
  return (workflow.connections[from]?.main?.[branch] || []).some((edge) => edge.node === to);
}

test('workflow is inactive until authorised infrastructure is connected', () => {
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.meta.requiredEnvironmentVariables.sort(), [
    'PULSE_ALERT_WEBHOOK_URL',
    'PULSE_BASE_URL',
    'PULSE_INGEST_SECRET'
  ]);
});

test('workflow has no Gmail or Outlook dependency', () => {
  const serialized = JSON.stringify(workflow).toLowerCase();
  assert.equal(workflow.meta.emailDependency, false);
  assert.doesNotMatch(serialized, /gmail|outlook|microsoft graph|imap|smtp/);
});

test('workflow scans, compares previous history and reads the notification ledger before persisting', () => {
  for (const name of [
    'Scan public sources',
    'Read previous history',
    'Read notification ledger',
    'Build material comparison',
    'Evaluate material changes',
    'Persist current scan'
  ]) assert.ok(byName.has(name), `Missing ${name}`);
  assert.equal(connection('Scan public sources', 'Read previous history'), true);
  assert.equal(connection('Read previous history', 'Read notification ledger'), true);
  assert.equal(connection('Read notification ledger', 'Build material comparison'), true);
  assert.equal(connection('Build material comparison', 'Evaluate material changes'), true);
  assert.equal(connection('Evaluate material changes', 'Persist current scan'), true);
});

test('only eligible changes reach the notification reservation and delivery path', () => {
  assert.ok(byName.has('Any material change?'));
  assert.equal(connection('Any material change?', 'Reserve unseen notifications', 0), true);
  assert.equal(connection('Any material change?', 'No notification required', 1), true);
  assert.equal(connection('Reserve unseen notifications', 'Split reserved notifications'), true);
  assert.equal(connection('Split reserved notifications', 'Deliver alert webhook'), true);
});

test('every attempted delivery is written back to the persistent ledger', () => {
  assert.equal(connection('Deliver alert webhook', 'Classify delivery result'), true);
  assert.equal(connection('Classify delivery result', 'Record delivery outcome'), true);
  const classifier = byName.get('Classify delivery result').parameters.jsCode;
  assert.match(classifier, /sent \? 'sent' : 'failed'/);
  assert.match(classifier, /notificationKey/);
});

test('workflow uses only ABG Pulse APIs and a configured outbound webhook', () => {
  const requestNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
  const urls = requestNodes.map((node) => String(node.parameters.url));
  for (const endpoint of ['/api/scan', '/api/history', '/api/notifications', '/api/material-changes', '/api/persist']) {
    assert.ok(urls.some((url) => url.includes(endpoint)), `Missing ${endpoint}`);
  }
  assert.ok(urls.some((url) => url.includes('PULSE_ALERT_WEBHOOK_URL')));
});

test('notification policy is preserved in workflow metadata', () => {
  assert.match(workflow.meta.objective, /Notify only when a genuinely new or materially updated verified ABG development exists/);
  const noAlert = byName.get('No notification required').parameters.jsCode;
  assert.match(noAlert, /No genuinely new material development\. No notification sent\./);
});
