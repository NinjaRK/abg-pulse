import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntitySourceCoverage } from '../lib/entity-source-coverage.mjs';

const load = async (relative) => JSON.parse(await readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const [entities, sourceRegistry, officialSources, queryGroups, authoritativeSources] = await Promise.all([
  load('../data/entities.json'),
  load('../data/source-registry.json'),
  load('../config/official-sources.json'),
  load('../config/queries.json'),
  load('../config/authoritative-sources-wave1.json')
]);

const generatedAt = new Date().toISOString();
const coverage = buildEntitySourceCoverage({
  entities,
  sourceRegistry,
  officialSources,
  queryGroups,
  authoritativeSources,
  generatedAt
});

if (!coverage.summary.entityCount) throw new Error('Entity coverage audit found no entities.');
if (!coverage.summary.sourceCount) throw new Error('Entity coverage audit found no governed sources.');
if (coverage.summary.priorityEntityCount < 42) throw new Error(`Priority entity universe is unexpectedly small: ${coverage.summary.priorityEntityCount}.`);

const output = resolve(process.env.ENTITY_SOURCE_COVERAGE_OUTPUT || 'data/entity-source-coverage.json');
const manifestOutput = resolve(process.env.ENTITY_SOURCE_COVERAGE_MANIFEST || 'data/entity-source-coverage.manifest.json');
const serialized = `${JSON.stringify(coverage, null, 2)}\n`;
const manifest = {
  schemaVersion: '1.0.0',
  generatedAt,
  sha256: createHash('sha256').update(serialized).digest('hex'),
  bytes: Buffer.byteLength(serialized),
  summary: coverage.summary,
  sourceCommit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null
};

await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(manifestOutput), { recursive: true });
await writeFile(output, serialized, 'utf8');
await writeFile(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
