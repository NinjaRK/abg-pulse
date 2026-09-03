import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const requiredFiles = [
  'index.html','styles.css','app.js','core.mjs','manifest.webmanifest','service-worker.js','vercel.json',
  'data/entities.json','data/entity-universe-summary.json','data/source-registry.json','data/demo-events.json','data/build-milestones.json','config/queries.json','config/official-sources.json','official.mjs',
  'api/scan.js','api/events.js','api/ingest.js','api/social-ingest.js','api/health.js','api/progress.js','db/schema.sql','db/seed.sql','scripts/generate_db_seed.mjs','workflows/n8n-abg-pulse.json','workflows/n8n-social-listening.json'
];
const errors = [];
for (const file of requiredFiles) if (!existsSync(resolve(root, file))) errors.push(`Missing ${file}`);
const readJson = (file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const entities = readJson('data/entities.json');
const universe = readJson('data/entity-universe-summary.json');
const sources = readJson('data/source-registry.json');
const events = readJson('data/demo-events.json');
const officialSources = readJson('config/official-sources.json');
const queryGroups = readJson('config/queries.json');
const entityIds = new Set(entities.map((entity) => entity.id));

const buildPlan = readJson('data/build-milestones.json');
const milestoneWeight = (buildPlan.milestones || []).reduce((sum, item) => sum + Number(item.weight || 0), 0);
const jobCompletion = milestoneWeight ? Math.round((buildPlan.milestones || []).reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.completion || 0) / 100, 0) / milestoneWeight * 100) : 0;
if (milestoneWeight !== 100) errors.push(`Milestone weights total ${milestoneWeight}, not 100.`);
if (jobCompletion !== 40) errors.push(`Job meter completion is ${jobCompletion}%, expected 40%.`);
for (const milestone of buildPlan.milestones || []) if (!milestone.acceptanceGate || !milestone.nextAction || !milestone.dependency) errors.push(`${milestone.id || 'milestone'}: incomplete progress governance.`);
const eventIds = new Set();

if (entityIds.size !== entities.length) errors.push('Entity IDs are not unique.');
const officialCompanyEntries = entities.filter((entity) => entity.type === 'company' && entity.officialCompanyEntry === true);
const officialLeadershipEntries = entities.filter((entity) => entity.type === 'person' && entity.sourceUrl === universe.sourceOfTruth?.leadership);
const stakeholderEntries = entities.filter((entity) => entity.type === 'stakeholder');
if (universe.officialCompanyEntries !== 42) errors.push(`Universe expects ${universe.officialCompanyEntries} official companies, not 42.`);
if (officialCompanyEntries.length !== universe.officialCompanyEntries) errors.push(`Official company coverage is ${officialCompanyEntries.length}/${universe.officialCompanyEntries}.`);
if (officialLeadershipEntries.length !== universe.officialLeadershipEntries) errors.push(`Official leadership coverage is ${officialLeadershipEntries.length}/${universe.officialLeadershipEntries}.`);
if (entities.length !== universe.totalEntities) errors.push(`Entity-universe total is ${entities.length}, summary says ${universe.totalEntities}.`);
if (stakeholderEntries.length < 20) errors.push('Insufficient stakeholder entity coverage.');
if (queryGroups.length < 14) errors.push('Insufficient query-group coverage.');
if (officialSources.length < 15) errors.push('Insufficient direct official-source watch coverage.');
if (sources.length < 80) errors.push('Insufficient governed source registry.');
for (const entity of officialCompanyEntries) if (!entity.sourceUrl || !entity.lastVerifiedAt || entity.coverageRequired !== true) errors.push(`${entity.id}: official company governance metadata incomplete.`);
for (const entity of officialLeadershipEntries) if (!entity.role || !entity.lastVerifiedAt || entity.coverageRequired !== true) errors.push(`${entity.id}: official leadership governance metadata incomplete.`);
if (new Set(sources.map((source) => source.domain)).size !== sources.length) errors.push('Source domains are not unique.');
const queryCorpus = JSON.stringify(queryGroups).toLowerCase();
const simplify = (value = '') => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function coveredByQueries(entity) {
  const candidates = [entity.name, ...(entity.aliases || [])].map(simplify).map((value) => value.replace(/\b(limited|ltd|inc|plc|private)\b/g, '').replace(/\s+/g, ' ').trim()).filter((value) => value.length >= 4);
  const corpus = simplify(queryCorpus);
  return candidates.some((candidate) => corpus.includes(candidate));
}
for (const entity of [...officialCompanyEntries, ...officialLeadershipEntries]) if (!coveredByQueries(entity)) errors.push(`${entity.id}: absent from governed discovery queries.`);

