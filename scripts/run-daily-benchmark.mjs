#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchBenchmarkEvents } from '../lib/benchmark-matcher.mjs';
import { evaluateDependability, buildDailyLedgerEntry } from '../lib/dependability.mjs';

const [, , referencePath, scanPath, outputPath] = process.argv;
if (!referencePath || !scanPath) {
  console.error('Usage: node scripts/run-daily-benchmark.mjs <independent-reference.json> <production-scan.json> [output.json]');
  process.exit(2);
}

const referencePayload = JSON.parse(readFileSync(resolve(referencePath), 'utf8'));
const scanPayload = JSON.parse(readFileSync(resolve(scanPath), 'utf8'));
if (referencePayload.assembledIndependently !== true) {
  throw new Error('Reference set must explicitly declare assembledIndependently=true.');
}
if (!Array.isArray(referencePayload.events)) throw new Error('Reference set must contain an events array.');
if (!Array.isArray(scanPayload.events)) throw new Error('Production scan must contain an events array.');

const matching = matchBenchmarkEvents({
  references: referencePayload.events,
  systemEvents: scanPayload.events,
  minimumScore: Number(referencePayload.minimumMatchScore || 52)
});
const sourceHealth = scanPayload?.meta?.sourceHealth || {};
const tier0Outages = Number(sourceHealth?.summary?.tier0ExplicitFailures || 0) + Number(sourceHealth?.summary?.tier0SilentFailures || 0);
const evaluation = evaluateDependability({
  references: referencePayload.events,
  systemEvents: matching.annotatedSystemEvents,
  knownTier0Outages: tier0Outages
});
const ledgerEntry = buildDailyLedgerEntry({
  date: referencePayload.date,
  evaluation,
  scanMeta: scanPayload.meta || {},
  notes: [
    ...(Array.isArray(referencePayload.notes) ? referencePayload.notes : []),
    `Automated matching threshold: ${matching.summary.minimumScore}`,
    `Independent reference set reviewer: ${referencePayload.reviewer || 'not recorded'}`
  ]
});

const result = {
  date: referencePayload.date,
  reference: {
    assembledIndependently: true,
    reviewer: referencePayload.reviewer || null,
    method: referencePayload.method || null,
    eventCount: referencePayload.events.length
  },
  matching,
  evaluation,
  ledgerEntry
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), serialized);
else process.stdout.write(serialized);
if (!evaluation.pass) process.exitCode = 1;
