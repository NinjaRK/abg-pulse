import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const roots = ['api', 'lib', 'scripts', 'tests'];
const rootFiles = [
  'app.js',
  'core.mjs',
  'official.mjs',
  'bootstrap.mjs',
  'service-worker.js',
  'deploy-service-worker.js'
];
const ignoredDirectories = new Set(['node_modules', '.git', '.vercel', 'out', 'coverage', 'dist', 'build']);
const supported = new Set(['.js', '.mjs', '.cjs']);

function collect(path, output = []) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (ignoredDirectories.has(name)) continue;
      collect(join(path, name), output);
    }
  } else if (supported.has(extname(path))) {
    output.push(path);
  }
  return output;
}

const files = [];
for (const directory of roots) {
  try { collect(resolve(root, directory), files); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
for (const file of rootFiles) {
  try { if (statSync(resolve(root, file)).isFile()) files.push(resolve(root, file)); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const unique = [...new Set(files)].sort();
if (!unique.length) throw new Error('No JavaScript source files were found for syntax checking.');
const failures = [];
for (const file of unique) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({
      file: relative(root, file),
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status
    });
  }
}
if (failures.length) {
  for (const failure of failures) {
    console.error(`\nSyntax check failed: ${failure.file}`);
    if (failure.stdout) console.error(failure.stdout.trim());
    if (failure.stderr) console.error(failure.stderr.trim());
  }
  process.exitCode = 1;
} else {
  console.log(`Syntax verified for ${unique.length} JavaScript source files.`);
}
