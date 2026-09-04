#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareRegistry } from '../lib/registry-diff.mjs';

const [, , expectedPath, observedPath, outputPath] = process.argv;
if (!expectedPath || !observedPath) {
  console.error('Usage: node scripts/compare-registry.mjs <expected.json> <observed.json> [output.json]');
  process.exit(2);
}
const expectedPayload = JSON.parse(readFileSync(resolve(expectedPath), 'utf8'));
const observedPayload = JSON.parse(readFileSync(resolve(observedPath), 'utf8'));
const expected = Array.isArray(expectedPayload) ? expectedPayload : (expectedPayload.records || expectedPayload.entities || []);
const observed = Array.isArray(observedPayload) ? observedPayload : (observedPayload.records || observedPayload.entities || []);
const result = compareRegistry({ expected, observed });
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), serialized);
else process.stdout.write(serialized);
if (!result.reconciled) process.exitCode = 1;
