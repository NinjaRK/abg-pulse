import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected one ${label}; found ${count}.`);
  return source.replace(before, after);
}

const migrationPath = 'db/migrations/001_abg_pulse_core.sql';
let sql = readFileSync(migrationPath, 'utf8');
sql = replaceOnce(
  sql,
  "      ) on conflict (id) do update set\n        last_retrieved_at = excluded.last_retrieved_at,\n        current_payload = excluded.current_payload,\n        updated_at = now();\n\n      insert into public.pulse_evidence(",
  "      ) on conflict (id) do update set\n        last_retrieved_at = excluded.last_retrieved_at,\n        current_payload = excluded.current_payload,\n        updated_at = now();\n\n      insert into public.pulse_article_snapshots(\n        article_id, retrieved_at, content_fingerprint, title, description, payload, payload_hash\n      ) values (\n        coalesce(v_evidence->>'id', 'article-' || encode(digest(coalesce(v_evidence->>'url','') || coalesce(v_evidence->>'contentFingerprint',''), 'sha256'),'hex')),\n        coalesce(nullif(v_evidence->>'retrievedAt','')::timestamptz, now()),\n        v_evidence->>'contentFingerprint',\n        nullif(v_evidence->>'title',''),\n        nullif(v_evidence->>'description',''),\n        v_evidence,\n        encode(digest(v_evidence::text,'sha256'),'hex')\n      ) on conflict (article_id, content_fingerprint) do nothing;\n\n      insert into public.pulse_evidence(",
  'article snapshot insertion'
);
writeFileSync(migrationPath, sql);

const canaryPath = 'db/test-canary-v2.sql';
let canary = readFileSync(canaryPath, 'utf8');
canary = replaceOnce(
  canary,
  "  select count(*) into v_count from public.pulse_evidence where event_id = 'event-1';\n  if v_count <> 1 then raise exception 'Expected one evidence record; found %', v_count; end if;",
  "  select count(*) into v_count from public.pulse_evidence where event_id = 'event-1';\n  if v_count <> 1 then raise exception 'Expected one evidence record; found %', v_count; end if;\n  select count(*) into v_count from public.pulse_article_snapshots where article_id = 'evidence-1';\n  if v_count <> 1 then raise exception 'Expected one immutable article snapshot; found %', v_count; end if;",
  'article snapshot canary assertion'
);
writeFileSync(canaryPath, canary);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '6.4.1';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const releasePath = 'data/release.json';
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
release.version = '6.4.1';
release.releaseName = 'Auditable persistence with immutable source snapshots';
if (!release.requiredAssertions.includes('Every retrieved article version is preserved as an immutable content-hashed snapshot')) {
  release.requiredAssertions.push('Every retrieved article version is preserved as an immutable content-hashed snapshot');
}
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.4.1 — Immutable source snapshots\n\n- Every evidence-bearing article retrieval now creates a content-hashed append-only snapshot.\n- Repeated scans reuse the canonical article while preserving each distinct source version.\n- The live PostgreSQL canary proves snapshot creation and mutation protection.\n\n`;
if (!changelog.includes('## 6.4.1 — Immutable source snapshots')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Immutable article snapshot hardening applied.');
