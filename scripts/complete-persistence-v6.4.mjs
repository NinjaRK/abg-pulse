import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Refusing ambiguous ${label}: ${count} matches.`);
  return source.replace(before, after);
}

const migrationPath = 'db/migrations/001_abg_pulse_core.sql';
let sql = readFileSync(migrationPath, 'utf8');
sql = replaceOnce(
  sql,
  "      ) on conflict (id) do update set\n        last_retrieved_at = excluded.last_retrieved_at,\n        current_payload = excluded.current_payload,\n        updated_at = now();\n\n      insert into public.pulse_evidence(",
  "      ) on conflict (id) do update set\n        last_retrieved_at = excluded.last_retrieved_at,\n        current_payload = excluded.current_payload,\n        updated_at = now();\n\n      insert into public.pulse_article_snapshots(\n        article_id, retrieved_at, content_fingerprint, title, description, payload, payload_hash\n      ) values (\n        coalesce(v_evidence->>'id', 'article-' || encode(digest(coalesce(v_evidence->>'url','') || coalesce(v_evidence->>'contentFingerprint',''), 'sha256'),'hex')),\n        coalesce(nullif(v_evidence->>'retrievedAt','')::timestamptz, now()),\n        v_evidence->>'contentFingerprint',\n        nullif(v_evidence->>'title',''),\n        nullif(v_evidence->>'description',''),\n        v_evidence,\n        encode(digest(v_evidence::text,'sha256'),'hex')\n      ) on conflict (article_id, content_fingerprint) do nothing;\n\n      insert into public.pulse_evidence(",
  'immutable article snapshot insertion'
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

console.log('Immutable article retrieval snapshots are now persisted and canary-tested.');
