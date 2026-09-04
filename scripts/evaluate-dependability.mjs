#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateDependability, buildDailyLedgerEntry } from '../lib/dependability.mjs';

function usage() {
  console.error('Usage: node scripts/evaluate-dependability.mjs <reference.json> <system-events.json> [output.json]');
  process.exit(2);
}

const [, , referencePath, systemPath, outputPath] = process.argv;
if (!referencePath || !systemPath) usage();

const referencePayload = JSON.parse(readFileSync(resolve(referencePath), 'utf8'));
const systemPayload = JSON.parse(readFileSync(resolve(systemPath), 'utf8'));
if (referencePayload.assembledIndependently !== true) {
  throw new Error('Reference set must explicitly declare assembledIndependently=true.');
}
const references = Array.isArray(referencePayload.events) ? referencePayload.events : [];
const systemEvents = Array.isArray(systemPayload.events) ? systemPayload.events : [];
const evaluation = evaluateDependability({
  references,
  systemEvents,
  knownTier0Outages: systemPayload?.meta?.silentTier0Outages || 0
});
const output = {
  date: referencePayload.date || new Date().toISOString().slice(0, 10),
  evaluation,
  ledgerEntry: buildDailyLedgerEntry({
    date: referencePayload.date,
    evaluation,
    scanMeta: systemPayload.meta || {},
    notes: referencePayload.notes || []
  })
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), serialized);
else process.stdout.write(serialized);

if (!evaluation.pass) process.exitCode = 1;
