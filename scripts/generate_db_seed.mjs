import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));
const entities = load('../data/entities.json');
const sources = load('../data/source-registry.json');
const q = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const json = (value) => `${q(JSON.stringify(value ?? {}))}::jsonb`;
const arr = (values = []) => `array[${values.map(q).join(',')}]::text[]`;

const sourceClass = (value) => ({
  official: 'official', 'official-filing': 'official', exchange: 'exchange', regulator: 'regulator',
  court: 'court', ratings: 'rating', 'major-media': 'major_media', 'specialist-media': 'specialist_media',
  regional: 'regional', international: 'international', wire: 'major_media', 'discovery-index': 'discovery',
  'public-conversation': 'signal', 'closed-social-optional': 'signal'
}[value] || 'discovery');

const lines = ['-- Generated from governed JSON assets. Do not edit by hand.', `-- Generated at ${new Date().toISOString()}`, 'begin;', ''];
for (const entity of entities) {
  const metadata = { ...entity };
  for (const key of ['id','name','type','tier','aliases','officialUrl','parentId']) delete metadata[key];
  lines.push(`insert into public.entities (id,name,entity_type,priority_tier,official_url,metadata) values (${q(entity.id)},${q(entity.name)},${q(entity.type)},${Number(entity.tier ?? 3)},${entity.officialUrl ? q(entity.officialUrl) : 'null'},${json(metadata)}) on conflict (id) do update set name=excluded.name, entity_type=excluded.entity_type, priority_tier=excluded.priority_tier, official_url=excluded.official_url, metadata=excluded.metadata, active=true;`);
  for (const alias of new Set([entity.name, ...(entity.aliases || [])])) {
    if (!alias) continue;
    lines.push(`insert into public.entity_aliases (entity_id,alias,language_code,ambiguity_notes) values (${q(entity.id)},${q(alias)},'en',${entity.ambiguous ? q('Context required; see entity metadata.') : 'null'}) on conflict (entity_id,alias,language_code) do update set active=true, ambiguity_notes=excluded.ambiguity_notes;`);
  }
}
lines.push('');
for (const entity of entities.filter((item) => item.parentId)) {
  const relationship = entity.relationship || (entity.type === 'person' ? 'leadership_of' : entity.type === 'brand' ? 'brand_of' : 'belongs_to');
  lines.push(`insert into public.entity_relationships (from_entity_id,to_entity_id,relationship_type,evidence_url,metadata) values (${q(entity.id)},${q(entity.parentId)},${q(relationship)},${entity.sourceUrl ? q(entity.sourceUrl) : 'null'},'{}'::jsonb) on conflict (from_entity_id,to_entity_id,relationship_type,effective_from) do nothing;`);
}
lines.push('');
for (const source of sources) {
  const metadata = { originalClass: source.class || source.sourceClass, active: source.active !== false, notes: source.notes || null };
  const rights = source.rights || 'metadata-only';
  const fetchPolicy = /full|extract/i.test(rights) ? 'permitted-extracts' : /public-record|filing/i.test(rights) ? 'public-record' : 'metadata-only';
  lines.push(`insert into public.sources (domain,name,source_class,evidence_tier,language_codes,geographies,rights_classification,fetch_policy,active,last_reviewed_at,metadata) values (${q(source.domain)},${q(source.name)},${q(sourceClass(source.class || source.sourceClass))},${Number(source.tier ?? 3)},${arr(source.languages || ['en'])},${arr(source.geographies || [])},${q(rights)},${q(fetchPolicy)},${source.active === false ? 'false' : 'true'},now(),${json(metadata)}) on conflict (domain) do update set name=excluded.name, source_class=excluded.source_class, evidence_tier=excluded.evidence_tier, rights_classification=excluded.rights_classification, fetch_policy=excluded.fetch_policy, active=excluded.active, last_reviewed_at=excluded.last_reviewed_at, metadata=excluded.metadata;`);
}
lines.push('', 'commit;', '');
writeFileSync(fileURLToPath(new URL('../db/seed.sql', import.meta.url)), lines.join('\n'));
console.log(`Generated db/seed.sql for ${entities.length} entities and ${sources.length} sources.`);
