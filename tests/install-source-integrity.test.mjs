import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { REQUIRED_RUNTIME_FILES, validateRuntime } from '../bootstrap.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'abg-pulse-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of REQUIRED_RUNTIME_FILES) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), path.endsWith('.json') ? '{"fixture":true}\n' : '// current committed source\n');
  }
  copyFileSync(fileURLToPath(new URL('../bootstrap.mjs', import.meta.url)), join(root, 'bootstrap.mjs'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'abg-pulse-install-fixture', version: '1.0.0', private: true, type: 'module',
    scripts: { postinstall: 'node bootstrap.mjs' }
  }));
  return root;
}

function fingerprint(root) {
  const records = [];
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, `${relative}/`);
      else records.push([relative, createHash('sha256').update(readFileSync(path)).digest('hex')]);
    }
  }
  visit(root);
  return records;
}

function run(root, cwd = root) {
  return spawnSync(process.execPath, [join(root, 'bootstrap.mjs')], { cwd, encoding: 'utf8', timeout: 10000 });
}

test('install validation succeeds without historical bundle chunks', (t) => {
  const root = fixture(t);
  const before = fingerprint(root);
  assert.equal(validateRuntime(root).status, 'ok');
  assert.equal(run(root).status, 0);
  assert.deepEqual(fingerprint(root), before);
});

test('archive presence cannot overwrite scanner, health or Job Meter', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, '.bootstrap'));
  writeFileSync(join(root, '.bootstrap/runtime.b64.00'), 'obsolete archive: must never be read');
  writeFileSync(join(root, 'api/scan.js'), '// exact current scanner, not the bundled version\n');
  writeFileSync(join(root, 'api/health.js'), '// exact current deployment provenance\n');
  writeFileSync(join(root, 'data/build-milestones.json'), '{"version":"current","completion":17}\n');
  const before = fingerprint(root);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fingerprint(root), before);
});

test('repeated postinstall executions are byte-for-byte idempotent', (t) => {
  const root = fixture(t);
  const before = fingerprint(root);
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(run(root).status, 0);
  assert.deepEqual(fingerprint(root), before);
});

test('incomplete checkout fails visibly without restoring old files', (t) => {
  const root = fixture(t);
  rmSync(join(root, 'api/scan.js'));
  const before = fingerprint(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /api\/scan\.js/);
  assert.match(result.stderr, /Historical archives are not an installation fallback/);
  assert.deepEqual(fingerprint(root), before);
});

test('malformed registry JSON fails without changing the registry', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'data/entities.json'), '{broken');
  const before = fingerprint(root);
  assert.throws(() => validateRuntime(root), /data\/entities\.json: invalid JSON/);
  assert.deepEqual(fingerprint(root), before);
});

test('null data is rejected rather than accepted as a usable registry', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'data/entities.json'), 'null');
  assert.throws(() => validateRuntime(root), /expected a JSON object or array/);
});

test('empty runtime modules are rejected', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'api/health.js'), '');
  assert.throws(() => validateRuntime(root), /api\/health\.js: missing or empty regular file/);
});

test('validation resolves assets relative to the script, not shell cwd', (t) => {
  const root = fixture(t);
  const result = run(root, tmpdir());
  assert.equal(result.status, 0, result.stderr);
});

test('real npm postinstall lifecycle preserves committed fixture bytes', (t) => {
  const root = fixture(t);
  const before = fingerprint(root);
  const result = spawnSync('npm', ['install', '--offline', '--package-lock=false', '--ignore-scripts=false', '--no-audit', '--no-fund'], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, npm_config_update_notifier: 'false' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /runtime validated/);
  assert.deepEqual(fingerprint(root), before);
});
