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

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.length}.`);
  return source.replace(pattern, replacement);
}

const path = 'db/migrations/001_abg_pulse_core.sql';
let sql = readFileSync(path, 'utf8');
sql = replaceOnce(
  sql,
  "  idempotency_key text not null unique,\n  status text not null default 'started'",
  "  idempotency_key text not null unique,\n  payload_hash text not null,\n  status text not null default 'started'",
  'scan payload hash column'
);
sql = replaceOnce(
  sql,
  "  v_idempotency text;\n  v_event_count integer := 0;",
  "  v_idempotency text;\n  v_payload_hash text;\n  v_existing_payload_hash text;\n  v_event_count integer := 0;",
  'scan idempotency variables'
);
sql = replaceOnce(
  sql,
  "  v_idempotency := coalesce(nullif(p_payload->>'idempotencyKey', ''), encode(digest(coalesce(p_payload->>'windowStart','') || '|' || coalesce(p_payload->>'windowEnd','') || '|' || coalesce(p_payload->>'commitSha',''), 'sha256'), 'hex'));\n\n  insert into public.pulse_scan_runs(",
  "  v_idempotency := coalesce(nullif(p_payload->>'idempotencyKey', ''), encode(digest(coalesce(p_payload->>'windowStart','') || '|' || coalesce(p_payload->>'windowEnd','') || '|' || coalesce(p_payload->>'commitSha',''), 'sha256'), 'hex'));\n  v_payload_hash := encode(digest(p_payload::text, 'sha256'), 'hex');\n\n  select id, payload_hash into v_run_id, v_existing_payload_hash\n  from public.pulse_scan_runs\n  where idempotency_key = v_idempotency\n  for update;\n\n  if found and v_existing_payload_hash <> v_payload_hash then\n    raise exception 'idempotency_key_reused_with_different_payload';\n  end if;\n\n  if found then\n    update public.pulse_scan_runs set\n      status = coalesce(p_payload->>'status', status),\n      completed_at = coalesce((p_payload->>'completedAt')::timestamptz, completed_at),\n      metadata = metadata || coalesce(p_payload->'metadata', '{}'::jsonb)\n    where id = v_run_id;\n  else\n    insert into public.pulse_scan_runs(",
  'scan idempotency preflight'
);
sql = replaceOnce(
  sql,
  "    idempotency_key, status, mode, window_start, window_end, started_at, completed_at,",
  "    idempotency_key, payload_hash, status, mode, window_start, window_end, started_at, completed_at,",
  'scan insert payload hash column'
);
sql = replaceOnce(
  sql,
  "    v_idempotency,\n    coalesce(p_payload->>'status', 'completed'),",
  "    v_idempotency,\n    v_payload_hash,\n    coalesce(p_payload->>'status', 'completed'),",
  'scan insert payload hash value'
);
sql = replaceRegexOnce(
  sql,
  /  \)\n  on conflict \(idempotency_key\) do update set[\s\S]*?  returning id into v_run_id;\n\n  for v_check/,
  "  ) returning id into v_run_id;\n  end if;\n\n  for v_check",
  'scan upsert replacement'
);
writeFileSync(path, sql);
console.log('Persistence idempotency now rejects key reuse with a different payload.');
