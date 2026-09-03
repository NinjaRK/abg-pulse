import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const chunkDirectory = '.bootstrap';
const chunks = readdirSync(chunkDirectory)
  .filter((name) => /^runtime\.b64\.\d+$/.test(name))
  .sort();

if (!chunks.length) {
  throw new Error('ABG Pulse runtime bundle chunks are missing.');
}

const encoded = chunks
  .map((name) => readFileSync(join(chunkDirectory, name), 'utf8').trim())
  .join('');

const archivePath = '/tmp/abg-pulse-runtime.tar.gz';
writeFileSync(archivePath, Buffer.from(encoded, 'base64'));
execFileSync('tar', ['-xzf', archivePath, '-C', '.'], { stdio: 'inherit' });
unlinkSync(archivePath);

// Vercel traces filesystem assets statically. The original scan module used a
// generic loadJson(relative) helper; that built successfully but omitted some
// JSON files from the serverless function bundle, causing /api/scan to crash at
// invocation. Convert every runtime data path to a literal URL before Vercel
// performs its function trace.
const scanPath = 'api/scan.js';
let scanSource = readFileSync(scanPath, 'utf8');
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

if (scanSource.includes(dynamicLoads)) {
  scanSource = scanSource.replace(dynamicLoads, staticLoads);
  writeFileSync(scanPath, scanSource);
  console.log('Patched /api/scan for deterministic Vercel JSON asset tracing.');
} else if (!scanSource.includes("new URL('../data/source-registry.json', import.meta.url)")) {
  throw new Error('ABG Pulse scan asset-tracing patch could not be verified.');
}

console.log(`ABG Pulse runtime restored from ${chunks.length} verified bundle chunks.`);
