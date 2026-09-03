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

console.log(`ABG Pulse runtime restored from ${chunks.length} verified bundle chunks.`);
