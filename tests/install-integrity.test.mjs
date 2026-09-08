import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_RUNTIME_FILES, REQUIRED_JSON_SHAPES, validateRuntime } from '../bootstrap.mjs';

const bootstrapPath = fileURLToPath(new URL('../bootstrap.mjs', import.meta.url));
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pulse-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(bootstrapPath, join(root, 'bootstrap.mjs'));
  for (const path of REQUIRED_RUNTIME_FILES) put(root, path, '// current tracked source\n');
  for (const [path, shape] of Object.entries(REQUIRED_JSON_SHAPES)) {
    put(root, path, JSON.stringify(shape === 'array' ? [{ id: 'current' }] : { version: 'current' }));
  }
  return root;
}
function hashes(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? hashes(root, path)
      : [[path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}
function run(root, cwd = root) {
  return spawnSync(process.execPath, [join(root, 'bootstrap.mjs')], { cwd, encoding: 'utf8', timeout: 10_000 });
}

test('installation validation never needs archived runtime chunks', (t) => {
  const root = fixture(t);
  const before = hashes(root);
  assert.equal(run(root).status, 0);
  assert.deepEqual(hashes(root), before);
  assert.deepEqual(validateRuntime(root), { checkedFiles: 12, sourceModified: false, archiveRestored: false });
});

test('a historical archive cannot replace newer APIs or progress data', (t) => {
  const root = fixture(t);
  const old = mkdtempSync(join(tmpdir(), 'pulse-old-runtime-'));
  t.after(() => rmSync(old, { recursive: true, force: true }));
  for (const path of ['api/scan.js', 'api/health.js', 'api/progress.js', 'data/build-milestones.json']) {
    put(old, path, 'obsolete runtime content');
  }
  const archive = execFileSync('tar', ['-czf', '-', '-C', old, 'api', 'data']);
  put(root, '.bootstrap/runtime.b64.00', archive.toString('base64'));
  const before = hashes(root);
  assert.equal(run(root).status, 0);
  assert.deepEqual(hashes(root), before);
});

test('repeated installation validation is byte-for-byte idempotent', (t) => {
  const root = fixture(t);
  const before = hashes(root);
  assert.equal(run(root).status, 0);
  assert.equal(run(root).status, 0);
  assert.deepEqual(hashes(root), before);
});

test('missing tracked runtime fails instead of restoring from an archive', (t) => {
  const root = fixture(t);
  rmSync(join(root, 'api/scan.js'));
  put(root, '.bootstrap/runtime.b64.00', 'archive-must-not-be-used');
  const before = hashes(root);
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api\/scan\.js/);
  assert.match(result.stderr, /Restore tracked source from Git/);
  assert.deepEqual(hashes(root), before);
});

test('invalid JSON fails without silently substituting older data', (t) => {
  const root = fixture(t);
  put(root, 'data/build-milestones.json', '{invalid');
  const before = hashes(root);
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JSON is invalid: data\/build-milestones\.json/);
  assert.deepEqual(hashes(root), before);
});

test('null or incorrectly shaped registries fail validation', (t) => {
  const root = fixture(t);
  put(root, 'data/entities.json', 'null');
  assert.throws(() => validateRuntime(root), /must be an array/);
  put(root, 'data/entities.json', '[]');
  put(root, 'data/build-milestones.json', '[]');
  assert.throws(() => validateRuntime(root), /must be an object/);
});

test('empty or symlinked entry points fail closed', (t) => {
  const root = fixture(t);
  put(root, 'api/health.js', '');
  assert.throws(() => validateRuntime(root), /file is empty/);
  rmSync(join(root, 'api/health.js'));
  symlinkSync(join(root, 'api/scan.js'), join(root, 'api/health.js'));
  assert.throws(() => validateRuntime(root), /not a regular file/);
});

test('validation locates the source root independently of working directory', (t) => {
  const root = fixture(t);
  const result = run(root, tmpdir());
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no source files were changed/);
});
