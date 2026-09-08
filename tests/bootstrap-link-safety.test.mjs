import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const bootstrap = fileURLToPath(new URL('../bootstrap.mjs', import.meta.url));
function put(root, path, text) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'pulse-bootstrap-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const archiveInput = join(root, 'archive');
  mkdirSync(archiveInput);
  put(checkout, 'api/scan.js', "const source = new URL('../data/source-registry.json', import.meta.url);\n");
  return { root, checkout, archiveInput };
}
function bundle({ root, checkout, archiveInput }) {
  const archive = join(root, 'runtime.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', archiveInput, '.']);
  put(checkout, '.bootstrap/runtime.b64.00', readFileSync(archive).toString('base64'));
}

test('bootstrap never follows an existing destination directory symlink', (t) => {
  const fixture = setup(t);
  const outside = join(fixture.root, 'outside');
  put(outside, 'reviewed.txt', 'keep this\n');
  symlinkSync(outside, join(fixture.checkout, 'assets'), 'dir');
  put(fixture.archiveInput, 'assets/reviewed.txt', 'historical contents\n');
  put(fixture.archiveInput, 'assets/new.txt', 'must not escape\n');
  bundle(fixture);
  execFileSync(process.execPath, [bootstrap], { cwd: fixture.checkout, timeout: 20_000 });
  assert.equal(readFileSync(join(outside, 'reviewed.txt'), 'utf8'), 'keep this\n');
  assert.equal(existsSync(join(outside, 'new.txt')), false);
});

test('bootstrap rejects archive symlinks before restoring any file', (t) => {
  const fixture = setup(t);
  put(fixture.archiveInput, 'innocent.txt', 'must not be restored from rejected archive\n');
  symlinkSync('../outside', join(fixture.archiveInput, 'unsafe'), 'dir');
  bundle(fixture);
  const result = spawnSync(process.execPath, [bootstrap], { cwd: fixture.checkout, encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only regular files and directories/);
  assert.equal(existsSync(join(fixture.checkout, 'innocent.txt')), false);
});