for (const event of events) {
  if (eventIds.has(event.id)) errors.push(`Duplicate event ID ${event.id}`); eventIds.add(event.id);
  for (const field of ['headline','summary','whyItMatters','bucket','status','category','publishedAt','updatedAt']) if (!event[field]) errors.push(`${event.id}: missing ${field}`);
  if (!['must','watch','other'].includes(event.bucket)) errors.push(`${event.id}: invalid bucket`);
  if (!['confirmed','strong','developing'].includes(event.status)) errors.push(`${event.id}: invalid status`);
  const words = event.summary.trim().split(/\s+/).length;
  if (words < 60 || words > 100) errors.push(`${event.id}: summary has ${words} words (target 60–100)`);
  if (!Array.isArray(event.sources) || !event.sources.length) errors.push(`${event.id}: no source evidence`);
  for (const source of event.sources || []) if (!/^https?:\/\//.test(source.url || '')) errors.push(`${event.id}: invalid source URL`);
  for (const id of event.entityIds || []) if (!entityIds.has(id)) errors.push(`${event.id}: unknown entity ${id}`);
  for (const score of ['materiality','certainty','momentum','narrativeAlignment']) { const value = event.intelligence?.[score]; if (!Number.isFinite(value) || value < 0 || value > 100) errors.push(`${event.id}: invalid ${score}`); }
  const sentiment = event.intelligence?.sentiment;
  if (!Number.isFinite(sentiment) || sentiment < -100 || sentiment > 100) errors.push(`${event.id}: invalid sentiment`);
}

for (const source of officialSources) if (!source.id || !source.name || !/^https:\/\//.test(source.url || '')) errors.push(`Invalid official source ${source.id || source.name || 'unknown'}`);
if (sources.filter((source) => source.tier === 0).length < 10) errors.push('Insufficient authoritative source registry.');
if (entities.filter((entity) => entity.type === 'person').length < 10) errors.push('Insufficient leadership entity coverage.');
const schemaSql = readFileSync(resolve(root, 'db/schema.sql'), 'utf8');
const seedSql = readFileSync(resolve(root, 'db/seed.sql'), 'utf8');
if (!schemaSql.includes("'stakeholder'")) errors.push('Database schema does not support stakeholder entities.');
if (!schemaSql.includes('public_conversation_observations')) errors.push('Database schema is missing public-conversation observations.');
for (const column of ['media_tone_score','public_sentiment_score','public_sentiment_sample_size','public_sentiment_channel_count','public_sentiment_confidence']) if (!schemaSql.includes(column)) errors.push(`Database schema is missing ${column}.`);
const seededEntities = (seedSql.match(/insert into public\.entities /g) || []).length;
const seededSources = (seedSql.match(/insert into public\.sources /g) || []).length;
if (seededEntities !== entities.length) errors.push(`Database seed contains ${seededEntities}/${entities.length} entities.`);
if (seededSources !== sources.length) errors.push(`Database seed contains ${seededSources}/${sources.length} sources.`);

if (errors.length) { console.error(errors.map((error) => `✗ ${error}`).join('\n')); process.exit(1); }
console.log(`✓ Validated ${officialCompanyEntries.length}/${universe.officialCompanyEntries} official companies, ${officialLeadershipEntries.length}/${universe.officialLeadershipEntries} official leaders, ${entities.length} total entities, ${sources.length} sources and ${events.length} evidence-backed demo events.`);
