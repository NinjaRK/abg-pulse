import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const bootstrap = join(repository, 'bootstrap.mjs');
function put(root, path, text) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, text);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pulse-bootstrap-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(root) {
  return execFileSync(process.execPath, [bootstrap], { cwd: root, encoding: 'utf8', timeout: 20_000 });
}

test('bootstrap restores missing assets without replacing reviewed source or configuration', (t) => {
  const root = fixture(t);
  const archiveRoot = join(root, 'archive-input');
  const checkout = join(root, 'checkout');
  const scan = "const sourceRegistry = new URL('../data/source-registry.json', import.meta.url);\n";
  for (const [path, text] of Object.entries({
    'api/health.js': 'export const historical = true;\n',
    'api/scan.js': `// Historical scan\n${scan}`,
    'package.json': '{"version":"0.0.0"}\n',
    'vercel.json': '{"headers":[]}\n',
    'missing-runtime-asset.txt': 'Restore only this missing asset.\n'
  })) put(archiveRoot, path, text);
  const protectedFiles = {
    'api/health.js': 'export const reviewed = true;\n',
    'api/scan.js': `// Reviewed scan\n${scan}`,
    'package.json': '{"version":"6.1.0"}\n',
    'vercel.json': '{"headers":[{"security":"reviewed"}]}\n'
  };
  for (const [path, text] of Object.entries(protectedFiles)) put(checkout, path, text);
  const archive = join(root, 'runtime.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', archiveRoot, '.']);
  put(checkout, '.bootstrap/runtime.b64.00', readFileSync(archive).toString('base64'));
  run(checkout);
  for (const [path, text] of Object.entries(protectedFiles)) {
    assert.equal(readFileSync(join(checkout, path), 'utf8'), text, `Bootstrap replaced reviewed ${path}`);
  }
  assert.equal(readFileSync(join(checkout, 'missing-runtime-asset.txt'), 'utf8'), 'Restore only this missing asset.\n');
});

test('the actual shipped bootstrap bundle preserves current health, claims, app and deployment configuration', (t) => {
  const checkout = fixture(t);
  cpSync(join(repository, '.bootstrap'), join(checkout, '.bootstrap'), { recursive: true });
  const paths = ['api/health.js', 'api/claims.js', 'api/persistence-health.js',
    'api/scan.js', 'lib/persistence-freshness.mjs', 'app.js', 'package.json', 'vercel.json'];
  const before = new Map();
  for (const path of paths) {
    const bytes = readFileSync(join(repository, path));
    before.set(path, bytes);
    put(checkout, path, bytes);
  }
  run(checkout);
  for (const path of paths) {
    assert.deepEqual(readFileSync(join(checkout, path)), before.get(path), `Shipped bundle replaced reviewed ${path}`);
  }
});
