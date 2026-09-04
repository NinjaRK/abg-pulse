#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateSourceHealth, updateSourceBaselines } from '../lib/source-health.mjs';

const [, , scanPath, baselinePath = 'data/source-health-baselines.json', outputPath] = process.argv;
if (!scanPath) {
  console.error('Usage: node scripts/evaluate-source-health.mjs <scan.json> [baselines.json] [output.json]');
  process.exit(2);
}

const scan = JSON.parse(readFileSync(resolve(scanPath), 'utf8'));
const baselinePayload = JSON.parse(readFileSync(resolve(baselinePath), 'utf8'));
const { _meta, ...baselines } = baselinePayload;
const sourceChecks = Array.isArray(scan?.meta?.sourceChecks) ? scan.meta.sourceChecks : [];
if (!sourceChecks.length) throw new Error('Scan payload contains no sourceChecks.');

const evaluation = evaluateSourceHealth({ sourceChecks, baselines });
const learnedBaselines = updateSourceBaselines({ existing: baselines, sourceChecks });
const result = {
  evaluation,
  learnedBaselines: { _meta, ...learnedBaselines }
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), serialized);
else process.stdout.write(serialized);

if (!evaluation.gates.noExplicitTier0Failure || !evaluation.gates.noSilentTier0Failure) process.exitCode = 1;
