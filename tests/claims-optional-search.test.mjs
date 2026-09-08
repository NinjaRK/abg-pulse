import test from 'node:test';
import assert from 'node:assert/strict';
import { filterClaims } from '../api/claims.js';

const claims = [
  { id: 'claim-1', eventId: 'event-1', entityIds: ['company-a'], text: 'An official disclosure.' },
  { id: 'claim-2', eventId: 'event-1', entityIds: ['company-a'], text: 'An interpretation of the filing.' },
  { id: 'claim-3', eventId: 'event-2', entityIds: ['company-b'], text: 'A sector publication report.' }
];

// Missing optional search must not become the literal string "null".
test('omitted, null, undefined and blank claim searches keep the full result set', () => {
  const ids = claims.map((claim) => claim.id);
  assert.deepEqual(filterClaims(claims).map((claim) => claim.id), ids);
  for (const search of [null, undefined, '', '   ']) {
    assert.deepEqual(filterClaims(claims, { search }).map((claim) => claim.id), ids);
  }
});

test('an explicit literal null search is still a real search term', () => {
  const input = [{ ...claims[0], text: 'The filing contains a null field.' }, claims[1]];
  assert.deepEqual(filterClaims(input, { search: 'null' }).map((claim) => claim.id), ['claim-1']);
});

test('optional blank search never removes an explicit event filter', () => {
  for (const search of [null, undefined, '', ' ']) {
    assert.deepEqual(filterClaims(claims, { eventId: 'event-2', search }).map((claim) => claim.id), ['claim-3']);
  }
});
