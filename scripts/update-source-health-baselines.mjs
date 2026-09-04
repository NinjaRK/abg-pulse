#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { updateSourceBaselines, evaluateSourceHealth } from '../lib/source-health.mjs';

const [, , scanPath, baselinePath = 'data/source-health-baselines.json', outputPath = baselinePath] = process.argv;
if (!scanPath) {
  console.error('Usage: node scripts/update-source-health-baselines.mjs <scan.json> [baselines.json] [output.json]');
  process.exit(2);
}

const scan = JSON.parse(readFileSync(resolve(scanPath), 'utf8'));
const baselinePayload = JSON.parse(readFileSync(resolve(baselinePath), 'utf8'));
const sourceChecks = Array.isArray(scan?.meta?.sourceChecks) ? scan.meta.sourceChecks : [];
if (!sourceChecks.length) throw new Error('Scan payload contains no sourceChecks.');

const { _meta = {}, ...existing } = baselinePayload;
const observedAt = scan?.meta?.scannedAt || new Date().toISOString();
const learned = updateSourceBaselines({ existing, sourceChecks, date: new Date(observedAt) });
const minimumSamples = Math.max(3, Number(_meta.minimumSamplesBeforeEnforcement || 5));
const sourceIds = Object.keys(learned);
const readyIds = sourceIds.filter((sourceId) => {
  const row = learned[sourceId] || {};
  return row.reviewed === true || row.enforce === true || (Array.isArray(row.samples) && row.samples.length >= minimumSamples);
});

const evaluation = evaluateSourceHealth({
  sourceChecks,
  baselines: learned,
  minimumSamplesBeforeEnforcement: minimumSamples,
  now: new Date(observedAt)
});

const output = {
  _meta: {
    ..._meta,
    status: readyIds.length === sourceIds.length && sourceIds.length > 0 ? 'ready' : 'learning',
    minimumSamplesBeforeEnforcement: minimumSamples,
    updatedAt: new Date().toISOString(),
    lastObservationAt: observedAt,
    configuredSourceCount: sourceChecks.length,
    learnedSourceCount: sourceIds.length,
    readySourceCount: readyIds.length,
    readySourcePct: sourceIds.length ? Math.round((readyIds.length / sourceIds.length) * 1000) / 10 : 0,
    lastEvaluation: {
      summary: evaluation.summary,
      gates: evaluation.gates
    },
    warning: 'A learned baseline detects abnormal silence; it does not prove completeness. Independent recall benchmarking remains mandatory.'
  },
  ...learned
};

writeFileSync(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output._meta, null, 2));
