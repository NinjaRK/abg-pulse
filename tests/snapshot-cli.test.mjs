import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCliResultAndExit } from '../scripts/refresh-live-snapshot.mjs';

test('snapshot CLI flushes structured success output before exiting', () => {
  let written = '';
  let exitedWith = null;
  const stream = {
    write(value, callback) {
      written += String(value);
      callback();
      return true;
    }
  };

  writeCliResultAndExit(stream, { status: 'published', eventCount: 12 }, 0, (code) => {
    exitedWith = code;
  });

  assert.equal(exitedWith, 0);
  assert.match(written, /"status": "published"/);
  assert.match(written, /"eventCount": 12/);
  assert.ok(written.endsWith('\n'));
});

test('snapshot CLI flushes failure text and exits non-zero', () => {
  let written = '';
  let exitedWith = null;
  const stream = {
    write(value, callback) {
      written += String(value);
      callback();
      return true;
    }
  };

  writeCliResultAndExit(stream, 'snapshot failed', 1, (code) => {
    exitedWith = code;
  });

  assert.equal(exitedWith, 1);
  assert.equal(written, 'snapshot failed\n');
});
