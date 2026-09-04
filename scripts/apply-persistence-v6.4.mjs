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

function replaceRegexOnce(source, pattern, after, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.length}.`);
  return source.replace(pattern, after);
}

const persistencePath = 'lib/persistence.mjs';
let persistence = readFileSync(persistencePath, 'utf8');
persistence = replaceOnce(
  persistence,
  "      if (start) params['last_seen_at'] = `gte.${new Date(start).toISOString()}`;\n      if (end) params['last_seen_at'] = `${params['last_seen_at'] ? `${params['last_seen_at']},` : ''}lte.${new Date(end).toISOString()}`;\n      if (classification) params.classification = `eq.${classification}`;",
  "      const periodFilters = [];\n      if (start) periodFilters.push(`last_seen_at.gte.${new Date(start).toISOString()}`);\n      if (end) periodFilters.push(`last_seen_at.lte.${new Date(end).toISOString()}`);\n      if (periodFilters.length) params.and = `(${periodFilters.join(',')})`;\n      if (classification) params.classification = `eq.${classification}`;",
  'PostgREST period conjunction'
);
writeFileSync(persistencePath, persistence);

const migrationPath = 'db/migrations/001_abg_pulse_core.sql';
let sql = readFileSync(migrationPath, 'utf8');
sql = replaceOnce(
  sql,
  "  v_article jsonb;\n  v_evidence jsonb;\n  v_claim jsonb;\n  v_contradiction jsonb;",
  "  v_evidence jsonb;\n  v_claim jsonb;\n  v_contradiction jsonb;\n  v_evidence_id text;\n  v_claim_id text;\n  v_contradiction_id text;\n  v_primary_entity_id text;",
  'persistence loop declarations'
);
sql = replaceOnce(
  sql,
  "create table if not exists public.pulse_watchlist_items (\n  watchlist_id uuid not null references public.pulse_watchlists(id) on delete cascade,\n  entity_id text references public.pulse_entities(id) on delete cascade,\n  event_id text references public.pulse_events(id) on delete cascade,\n  created_at timestamptz not null default now(),\n  metadata jsonb not null default '{}'::jsonb,\n  primary key (watchlist_id, entity_id, event_id),\n  check (entity_id is not null or event_id is not null)\n);",
  "create table if not exists public.pulse_watchlist_items (\n  id uuid primary key default gen_random_uuid(),\n  watchlist_id uuid not null references public.pulse_watchlists(id) on delete cascade,\n  entity_id text references public.pulse_entities(id) on delete cascade,\n  event_id text references public.pulse_events(id) on delete cascade,\n  created_at timestamptz not null default now(),\n  metadata jsonb not null default '{}'::jsonb,\n  check ((entity_id is not null)::integer + (event_id is not null)::integer = 1)\n);\ncreate unique index if not exists pulse_watchlist_entity_unique_idx on public.pulse_watchlist_items(watchlist_id, entity_id) where entity_id is not null;\ncreate unique index if not exists pulse_watchlist_event_unique_idx on public.pulse_watchlist_items(watchlist_id, event_id) where event_id is not null;",
  'watchlist nullable-key design'
);
sql = replaceOnce(
  sql,
  "      nullif(v_check->>'entityId',''),\n      case\n        when coalesce((v_check->>'deadlineSkipped')::boolean, false) then 'deadline_skipped'\n        when coalesce((v_check->>'silentFailure')::boolean, false) then 'silent_failure'\n        when coalesce((v_check->>'ok')::boolean, false) then coalesce(nullif(v_check->>'status',''), 'healthy')\n        else 'failed'\n      end,",
  "      case when exists (select 1 from public.pulse_entities where id = nullif(v_check->>'entityId','')) then nullif(v_check->>'entityId','') else null end,\n      case\n        when coalesce((v_check->>'deadlineSkipped')::boolean, false) then 'deadline_skipped'\n        when coalesce((v_check->>'silentFailure')::boolean, false) then 'silent_failure'\n        when coalesce((v_check->>'ok')::boolean, false) and lower(coalesce(v_check->>'status','')) = 'degraded' then 'degraded'\n        when coalesce((v_check->>'ok')::boolean, false) then 'healthy'\n        else 'failed'\n      end,",
  'source-check entity and status guard'
);
sql = replaceOnce(
  sql,
  "    v_event_count := v_event_count + 1;\n    select coalesce(max(version), 0) + 1 into v_event_version from public.pulse_event_versions where event_id = v_event->>'id';",
  "    v_event_count := v_event_count + 1;\n    select case when exists (\n      select 1 from public.pulse_entities\n      where id = nullif(coalesce(v_event->>'primaryEntityId', v_event#>>'{entities,0,id}'),'')\n    ) then nullif(coalesce(v_event->>'primaryEntityId', v_event#>>'{entities,0,id}'),'') else null end\n    into v_primary_entity_id;\n    select coalesce(max(version), 0) + 1 into v_event_version from public.pulse_event_versions where event_id = v_event->>'id';",
  'primary entity guard calculation'
);
sql = replaceOnce(
  sql,
  "      nullif(coalesce(v_event->>'primaryEntityId', v_event#>>'{entities,0,id}'),'') ,",
  "      v_primary_entity_id,",
  'primary entity guarded value'
);
sql = replaceOnce(
  sql,
  "    for v_evidence in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,evidence}', '[]'::jsonb)) loop\n      v_evidence_count := v_evidence_count + 1;",
  "    for v_evidence in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,evidence}', '[]'::jsonb)) loop\n      v_evidence_count := v_evidence_count + 1;\n      v_evidence_id := (v_event->>'id') || ':' || coalesce(v_evidence->>'id', encode(digest(coalesce(v_evidence->>'url','') || coalesce(v_evidence->>'contentFingerprint',''), 'sha256'),'hex'));",
  'event-scoped evidence identifier'
);
sql = replaceOnce(
  sql,
  "        v_evidence->>'id',\n        v_event->>'id',\n        v_evidence->>'id',",
  "        v_evidence_id,\n        v_event->>'id',\n        coalesce(v_evidence->>'id', 'article-' || encode(digest(coalesce(v_evidence->>'url','') || coalesce(v_evidence->>'contentFingerprint',''), 'sha256'),'hex')),
",
  'evidence primary and article identifiers'
);
sql = replaceOnce(
  sql,
  "    for v_claim in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,claimGroups}', '[]'::jsonb)) loop\n      v_claim_count := v_claim_count + 1;",
  "    for v_claim in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,claimGroups}', '[]'::jsonb)) loop\n      v_claim_count := v_claim_count + 1;\n      v_claim_id := (v_event->>'id') || ':' || (v_claim->>'id');",
  'event-scoped claim identifier'
);
sql = replaceOnce(
  sql,
  "        v_claim->>'id',\n        v_event->>'id',",
  "        v_claim_id,\n        v_event->>'id',",
  'claim persisted identifier'
);
sql = replaceOnce(
  sql,
  "      for v_article in select value from jsonb_array_elements_text(coalesce(v_claim->'evidenceIds','[]'::jsonb)) loop\n        insert into public.pulse_claim_evidence(claim_id, evidence_id, relationship)\n        values (v_claim->>'id', v_article#>>'{}', 'supports')",
  "      for v_evidence_id in select value from jsonb_array_elements_text(coalesce(v_claim->'evidenceIds','[]'::jsonb)) loop\n        insert into public.pulse_claim_evidence(claim_id, evidence_id, relationship)\n        values (v_claim_id, (v_event->>'id') || ':' || v_evidence_id, 'supports')",
  'claim-evidence event-scoped link'
);
sql = replaceOnce(
  sql,
  "    for v_contradiction in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,contradictions}', '[]'::jsonb)) loop\n      insert into public.pulse_contradictions(id, event_id, contradiction_type, status, claim_ids, evidence_ids, values, metadata)\n      values (\n        v_contradiction->>'id',",
  "    for v_contradiction in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,contradictions}', '[]'::jsonb)) loop\n      v_contradiction_id := (v_event->>'id') || ':' || (v_contradiction->>'id');\n      insert into public.pulse_contradictions(id, event_id, contradiction_type, status, claim_ids, evidence_ids, values, metadata)\n      values (\n        v_contradiction_id,",
  'event-scoped contradiction identifier'
);
writeFileSync(migrationPath, sql);

const healthPath = 'api/health.js';
let health = readFileSync(healthPath, 'utf8');
health = replaceRegexOnce(
  health,
  /  let databaseReachable = null;[\s\S]*?\n  const universeReconciled =/,
  `  let databaseReachable = null;
  let storageStatus = null;
  if (configured.database) {
    try {
      const response = await fetch(\`${process.env.SUPABASE_URL.replace(/\\\/$/, '')}/rest/v1/rpc/pulse_storage_status\`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: \`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}\`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
      databaseReachable = response.ok;
      if (response.ok) storageStatus = await response.json();
    } catch { databaseReachable = false; }
  }
  const universeReconciled =`,
  'database health probe'
);
health = replaceOnce(
  health,
  "    databaseReachable,\n    entityUniverse:",
  "    persistence: {\n      configured: configured.database,\n      reachable: databaseReachable,\n      schemaVersion: storageStatus?.schemaVersion || null,\n      sharedHistory: databaseReachable === true,\n      corrections: databaseReachable === true,\n      auditTrail: databaseReachable === true,\n      endpoints: { status: '/api/storage-status', history: '/api/history' },\n      warning: configured.database ? (databaseReachable ? 'Persistent storage is operational.' : 'Database is configured but the ABG Pulse schema is unavailable.') : 'Schema and APIs are built; production database authorisation is still required.'\n    },\n    databaseReachable,\n    entityUniverse:",
  'persistence health response'
);
writeFileSync(healthPath, health);

const vercelPath = 'vercel.json';
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
vercel.functions = vercel.functions || {};
vercel.functions['api/persist.js'] = { maxDuration: 30 };
vercel.functions['api/corrections.js'] = { maxDuration: 15 };
vercel.functions['api/history.js'] = { maxDuration: 15 };
vercel.functions['api/storage-status.js'] = { maxDuration: 15 };
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);

const packagePath = 'package.json';
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.version = '6.4.0';
for (const check of [
  'node --check lib/persistence.mjs',
  'node --check api/persist.js',
  'node --check api/history.js',
  'node --check api/storage-status.js',
  'node --check api/corrections.js'
]) {
  if (!String(packageJson.scripts?.check || '').includes(check)) packageJson.scripts.check = `${packageJson.scripts.check} && ${check}`;
}
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const releasePath = 'data/release.json';
const release = JSON.parse(readFileSync(releasePath, 'utf8'));
release.version = '6.4.0';
release.releaseName = 'Auditable persistent intelligence foundation';
for (const endpoint of ['/api/storage-status', '/api/history']) {
  if (!release.requiredEndpoints.includes(endpoint)) release.requiredEndpoints.push(endpoint);
}
for (const assertion of [
  'Persistent history fails visibly when the database is not authorised and never serves demonstration data as current',
  'Scan persistence is idempotent and atomically records source checks, events, evidence, claims and contradictions',
  'Evidence snapshots, event versions, source checks and audit records are append-only',
  'Correction requests create governed records instead of silently rewriting history'
]) {
  if (!release.requiredAssertions.includes(assertion)) release.requiredAssertions.push(assertion);
}
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);

