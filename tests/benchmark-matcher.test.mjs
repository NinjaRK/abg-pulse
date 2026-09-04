import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBenchmarkMatch, matchBenchmarkEvents } from '../lib/benchmark-matcher.mjs';

const reference = {
  id: 'ref-1',
  title: 'UltraTech Cement acquires 51% stake in Example Cement for ₹3,954 crore',
  entities: ['ultratech-cement'],
  occurredAt: '2026-09-03T10:00:00Z',
  sources: [{ url: 'https://example.com/disclosure/123' }]
};

const sameEvent = {
  id: 'event-1',
  title: 'UltraTech to buy 51 per cent of Example Cement in ₹3,954-crore transaction',
  entityIds: ['ultratech-cement'],
  publishedAt: '2026-09-03T12:00:00Z',
  evidence: ['https://example.com/disclosure/123']
};

test('matches the same event using evidence, entity, text and time', () => {
  const result = scoreBenchmarkMatch(reference, sameEvent);
  assert.equal(result.eligible, true);
  assert.equal(result.features.exactUrl, true);
  assert.ok(result.score >= 80);
});

test('does not match an unrelated event merely because both mention ABG', () => {
  const unrelated = {
    id: 'event-2',
    title: 'Aditya Birla Capital launches a new insurance campaign',
    entityIds: ['aditya-birla-capital'],
    publishedAt: '2026-09-03T11:00:00Z'
  };
  const result = scoreBenchmarkMatch(reference, unrelated);
  assert.equal(result.eligible, false);
});

test('greedy assignment prevents one system event from claiming two references', () => {
  const duplicateReference = { ...reference, id: 'ref-2', title: `${reference.title} updated` };
  const result = matchBenchmarkEvents({ references: [reference, duplicateReference], systemEvents: [sameEvent] });
  assert.equal(result.matches.length, 1);
  assert.equal(result.unmatchedReferences.length, 1);
});

test('numeric agreement cannot override entity mismatch', () => {
  const wrongEntity = {
    id: 'event-3',
    title: 'Different company acquires 51% stake for ₹3,954 crore',
    entityIds: ['different-company'],
    publishedAt: '2026-09-03T12:00:00Z'
  };
  const result = scoreBenchmarkMatch(reference, wrongEntity);
  assert.equal(result.eligible, false);
});

test('annotates matched system events for the dependability evaluator', () => {
  const result = matchBenchmarkEvents({ references: [reference], systemEvents: [sameEvent] });
  assert.deepEqual(result.annotatedSystemEvents[0].referenceIds, ['ref-1']);
  assert.equal(result.summary.matches, 1);
});
