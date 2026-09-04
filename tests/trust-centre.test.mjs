import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../trust.html', import.meta.url), 'utf8');

test('trust centre exposes the core executive questions at a glance', () => {
  for (const phrase of [
    'Can I trust today’s brief?',
    'Objective complete',
    'Job Meter',
    'Source health',
    'Proof streak',
    'What is operational now',
    'What remains unproven',
    'Source failures and blind spots'
  ]) assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('trust centre explicitly prevents overclaiming', () => {
  assert.match(html, /Operational, not fully proven/);
  assert.match(html, /Do not rely on silence/);
  assert.match(html, /It is not the same as broad public sentiment/);
  assert.match(html, /cannot represent people who did not publish/);
  assert.match(html, /30 days cannot be skipped/);
});

test('every trust data dependency is same-origin and evidence-based', () => {
  const expected = [
    '/api/health',
    '/api/coverage',
    '/api/source-health',
    '/api/dependability',
    '/api/progress',
    '/api/release'
  ];
  expected.forEach((endpoint) => assert.match(html, new RegExp(endpoint.replaceAll('/', '\\/'))));
  assert.doesNotMatch(html, /https?:\/\/(?!github\.com\/NinjaRK\/abg-pulse)/i);
});

test('interactive elements are labelled and keyboard-focusable', () => {
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Trust Centre actions"/);
  assert.match(html, /aria-label="Explain objective completion"/);
  assert.match(html, /id="refresh"[^>]*type="button"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /prefers-reduced-motion/);
});

test('mobile layout and one-thumb controls are present', () => {
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /min-height: 44px/);
  assert.match(html, /viewport-fit=cover/);
});

test('the page never declares the objective achieved from a healthy deployment alone', () => {
  assert.match(html, /dependability\.objectiveAchieved === true/);
  assert.match(html, /systemHealthy && evidenceHealthy/);
  assert.doesNotMatch(html, /systemHealthy\s*\?\s*['"]Objective achieved/);
});