const workflowPath = '.github/workflows/verify-production-release.yml';
let workflow = readFileSync(workflowPath, 'utf8');
workflow = replaceOnce(
  workflow,
  "          curl -L -fS --retry 3 --retry-delay 5 --max-time 60 \"$PRODUCTION_URL/api/progress\" -o evidence/progress.json",
  "          curl -L -fS --retry 3 --retry-delay 5 --max-time 60 \"$PRODUCTION_URL/api/progress\" -o evidence/progress.json\n          storage_code=$(curl -L -sS --retry 3 --retry-delay 5 --max-time 60 -o evidence/storage-status.json -w '%{http_code}' \"$PRODUCTION_URL/api/storage-status\" || true)\n          history_code=$(curl -L -sS --retry 3 --retry-delay 5 --max-time 60 -o evidence/history.json -w '%{http_code}' \"$PRODUCTION_URL/api/history?limit=1\" || true)\n          printf '%s' \"$storage_code\" > evidence/storage-status.code\n          printf '%s' \"$history_code\" > evidence/history.code",
  'persistence production evidence capture'
);
workflow = replaceOnce(
  workflow,
  "      - name: Verify transparency and honest objective status",
  `      - name: Verify persistence is operational or fails visibly
        shell: bash
        run: |
          set -euo pipefail
          node --input-type=module <<'NODE'
          import { readFileSync } from 'node:fs';
          const storage = JSON.parse(readFileSync('evidence/storage-status.json', 'utf8'));
          const history = JSON.parse(readFileSync('evidence/history.json', 'utf8'));
          const storageCode = readFileSync('evidence/storage-status.code', 'utf8').trim();
          const historyCode = readFileSync('evidence/history.code', 'utf8').trim();
          if (storageCode !== '200') throw new Error(\`Storage status returned HTTP \${storageCode}\`);
          if (storage.status === 'connected') {
            if (historyCode !== '200' || history.mode !== 'persistent' || !Array.isArray(history.events)) throw new Error('Connected storage did not provide persistent history.');
          } else if (storage.status === 'not_connected') {
            if (historyCode !== '503' || history.error !== 'database_not_configured') throw new Error('Unconfigured storage did not fail visibly.');
          } else {
            throw new Error(\`Unexpected storage status: \${storage.status}\`);
          }
          console.log(JSON.stringify({ storage: storage.status, historyHttp: historyCode }, null, 2));
          NODE

      - name: Verify transparency and honest objective status`,
  'persistence production verification'
);
writeFileSync(workflowPath, workflow);

const changelogPath = 'CHANGELOG.md';
let changelog = readFileSync(changelogPath, 'utf8');
const note = `## 6.4.0 — Auditable persistent intelligence foundation\n\n- Added an atomic Supabase/Postgres schema for entities, sources, scans, events, immutable evidence, claims, contradictions, corrections, predictions, watchlists and dependability records.\n- Added idempotent scan persistence, shared history, storage health and correction-request APIs.\n- Append-only source checks, evidence, snapshots, event versions and audit records prevent silent historical rewriting.\n- Row-level security is enabled with no public data policies until the organisation selects its identity and role model.\n- An unconnected database remains visibly unconnected; no demo or local state is presented as shared history.\n\n`;
if (!changelog.includes('## 6.4.0 — Auditable persistent intelligence foundation')) changelog = `${note}${changelog}`;
writeFileSync(changelogPath, changelog);

console.log('Auditable persistence schema and production transparency integrated.');
