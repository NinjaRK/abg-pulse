import test from 'node:test';
import assert from 'node:assert/strict';
import { filterClaims } from '../api/claims.js';

const claims = [
  { id: 'claim-1', eventId: 'event-1', entityIds: ['company-a'], text: 'Official disclosure.' },
  { id: 'claim-2', eventId: 'event-2', entityIds: ['company-b'], text: 'Board update.' }
];

test('omitting all claim filters returns the available claims', () => {
  assert.deepEqual(filterClaims(claims), claims);
});

for (const search of [undefined, null, '', '   ']) {
  test(`absent or blank search does not suppress other filters: ${String(search)}`, () => {
    assert.deepEqual(filterClaims(claims, { eventId: 'event-1', search }), [claims[0]]);
  });
}

test('the literal search string null is not treated as an absent filter', () => {
  const withLiteral = [...claims, { id: 'claim-3', text: 'A null result was recorded.' }];
  assert.deepEqual(filterClaims(withLiteral, { search: 'null' }).map((item) => item.id), ['claim-3']);
});
