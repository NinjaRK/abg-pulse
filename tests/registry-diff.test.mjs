import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRegistry } from '../lib/registry-diff.mjs';

test('detects additions even when every expected name remains present', () => {
  const result = compareRegistry({
    expected: [{ id: 'a', name: 'Alpha Limited' }],
    observed: [{ id: 'a', name: 'Alpha Ltd' }, { id: 'b', name: 'Beta Limited' }],
    asOf: new Date('2026-09-04T00:00:00Z')
  });
  assert.equal(result.counts.removals, 0);
  assert.equal(result.counts.additions, 1);
  assert.equal(result.additions[0].observed.name, 'Beta Limited');
  assert.equal(result.reconciled, false);
});

test('detects a title change when the same person remains listed', () => {
  const result = compareRegistry({
    expected: [{ id: 'p1', name: 'Asha Rao', title: 'Chief Financial Officer' }],
    observed: [{ id: 'p1', name: 'Asha Rao', title: 'Chief Executive Officer' }]
  });
  assert.equal(result.counts.roleChanges, 1);
  assert.equal(result.roleChanges[0].from, 'Chief Financial Officer');
  assert.equal(result.roleChanges[0].to, 'Chief Executive Officer');
});

test('normalises common company suffixes without hiding true removals', () => {
  const same = compareRegistry({
    expected: [{ name: 'Alpha Industries Limited' }],
    observed: [{ name: 'Alpha Industries Ltd.' }]
  });
  assert.equal(same.reconciled, true);

  const removed = compareRegistry({
    expected: [{ name: 'Alpha Industries Limited' }, { name: 'Beta Holdings PLC' }],
    observed: [{ name: 'Alpha Industries Ltd.' }]
  });
  assert.equal(removed.counts.removals, 1);
  assert.equal(removed.removals[0].expected.name, 'Beta Holdings PLC');
});
