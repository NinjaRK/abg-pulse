begin;

create table if not exists public.pulse_claim_graph_runs (
  id text primary key,
  schema_version text not null,
  generated_at timestamptz not null,
  source_commit text not null,
  governed_snapshot_generated_at timestamptz,
  governed_snapshot_source_commit text,
  event_count integer not null default 0 check (event_count >= 0),
  claim_count integer not null default 0 check (claim_count >= 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  unsupported_material_claim_count integer not null default 0 check (unsupported_material_claim_count >= 0),
  potential_contradiction_count integer not null default 0 check (potential_contradiction_count >= 0),
  manifest_sha256 text,
  quality jsonb not null default '{}'::jsonb,
  input jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  raw_graph jsonb not null,
  unique (source_commit, generated_at)
);

create table if not exists public.pulse_events (
  id text primary key,
  latest_graph_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  entity_ids text[] not null default '{}',
  claim_ids text[] not null default '{}',
  evidence_ids text[] not null default '{}',
  unsupported_fact_claims integer not null default 0 check (unsupported_fact_claims >= 0),
  provisional_fact_claims integer not null default 0 check (provisional_fact_claims >= 0),
  lifecycle text not null default 'observed',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_summary jsonb not null default '{}'::jsonb
);

create table if not exists public.pulse_evidence (
  id text primary key,
  event_id text not null,
  authority text not null,
  title text,
  url text not null,
  published_at timestamptz,
  tier integer not null default 3 check (tier between 0 and 9),
  official boolean not null default false,
  provider text,
  source_id text,
  attachment_url text,
  rights text,
  snapshot_source_commit text,
  first_seen_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  last_seen_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_evidence jsonb not null default '{}'::jsonb
);

create table if not exists public.pulse_claims (
  id text primary key,
  event_id text not null,
  entity_ids text[] not null default '{}',
  kind text not null check (kind in ('fact', 'interpretation')),
  text text not null,
  normalized_text text not null,
  sequence integer,
  support_status text not null check (support_status in ('supported', 'provisional', 'unsupported', 'interpretation')),
  support_reason text,
  support_confidence numeric,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  independent_evidence_count integer not null default 0 check (independent_evidence_count >= 0),
  observed_at timestamptz,
  lifecycle text not null default 'observed',
  source_event_version integer not null default 1 check (source_event_version >= 1),
  correction_id text,
  first_seen_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  last_seen_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_claim jsonb not null default '{}'::jsonb
);

create table if not exists public.pulse_claim_evidence (
  claim_id text not null references public.pulse_claims(id) on delete cascade,
  evidence_id text not null references public.pulse_evidence(id) on delete restrict,
  graph_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (claim_id, evidence_id, graph_run_id)
);

create table if not exists public.pulse_corrections (
  id text primary key,
  claim_id text not null references public.pulse_claims(id) on delete restrict,
  previous_text text not null,
  correction_text text not null,
  normalized_correction_text text not null,
  evidence_ids text[] not null default '{}',
  reason text not null,
  corrected_at timestamptz not null,
  actor text not null,
  version integer not null check (version >= 2),
  graph_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  raw_correction jsonb not null default '{}'::jsonb
);

create table if not exists public.pulse_contradictions (
  id text primary key,
  claim_ids text[] not null,
  entity_ids text[] not null default '{}',
  lexical_overlap numeric,
  reason text not null,
  status text not null default 'potential',
  graph_run_id text not null references public.pulse_claim_graph_runs(id) on delete restrict,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  resolved_by text,
  raw_contradiction jsonb not null default '{}'::jsonb
);

create table if not exists public.pulse_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  object_type text not null,
  object_id text,
  graph_run_id text references public.pulse_claim_graph_runs(id) on delete set null,
  request_id text,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pulse_claim_graph_runs_generated_at_idx on public.pulse_claim_graph_runs (generated_at desc);
create index if not exists pulse_events_entity_ids_idx on public.pulse_events using gin (entity_ids);
create index if not exists pulse_events_last_seen_idx on public.pulse_events (last_seen_at desc);
create index if not exists pulse_evidence_event_id_idx on public.pulse_evidence (event_id);
create index if not exists pulse_evidence_source_id_idx on public.pulse_evidence (source_id, published_at desc);
create index if not exists pulse_claims_event_id_idx on public.pulse_claims (event_id);
create index if not exists pulse_claims_entity_ids_idx on public.pulse_claims using gin (entity_ids);
create index if not exists pulse_claims_support_idx on public.pulse_claims (support_status, last_seen_at desc);
create index if not exists pulse_corrections_claim_id_idx on public.pulse_corrections (claim_id, corrected_at desc);
create index if not exists pulse_contradictions_status_idx on public.pulse_contradictions (status, last_detected_at desc);
create index if not exists pulse_audit_log_object_idx on public.pulse_audit_log (object_type, object_id, occurred_at desc);

alter table public.pulse_claim_graph_runs enable row level security;
alter table public.pulse_events enable row level security;
alter table public.pulse_evidence enable row level security;
alter table public.pulse_claims enable row level security;
alter table public.pulse_claim_evidence enable row level security;
alter table public.pulse_corrections enable row level security;
alter table public.pulse_contradictions enable row level security;
alter table public.pulse_audit_log enable row level security;

revoke all on public.pulse_claim_graph_runs from public, anon, authenticated;
revoke all on public.pulse_events from public, anon, authenticated;
revoke all on public.pulse_evidence from public, anon, authenticated;
revoke all on public.pulse_claims from public, anon, authenticated;
revoke all on public.pulse_claim_evidence from public, anon, authenticated;
revoke all on public.pulse_corrections from public, anon, authenticated;
revoke all on public.pulse_contradictions from public, anon, authenticated;
revoke all on public.pulse_audit_log from public, anon, authenticated;

create or replace function public.pulse_ingest_claim_graph(
  p_graph jsonb,
  p_manifest_sha256 text default null,
  p_actor text default 'claim-evidence-ingestor',
  p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id text;
  v_source_commit text;
  v_generated_at timestamptz;
  v_item jsonb;
  v_claim jsonb;
  v_evidence_id text;
  v_event_count integer := 0;
  v_claim_count integer := 0;
  v_evidence_count integer := 0;
  v_link_count integer := 0;
  v_correction_count integer := 0;
  v_contradiction_count integer := 0;
begin
  if p_graph is null or jsonb_typeof(p_graph) <> 'object' then
    raise exception 'claim graph must be a JSON object' using errcode = '22023';
  end if;
  if coalesce((p_graph #>> '{quality,publishable}')::boolean, false) is not true then
    raise exception 'claim graph is not publishable' using errcode = '22023';
  end if;
  if coalesce((p_graph #>> '{quality,unsupportedMaterialClaimCount}')::integer, 0) <> 0 then
    raise exception 'unsupported material claims block ingestion' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_graph->'claims', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_graph->'evidence', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_graph->'eventSummaries', '[]'::jsonb)) <> 'array' then
    raise exception 'claim graph arrays are structurally invalid' using errcode = '22023';
  end if;

  v_source_commit := nullif(p_graph->>'sourceCommit', '');
  v_generated_at := nullif(p_graph->>'generatedAt', '')::timestamptz;
  if v_source_commit is null or v_generated_at is null then
    raise exception 'source commit and generatedAt are required' using errcode = '22023';
  end if;
  v_run_id := md5(v_source_commit || '|' || v_generated_at::text || '|' || coalesce(p_manifest_sha256, ''));

  insert into public.pulse_claim_graph_runs (
    id, schema_version, generated_at, source_commit,
    governed_snapshot_generated_at, governed_snapshot_source_commit,
    event_count, claim_count, evidence_count,
    unsupported_material_claim_count, potential_contradiction_count,
    manifest_sha256, quality, input, raw_graph, ingested_at
  ) values (
    v_run_id,
    coalesce(p_graph->>'schemaVersion', 'unknown'),
    v_generated_at,
    v_source_commit,
    nullif(p_graph #>> '{input,governedSnapshotGeneratedAt}', '')::timestamptz,
    nullif(p_graph #>> '{input,governedSnapshotSourceCommit}', ''),
    coalesce((p_graph #>> '{summary,eventCount}')::integer, 0),
    coalesce((p_graph #>> '{summary,claimCount}')::integer, 0),
    coalesce((p_graph #>> '{summary,evidenceCount}')::integer, 0),
    coalesce((p_graph #>> '{quality,unsupportedMaterialClaimCount}')::integer, 0),
    coalesce((p_graph #>> '{quality,potentialContradictionCount}')::integer, 0),
    p_manifest_sha256,
    coalesce(p_graph->'quality', '{}'::jsonb),
    coalesce(p_graph->'input', '{}'::jsonb),
    p_graph,
    now()
  ) on conflict (id) do update set
    manifest_sha256 = excluded.manifest_sha256,
    quality = excluded.quality,
    input = excluded.input,
    raw_graph = excluded.raw_graph,
    ingested_at = now();

  for v_item in select value from jsonb_array_elements(coalesce(p_graph->'eventSummaries', '[]'::jsonb)) loop
    insert into public.pulse_events (
      id, latest_graph_run_id, entity_ids, claim_ids, evidence_ids,
      unsupported_fact_claims, provisional_fact_claims,
      lifecycle, first_seen_at, last_seen_at, raw_summary
    ) values (
      v_item->>'eventId', v_run_id,
      array(select jsonb_array_elements_text(coalesce(v_item->'entityIds', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_item->'claimIds', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_item->'evidenceIds', '[]'::jsonb))),
      coalesce((v_item->>'unsupportedFactClaims')::integer, 0),
      coalesce((v_item->>'provisionalFactClaims')::integer, 0),
      coalesce(v_item->>'lifecycle', 'observed'),
      now(), now(), v_item
    ) on conflict (id) do update set
      latest_graph_run_id = excluded.latest_graph_run_id,
      entity_ids = excluded.entity_ids,
      claim_ids = excluded.claim_ids,
      evidence_ids = excluded.evidence_ids,
      unsupported_fact_claims = excluded.unsupported_fact_claims,
      provisional_fact_claims = excluded.provisional_fact_claims,
      lifecycle = excluded.lifecycle,
      last_seen_at = now(),
      raw_summary = excluded.raw_summary;
    v_event_count := v_event_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_graph->'evidence', '[]'::jsonb)) loop
    insert into public.pulse_evidence (
      id, event_id, authority, title, url, published_at, tier, official,
      provider, source_id, attachment_url, rights, snapshot_source_commit,
      first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at, raw_evidence
    ) values (
      v_item->>'id', v_item->>'eventId', coalesce(v_item->>'authority', 'Unknown source'),
      nullif(v_item->>'title', ''), v_item->>'url', nullif(v_item->>'publishedAt', '')::timestamptz,
      coalesce((v_item->>'tier')::integer, 3), coalesce((v_item->>'official')::boolean, false),
      nullif(v_item->>'provider', ''), nullif(v_item->>'sourceId', ''),
      nullif(v_item->>'attachmentUrl', ''), nullif(v_item->>'rights', ''),
      nullif(v_item->>'snapshotSourceCommit', ''), v_run_id, v_run_id, now(), now(), v_item
    ) on conflict (id) do update set
      event_id = excluded.event_id,
      authority = excluded.authority,
      title = excluded.title,
      url = excluded.url,
      published_at = excluded.published_at,
      tier = excluded.tier,
      official = excluded.official,
      provider = excluded.provider,
      source_id = excluded.source_id,
      attachment_url = excluded.attachment_url,
      rights = excluded.rights,
      snapshot_source_commit = excluded.snapshot_source_commit,
      last_seen_run_id = v_run_id,
      last_seen_at = now(),
      raw_evidence = excluded.raw_evidence;
    v_evidence_count := v_evidence_count + 1;
  end loop;

  for v_claim in select value from jsonb_array_elements(coalesce(p_graph->'claims', '[]'::jsonb)) loop
    insert into public.pulse_claims (
      id, event_id, entity_ids, kind, text, normalized_text, sequence,
      support_status, support_reason, support_confidence,
      evidence_count, independent_evidence_count, observed_at, lifecycle,
      source_event_version, correction_id,
      first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at, raw_claim
    ) values (
      v_claim->>'id', v_claim->>'eventId',
      array(select jsonb_array_elements_text(coalesce(v_claim->'entityIds', '[]'::jsonb))),
      v_claim->>'kind', v_claim->>'text', v_claim->>'normalizedText',
      nullif(v_claim->>'sequence', '')::integer,
      v_claim->>'supportStatus', nullif(v_claim->>'supportReason', ''),
      nullif(v_claim->>'supportConfidence', '')::numeric,
      coalesce((v_claim->>'evidenceCount')::integer, 0),
      coalesce((v_claim->>'independentEvidenceCount')::integer, 0),
      nullif(v_claim->>'observedAt', '')::timestamptz,
      coalesce(v_claim->>'lifecycle', 'observed'),
      coalesce((v_claim->>'sourceEventVersion')::integer, 1),
      nullif(v_claim->>'correctionId', ''),
      v_run_id, v_run_id, now(), now(), v_claim
    ) on conflict (id) do update set
      event_id = excluded.event_id,
      entity_ids = excluded.entity_ids,
      kind = excluded.kind,
      text = excluded.text,
      normalized_text = excluded.normalized_text,
      sequence = excluded.sequence,
      support_status = excluded.support_status,
      support_reason = excluded.support_reason,
      support_confidence = excluded.support_confidence,
      evidence_count = excluded.evidence_count,
      independent_evidence_count = excluded.independent_evidence_count,
      observed_at = excluded.observed_at,
      lifecycle = excluded.lifecycle,
      source_event_version = excluded.source_event_version,
      correction_id = excluded.correction_id,
      last_seen_run_id = v_run_id,
      last_seen_at = now(),
      raw_claim = excluded.raw_claim;
    v_claim_count := v_claim_count + 1;

    for v_evidence_id in select jsonb_array_elements_text(coalesce(v_claim->'evidenceIds', '[]'::jsonb)) loop
      if not exists (select 1 from public.pulse_evidence where id = v_evidence_id) then
        raise exception 'claim % references unknown evidence %', v_claim->>'id', v_evidence_id using errcode = '23503';
      end if;
      insert into public.pulse_claim_evidence (claim_id, evidence_id, graph_run_id)
      values (v_claim->>'id', v_evidence_id, v_run_id)
      on conflict do nothing;
      v_link_count := v_link_count + 1;
    end loop;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_graph->'corrections', '[]'::jsonb)) loop
    insert into public.pulse_corrections (
      id, claim_id, previous_text, correction_text, normalized_correction_text,
      evidence_ids, reason, corrected_at, actor, version, graph_run_id, raw_correction
    ) values (
      v_item->>'id', v_item->>'claimId', v_item->>'previousText', v_item->>'correctionText',
      v_item->>'normalizedCorrectionText',
      array(select jsonb_array_elements_text(coalesce(v_item->'evidenceIds', '[]'::jsonb))),
      coalesce(v_item->>'reason', 'Correction supplied'),
      (v_item->>'correctedAt')::timestamptz,
      coalesce(v_item->>'actor', 'system'),
      (v_item->>'version')::integer,
      v_run_id, v_item
    ) on conflict (id) do update set
      evidence_ids = excluded.evidence_ids,
      reason = excluded.reason,
      raw_correction = excluded.raw_correction;
    v_correction_count := v_correction_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_graph->'contradictions', '[]'::jsonb)) loop
    insert into public.pulse_contradictions (
      id, claim_ids, entity_ids, lexical_overlap, reason, status,
      graph_run_id, first_detected_at, last_detected_at, raw_contradiction
    ) values (
      v_item->>'id',
      array(select jsonb_array_elements_text(coalesce(v_item->'claimIds', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_item->'entityIds', '[]'::jsonb))),
      nullif(v_item->>'lexicalOverlap', '')::numeric,
      v_item->>'reason', coalesce(v_item->>'status', 'potential'),
      v_run_id, now(), now(), v_item
    ) on conflict (id) do update set
      claim_ids = excluded.claim_ids,
      entity_ids = excluded.entity_ids,
      lexical_overlap = excluded.lexical_overlap,
      reason = excluded.reason,
      status = case when public.pulse_contradictions.status = 'resolved' then 'resolved' else excluded.status end,
      graph_run_id = excluded.graph_run_id,
      last_detected_at = now(),
      raw_contradiction = excluded.raw_contradiction;
    v_contradiction_count := v_contradiction_count + 1;
  end loop;

  insert into public.pulse_audit_log (
    actor, action, object_type, object_id, graph_run_id, request_id, new_value, metadata
  ) values (
    p_actor, 'ingest', 'claim_graph', v_run_id, v_run_id, p_request_id,
    jsonb_build_object(
      'events', v_event_count,
      'claims', v_claim_count,
      'evidence', v_evidence_count,
      'links', v_link_count,
      'corrections', v_correction_count,
      'contradictions', v_contradiction_count
    ),
    jsonb_build_object('sourceCommit', v_source_commit, 'manifestSha256', p_manifest_sha256)
  );

  return jsonb_build_object(
    'ok', true,
    'runId', v_run_id,
    'sourceCommit', v_source_commit,
    'generatedAt', v_generated_at,
    'events', v_event_count,
    'claims', v_claim_count,
    'evidence', v_evidence_count,
    'claimEvidenceLinks', v_link_count,
    'corrections', v_correction_count,
    'contradictions', v_contradiction_count,
    'ingestedAt', now()
  );
end;
$$;

revoke all on function public.pulse_ingest_claim_graph(jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.pulse_ingest_claim_graph(jsonb, text, text, text) to service_role;

commit;
