import {
  constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, rmSync, writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const chunks = readdirSync(join(root, '.bootstrap'))
  .filter((file) => /^runtime\.b64\.\d+$/.test(file))
  .sort();
if (!chunks.length) throw new Error('ABG Pulse runtime chunks are missing.');
const temporary = mkdtempSync(join(tmpdir(), 'abg-pulse-runtime-'));
const restored = new Set();

function existing(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// A historical bundle may supply missing assets, never replace the checkout.
// lstat and exclusive copying also prevent following an existing symlink.
function restoreMissing(sourceDirectory, targetDirectory, relative = '') {
  for (const name of readdirSync(sourceDirectory)) {
    const source = join(sourceDirectory, name);
    const target = join(targetDirectory, name);
    const path = relative ? `${relative}/${name}` : name;
    const sourceStat = lstatSync(source);
    const targetStat = existing(target);
    if (sourceStat.isDirectory()) {
      if (targetStat && !targetStat.isDirectory()) continue;
      if (!targetStat) mkdirSync(target);
      restoreMissing(source, target, path);
    } else if (sourceStat.isFile()) {
      if (targetStat) continue;
      copyFileSync(source, target, constants.COPYFILE_EXCL);
      restored.add(path);
    } else {
      throw new Error(`Unsupported runtime archive entry: ${path}`);
    }
  }
}

try {
  const archive = join(temporary, 'runtime.tar.gz');
  const staging = join(temporary, 'contents');
  const encoded = chunks.map((file) => readFileSync(join(root, '.bootstrap', file), 'utf8').trim()).join('');
  writeFileSync(archive, Buffer.from(encoded, 'base64'));
  mkdirSync(staging);
  const options = { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024 };
  const names = execFileSync('tar', ['-tzf', archive], options).split('\n').filter(Boolean);
  for (const name of names) {
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\')
        || name.split('/').includes('..')) {
      throw new Error('Runtime archive contains an unsafe path.');
    }
  }
  const entries = execFileSync('tar', ['-tvzf', archive], options).split('\n').filter(Boolean);
  if (entries.some((line) => !['-', 'd'].includes(line[0]))) {
    throw new Error('Runtime archive must contain only regular files and directories.');
  }
  execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' });
  restoreMissing(staging, root);

  // Apply the historical JSON tracing adaptation only to a restored legacy
  // scan file. A reviewed, already present scan file must remain byte-identical.
  const scanPath = join(root, 'api/scan.js');
  let scan = readFileSync(scanPath, 'utf8');
  const dynamicLoads = `const loadJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const entities = loadJson('../data/entities.json');
const sources = loadJson('../data/source-registry.json');
const queryGroups = loadJson('../config/queries.json');
const officialSources = loadJson('../config/official-sources.json');
const entityUniverse = loadJson('../data/entity-universe-summary.json');`;
  const staticLoads = `// Literal paths are required so Vercel includes each JSON asset in the function bundle.
const entities = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entities.json', import.meta.url)), 'utf8'));
const sources = JSON.parse(readFileSync(fileURLToPath(new URL('../data/source-registry.json', import.meta.url)), 'utf8'));
const queryGroups = JSON.parse(readFileSync(fileURLToPath(new URL('../config/queries.json', import.meta.url)), 'utf8'));
const officialSources = JSON.parse(readFileSync(fileURLToPath(new URL('../config/official-sources.json', import.meta.url)), 'utf8'));
const entityUniverse = JSON.parse(readFileSync(fileURLToPath(new URL('../data/entity-universe-summary.json', import.meta.url)), 'utf8'));`;
  if (restored.has('api/scan.js') && scan.includes(dynamicLoads)) {
    scan = scan.replace(dynamicLoads, staticLoads);
    writeFileSync(scanPath, scan);
  }
  if (scan.includes('new URL(relative, import.meta.url)')
      || !scan.includes("new URL('../data/source-registry.json', import.meta.url)")) {
    throw new Error('ABG Pulse scan must use reviewed static JSON file URLs.');
  }
  console.log(`ABG Pulse restored ${restored.size} missing runtime assets; existing source and configuration were preserved.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
