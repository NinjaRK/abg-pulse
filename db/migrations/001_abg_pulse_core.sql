-- ABG Pulse core persistence schema
-- Designed for Supabase Postgres. Apply with the Supabase SQL editor or migration CLI.
-- No credentials or private content belong in this repository.

begin;

create extension if not exists pgcrypto;

create table if not exists public.pulse_entities (
  id text primary key,
  name text not null,
  entity_type text not null check (entity_type in ('group','company','brand','person','stakeholder','regulator','other')),
  status text not null default 'active' check (status in ('active','designate','former','inactive','unknown')),
  priority text check (priority in ('critical','high','medium','low','exclude')),
  official_company_entry boolean not null default false,
  official_leadership_entry boolean not null default false,
  jurisdiction text,
  country text,
  source_url text,
  effective_from date,
  effective_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table if not exists public.pulse_entity_aliases (
  entity_id text not null references public.pulse_entities(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (lower(regexp_replace(alias, '[^a-zA-Z0-9]+', ' ', 'g'))) stored,
  language text,
  alias_type text not null default 'name',
  created_at timestamptz not null default now(),
  primary key (entity_id, normalized_alias)
);
create index if not exists pulse_entity_aliases_lookup_idx on public.pulse_entity_aliases using gin (to_tsvector('simple', normalized_alias));

create table if not exists public.pulse_entity_relationships (
  id uuid primary key default gen_random_uuid(),
  from_entity_id text not null references public.pulse_entities(id),
  to_entity_id text not null references public.pulse_entities(id),
  relationship_type text not null,
  ownership_percent numeric(7,4) check (ownership_percent is null or (ownership_percent >= 0 and ownership_percent <= 100)),
  effective_from date,
  effective_to date,
  evidence_url text,
  evidence_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_entity_id, to_entity_id, relationship_type, effective_from),
  check (from_entity_id <> to_entity_id),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index if not exists pulse_entity_relationships_from_idx on public.pulse_entity_relationships(from_entity_id, relationship_type);
create index if not exists pulse_entity_relationships_to_idx on public.pulse_entity_relationships(to_entity_id, relationship_type);

create table if not exists public.pulse_sources (
  id text primary key,
  name text not null,
  source_type text not null,
  tier text not null check (tier in ('tier0','tier1','tier2','tier3')),
  authority text,
  domain text,
  url text,
  rights_status text not null,
  cadence text not null,
  language text,
  geography text,
  direct boolean not null default false,
  official boolean not null default false,
  active boolean not null default true,
  entity_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pulse_sources_tier_idx on public.pulse_sources(tier, active);
create index if not exists pulse_sources_domain_idx on public.pulse_sources(domain);

create table if not exists public.pulse_scan_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  status text not null default 'started' check (status in ('started','completed','degraded','failed')),
  mode text not null default 'live-on-demand',
  window_start timestamptz not null,
  window_end timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  commit_sha text,
  service_version text,
  query_count integer not null default 0 check (query_count >= 0),
  successful_queries integer not null default 0 check (successful_queries >= 0),
  raw_article_count integer not null default 0 check (raw_article_count >= 0),
  relevant_article_count integer not null default 0 check (relevant_article_count >= 0),
  event_count integer not null default 0 check (event_count >= 0),
  source_health jsonb not null default '{}'::jsonb,
  registry_reconciled boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (window_end >= window_start),
  check (completed_at is null or completed_at >= started_at),
  check (successful_queries <= query_count)
);
create index if not exists pulse_scan_runs_window_idx on public.pulse_scan_runs(window_start desc, window_end desc);
create index if not exists pulse_scan_runs_status_idx on public.pulse_scan_runs(status, started_at desc);

create table if not exists public.pulse_source_checks (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.pulse_scan_runs(id) on delete cascade,
  source_id text,
  provider text,
  tier text check (tier is null or tier in ('tier0','tier1','tier2','tier3')),
  authority text,
  entity_id text references public.pulse_entities(id),
  status text not null check (status in ('healthy','degraded','failed','silent_failure','deadline_skipped')),
  item_count integer not null default 0 check (item_count >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  schema_validated boolean,
  empty_is_valid boolean not null default false,
  silent_failure boolean not null default false,
  error text,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  unique (scan_run_id, source_id)
);
create index if not exists pulse_source_checks_source_idx on public.pulse_source_checks(source_id, checked_at desc);
create index if not exists pulse_source_checks_failures_idx on public.pulse_source_checks(status, checked_at desc) where status <> 'healthy';

create table if not exists public.pulse_articles (
  id text primary key,
  canonical_url text not null,
  title text not null,
  description text,
  domain text,
  publisher text,
  original_publisher_key text,
  provider text,
  source_id text references public.pulse_sources(id),
  source_tier text check (source_tier is null or source_tier in ('tier0','tier1','tier2','tier3')),
  channel text,
  language text,
  rights_status text not null default 'link-and-summary-only',
  official boolean not null default false,
  published_at timestamptz,
  first_retrieved_at timestamptz not null default now(),
  last_retrieved_at timestamptz not null default now(),
  content_fingerprint text not null,
  current_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_url, content_fingerprint)
);
create index if not exists pulse_articles_published_idx on public.pulse_articles(published_at desc);
create index if not exists pulse_articles_domain_idx on public.pulse_articles(domain, published_at desc);
create index if not exists pulse_articles_fingerprint_idx on public.pulse_articles(content_fingerprint);

create table if not exists public.pulse_article_snapshots (
  id uuid primary key default gen_random_uuid(),
  article_id text not null references public.pulse_articles(id) on delete cascade,
  retrieved_at timestamptz not null default now(),
  content_fingerprint text not null,
  title text,
  description text,
  payload jsonb not null,
  payload_hash text not null,
  unique (article_id, content_fingerprint)
);
create index if not exists pulse_article_snapshots_article_idx on public.pulse_article_snapshots(article_id, retrieved_at desc);

create table if not exists public.pulse_events (
  id text primary key,
  canonical_title text not null,
  summary text,
  why_it_matters text,
  interpretation text,
  action_posture text,
  classification text not null check (classification in ('Must Know','Watch','Other')),
  verification_status text not null default 'single-source' check (verification_status in ('confirmed','strongly-corroborated','corroborated','single-source','disputed','unverified')),
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  materiality numeric(5,2) check (materiality is null or (materiality >= 0 and materiality <= 100)),
  momentum numeric(5,2) check (momentum is null or (momentum >= 0 and momentum <= 100)),
  media_tone numeric(6,2) check (media_tone is null or (media_tone >= -100 and media_tone <= 100)),
  narrative_risk numeric(5,2) check (narrative_risk is null or (narrative_risk >= 0 and narrative_risk <= 100)),
  lifecycle_status text not null default 'emerging' check (lifecycle_status in ('emerging','confirmed','updated','corrected','closed','retracted')),
  primary_entity_id text references public.pulse_entities(id),
  entity_ids jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  occurred_at timestamptz,
  published_at timestamptz,
  evidence_chain_hash text,
  evidence_hash text,
  source_count integer not null default 0 check (source_count >= 0),
  independent_source_count integer not null default 0 check (independent_source_count >= 0),
  tier0_evidence_count integer not null default 0 check (tier0_evidence_count >= 0),
  unsupported_material_claim_count integer not null default 0 check (unsupported_material_claim_count >= 0),
  contradiction_count integer not null default 0 check (contradiction_count >= 0),
  current_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at),
  check (classification <> 'Must Know' or verification_status in ('confirmed','strongly-corroborated','corroborated')),
  check (classification <> 'Must Know' or contradiction_count = 0),
  check (classification <> 'Must Know' or unsupported_material_claim_count = 0)
);
create index if not exists pulse_events_feed_idx on public.pulse_events(classification, published_at desc nulls last, last_seen_at desc);
create index if not exists pulse_events_entity_ids_idx on public.pulse_events using gin(entity_ids);
create index if not exists pulse_events_lifecycle_idx on public.pulse_events(lifecycle_status, last_seen_at desc);

create table if not exists public.pulse_event_versions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.pulse_events(id) on delete cascade,
  version integer not null,
  recorded_at timestamptz not null default now(),
  reason text not null,
  payload jsonb not null,
  payload_hash text not null,
  unique (event_id, version)
);
create index if not exists pulse_event_versions_event_idx on public.pulse_event_versions(event_id, version desc);

create table if not exists public.pulse_event_articles (
  event_id text not null references public.pulse_events(id) on delete cascade,
  article_id text not null references public.pulse_articles(id) on delete restrict,
  relationship text not null default 'supports' check (relationship in ('supports','contradicts','context','updates','retracts')),
  first_linked_at timestamptz not null default now(),
  primary key (event_id, article_id)
);

create table if not exists public.pulse_evidence (
  id text primary key,
  event_id text not null references public.pulse_events(id) on delete cascade,
  article_id text references public.pulse_articles(id) on delete restrict,
  title text,
  url text not null,
  domain text,
  publisher text,
  provider text,
  source_tier text check (source_tier is null or source_tier in ('tier0','tier1','tier2','tier3')),
  channel text,
  official boolean not null default false,
  rights_status text not null,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  content_fingerprint text not null,
  evidence_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pulse_evidence_event_idx on public.pulse_evidence(event_id, source_tier, published_at desc);
create index if not exists pulse_evidence_fingerprint_idx on public.pulse_evidence(content_fingerprint);

create table if not exists public.pulse_claims (
  id text primary key,
  event_id text not null references public.pulse_events(id) on delete cascade,
  claim_text text not null,
  topic_key text,
  material boolean not null default false,
  supported boolean not null default false,
  verification_status text not null default 'single-source',
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  numeric_anchors jsonb not null default '[]'::jsonb,
  independent_sources jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at),
  check (not material or supported or verification_status in ('single-source','disputed','unverified'))
);
create index if not exists pulse_claims_event_idx on public.pulse_claims(event_id, material, supported);

create table if not exists public.pulse_claim_evidence (
  claim_id text not null references public.pulse_claims(id) on delete cascade,
  evidence_id text not null references public.pulse_evidence(id) on delete restrict,
  relationship text not null default 'supports' check (relationship in ('supports','contradicts','context')),
  created_at timestamptz not null default now(),
  primary key (claim_id, evidence_id)
);

create table if not exists public.pulse_contradictions (
  id text primary key,
  event_id text not null references public.pulse_events(id) on delete cascade,
  contradiction_type text not null,
  status text not null default 'unresolved' check (status in ('unresolved','resolved','dismissed')),
  claim_ids jsonb not null default '[]'::jsonb,
  evidence_ids jsonb not null default '[]'::jsonb,
  values jsonb not null default '[]'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  resolved_by text,
  metadata jsonb not null default '{}'::jsonb,
  check (resolved_at is null or resolved_at >= detected_at)
);
create index if not exists pulse_contradictions_open_idx on public.pulse_contradictions(event_id, detected_at desc) where status = 'unresolved';

create table if not exists public.pulse_corrections (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.pulse_events(id) on delete restrict,
  claim_id text references public.pulse_claims(id) on delete restrict,
  correction_type text not null check (correction_type in ('clarification','correction','retraction','source_update','classification_change')),
  reason text not null,
  replacement_text text,
  evidence_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied')),
  requested_by text,
  approved_by text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (approved_at is null or approved_at >= requested_at),
  check (applied_at is null or approved_at is null or applied_at >= approved_at)
);
create index if not exists pulse_corrections_event_idx on public.pulse_corrections(event_id, requested_at desc);
create index if not exists pulse_corrections_pending_idx on public.pulse_corrections(status, requested_at) where status = 'pending';

create table if not exists public.pulse_predictions (
  id text primary key,
  event_id text not null references public.pulse_events(id) on delete cascade,
  horizon_hours integer not null check (horizon_hours in (6,24,72)),
  probability numeric(6,4) not null check (probability >= 0 and probability <= 1),
  model_version text not null,
  feature_version text,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  outcome text check (outcome is null or outcome in ('hit','false_alarm','unresolved','cancelled')),
  graded_at timestamptz,
  grading_evidence jsonb not null default '[]'::jsonb,
  unique (event_id, horizon_hours, model_version, created_at),
  check (due_at >= created_at),
  check (graded_at is null or graded_at >= created_at)
);
create index if not exists pulse_predictions_due_idx on public.pulse_predictions(outcome, due_at) where outcome is null or outcome = 'unresolved';

create table if not exists public.pulse_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  persona text,
  period_start timestamptz not null,
  period_end timestamptz not null,
  generated_at timestamptz not null default now(),
  event_ids jsonb not null default '[]'::jsonb,
  must_know_count integer not null default 0,
  watch_count integer not null default 0,
  other_count integer not null default 0,
  completed_at timestamptz,
  completion_seconds integer check (completion_seconds is null or completion_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb,
  check (period_end >= period_start),
  check (completed_at is null or completed_at >= generated_at)
);
create index if not exists pulse_briefings_user_idx on public.pulse_briefings(user_id, generated_at desc);

create table if not exists public.pulse_user_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_id text references public.pulse_events(id) on delete set null,
  briefing_id uuid references public.pulse_briefings(id) on delete set null,
  action text not null check (action in ('view','expand','watch','unwatch','share','source_open','helpful','not_helpful','dismiss','search','ask')),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists pulse_user_interactions_user_idx on public.pulse_user_interactions(user_id, created_at desc);
create index if not exists pulse_user_interactions_event_idx on public.pulse_user_interactions(event_id, created_at desc);

create table if not exists public.pulse_watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null default 'Watching',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.pulse_watchlist_items (
  watchlist_id uuid not null references public.pulse_watchlists(id) on delete cascade,
  entity_id text references public.pulse_entities(id) on delete cascade,
  event_id text references public.pulse_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (watchlist_id, entity_id, event_id),
  check (entity_id is not null or event_id is not null)
);

create table if not exists public.pulse_dependability_days (
  day date primary key,
  status text not null check (status in ('pending','pass','fail','void')),
  reference_event_count integer not null default 0,
  system_event_count integer not null default 0,
  precision_pct numeric(6,2),
  recall_pct numeric(6,2),
  critical_recall_pct numeric(6,2),
  materiality_weighted_recall_pct numeric(6,2),
  unsupported_material_claims integer not null default 0,
  silent_tier0_outages integer not null default 0,
  evidence_hash text,
  reference_method text,
  independent_reviewer text,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (precision_pct is null or (precision_pct >= 0 and precision_pct <= 100)),
  check (recall_pct is null or (recall_pct >= 0 and recall_pct <= 100)),
  check (critical_recall_pct is null or (critical_recall_pct >= 0 and critical_recall_pct <= 100)),
  check (materiality_weighted_recall_pct is null or (materiality_weighted_recall_pct >= 0 and materiality_weighted_recall_pct <= 100))
);

create table if not exists public.pulse_audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('insert','update','delete','correction','system')),
  actor text,
  occurred_at timestamptz not null default now(),
  old_payload jsonb,
  new_payload jsonb,
  previous_hash text,
  entry_hash text not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists pulse_audit_log_record_idx on public.pulse_audit_log(table_name, record_id, occurred_at desc);

create or replace function public.pulse_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.pulse_audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_record_id text;
  v_actor text;
  v_previous_hash text;
  v_old jsonb;
  v_new jsonb;
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_record_id := coalesce(v_new->>'id', v_old->>'id', v_new->>'day', v_old->>'day', 'unknown');
  v_actor := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('app.actor', true), ''), current_user);
  select entry_hash into v_previous_hash from public.pulse_audit_log order by id desc limit 1;
  insert into public.pulse_audit_log(table_name, record_id, action, actor, old_payload, new_payload, previous_hash, entry_hash)
  values (
    tg_table_name,
    v_record_id,
    lower(tg_op),
    v_actor,
    v_old,
    v_new,
    v_previous_hash,
    encode(digest(coalesce(v_previous_hash, '') || tg_table_name || v_record_id || tg_op || coalesce(v_old::text, '') || coalesce(v_new::text, '') || clock_timestamp()::text, 'sha256'), 'hex')
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.pulse_block_immutable_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; create a correction or a new version instead', tg_table_name;
end;
$$;

create trigger pulse_entities_updated_at before update on public.pulse_entities for each row execute function public.pulse_set_updated_at();
create trigger pulse_relationships_updated_at before update on public.pulse_entity_relationships for each row execute function public.pulse_set_updated_at();
create trigger pulse_sources_updated_at before update on public.pulse_sources for each row execute function public.pulse_set_updated_at();
create trigger pulse_articles_updated_at before update on public.pulse_articles for each row execute function public.pulse_set_updated_at();
create trigger pulse_events_updated_at before update on public.pulse_events for each row execute function public.pulse_set_updated_at();
create trigger pulse_claims_updated_at before update on public.pulse_claims for each row execute function public.pulse_set_updated_at();
create trigger pulse_watchlists_updated_at before update on public.pulse_watchlists for each row execute function public.pulse_set_updated_at();
create trigger pulse_dependability_updated_at before update on public.pulse_dependability_days for each row execute function public.pulse_set_updated_at();

create trigger pulse_events_audit after insert or update or delete on public.pulse_events for each row execute function public.pulse_audit_trigger();
create trigger pulse_claims_audit after insert or update or delete on public.pulse_claims for each row execute function public.pulse_audit_trigger();
create trigger pulse_corrections_audit after insert or update or delete on public.pulse_corrections for each row execute function public.pulse_audit_trigger();
create trigger pulse_predictions_audit after insert or update or delete on public.pulse_predictions for each row execute function public.pulse_audit_trigger();
create trigger pulse_dependability_audit after insert or update or delete on public.pulse_dependability_days for each row execute function public.pulse_audit_trigger();

create trigger pulse_source_checks_immutable before update or delete on public.pulse_source_checks for each row execute function public.pulse_block_immutable_mutation();
create trigger pulse_article_snapshots_immutable before update or delete on public.pulse_article_snapshots for each row execute function public.pulse_block_immutable_mutation();
create trigger pulse_evidence_immutable before update or delete on public.pulse_evidence for each row execute function public.pulse_block_immutable_mutation();
create trigger pulse_event_versions_immutable before update or delete on public.pulse_event_versions for each row execute function public.pulse_block_immutable_mutation();
create trigger pulse_audit_log_immutable before update or delete on public.pulse_audit_log for each row execute function public.pulse_block_immutable_mutation();

create or replace function public.pulse_storage_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'schemaVersion', '6.4.0',
    'entities', (select count(*) from public.pulse_entities),
    'sources', (select count(*) from public.pulse_sources),
    'events', (select count(*) from public.pulse_events),
    'claims', (select count(*) from public.pulse_claims),
    'evidence', (select count(*) from public.pulse_evidence),
    'scanRuns', (select count(*) from public.pulse_scan_runs),
    'latestScanAt', (select max(completed_at) from public.pulse_scan_runs),
    'openContradictions', (select count(*) from public.pulse_contradictions where status = 'unresolved'),
    'pendingCorrections', (select count(*) from public.pulse_corrections where status = 'pending'),
    'dependabilityDays', (select count(*) from public.pulse_dependability_days where status in ('pass','fail')),
    'auditHead', (select entry_hash from public.pulse_audit_log order by id desc limit 1)
  );
$$;

create or replace function public.pulse_record_correction(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(p_payload->>'eventId', '') = '' or coalesce(p_payload->>'type', '') = '' or coalesce(p_payload->>'reason', '') = '' then
    raise exception 'eventId, type and reason are required';
  end if;
  insert into public.pulse_corrections(event_id, claim_id, correction_type, reason, replacement_text, evidence_ids, requested_by, metadata)
  values (
    p_payload->>'eventId',
    nullif(p_payload->>'claimId', ''),
    p_payload->>'type',
    p_payload->>'reason',
    nullif(p_payload->>'replacementText', ''),
    coalesce(p_payload->'evidenceIds', '[]'::jsonb),
    nullif(p_payload->>'requestedBy', ''),
    coalesce(p_payload->'metadata', '{}'::jsonb)
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'correctionId', v_id, 'status', 'pending');
end;
$$;

create or replace function public.pulse_persist_scan(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run_id uuid;
  v_event jsonb;
  v_article jsonb;
  v_evidence jsonb;
  v_claim jsonb;
  v_contradiction jsonb;
  v_check jsonb;
  v_event_version integer;
  v_idempotency text;
  v_event_count integer := 0;
  v_evidence_count integer := 0;
  v_claim_count integer := 0;
begin
  v_idempotency := coalesce(nullif(p_payload->>'idempotencyKey', ''), encode(digest(coalesce(p_payload->>'windowStart','') || '|' || coalesce(p_payload->>'windowEnd','') || '|' || coalesce(p_payload->>'commitSha',''), 'sha256'), 'hex'));

  insert into public.pulse_scan_runs(
    idempotency_key, status, mode, window_start, window_end, started_at, completed_at,
    commit_sha, service_version, query_count, successful_queries, raw_article_count,
    relevant_article_count, event_count, source_health, registry_reconciled, metadata
  ) values (
    v_idempotency,
    coalesce(p_payload->>'status', 'completed'),
    coalesce(p_payload->>'mode', 'live-on-demand'),
    (p_payload->>'windowStart')::timestamptz,
    (p_payload->>'windowEnd')::timestamptz,
    coalesce((p_payload->>'startedAt')::timestamptz, now()),
    coalesce((p_payload->>'completedAt')::timestamptz, now()),
    nullif(p_payload->>'commitSha',''),
    nullif(p_payload->>'serviceVersion',''),
    coalesce((p_payload->>'queryCount')::integer, 0),
    coalesce((p_payload->>'successfulQueries')::integer, 0),
    coalesce((p_payload->>'rawArticleCount')::integer, 0),
    coalesce((p_payload->>'relevantArticleCount')::integer, 0),
    jsonb_array_length(coalesce(p_payload->'events', '[]'::jsonb)),
    coalesce(p_payload->'sourceHealth', '{}'::jsonb),
    case when p_payload ? 'registryReconciled' then (p_payload->>'registryReconciled')::boolean else null end,
    coalesce(p_payload->'metadata', '{}'::jsonb)
  )
  on conflict (idempotency_key) do update set
    status = excluded.status,
    completed_at = excluded.completed_at,
    query_count = excluded.query_count,
    successful_queries = excluded.successful_queries,
    raw_article_count = excluded.raw_article_count,
    relevant_article_count = excluded.relevant_article_count,
    event_count = excluded.event_count,
    source_health = excluded.source_health,
    registry_reconciled = excluded.registry_reconciled,
    metadata = excluded.metadata
  returning id into v_run_id;

  for v_check in select * from jsonb_array_elements(coalesce(p_payload->'sourceChecks', '[]'::jsonb)) loop
    insert into public.pulse_source_checks(
      scan_run_id, source_id, provider, tier, authority, entity_id, status, item_count,
      duration_ms, attempts, schema_validated, empty_is_valid, silent_failure, error, details
    ) values (
      v_run_id,
      nullif(coalesce(v_check->>'sourceId', v_check->>'id', v_check->>'name'), ''),
      nullif(v_check->>'provider',''),
      nullif(v_check->>'tier',''),
      nullif(v_check->>'authority',''),
      nullif(v_check->>'entityId',''),
      case
        when coalesce((v_check->>'deadlineSkipped')::boolean, false) then 'deadline_skipped'
        when coalesce((v_check->>'silentFailure')::boolean, false) then 'silent_failure'
        when coalesce((v_check->>'ok')::boolean, false) then coalesce(nullif(v_check->>'status',''), 'healthy')
        else 'failed'
      end,
      coalesce((v_check->>'itemCount')::integer, 0),
      nullif(v_check->>'durationMs','')::integer,
      coalesce((v_check->>'attempts')::integer, 0),
      nullif(v_check->>'schemaValidated','')::boolean,
      coalesce((v_check->>'emptyIsValid')::boolean, false),
      coalesce((v_check->>'silentFailure')::boolean, false),
      nullif(v_check->>'error',''),
      v_check
    ) on conflict (scan_run_id, source_id) do nothing;
  end loop;

  for v_event in select * from jsonb_array_elements(coalesce(p_payload->'events', '[]'::jsonb)) loop
    v_event_count := v_event_count + 1;
    select coalesce(max(version), 0) + 1 into v_event_version from public.pulse_event_versions where event_id = v_event->>'id';

    insert into public.pulse_events(
      id, canonical_title, summary, why_it_matters, interpretation, action_posture,
      classification, verification_status, confidence, materiality, momentum, media_tone,
      narrative_risk, lifecycle_status, primary_entity_id, entity_ids, first_seen_at,
      last_seen_at, occurred_at, published_at, evidence_chain_hash, evidence_hash,
      source_count, independent_source_count, tier0_evidence_count,
      unsupported_material_claim_count, contradiction_count, current_payload
    ) values (
      v_event->>'id',
      coalesce(v_event->>'title', v_event->>'headline', 'Untitled event'),
      nullif(v_event->>'summary',''),
      nullif(coalesce(v_event->>'whyItMatters', v_event#>>'{intelligence,whyItMatters}'),'') ,
      nullif(v_event->>'interpretation',''),
      nullif(coalesce(v_event->>'actionPosture', v_event#>>'{intelligence,actionPosture}'),'') ,
      coalesce(v_event#>>'{intelligence,classification}', v_event->>'classification', 'Other'),
      coalesce(v_event->>'verificationStatus', v_event#>>'{evidenceChain,verification,status}', 'single-source'),
      nullif(coalesce(v_event->>'confidence', v_event#>>'{evidenceChain,verification,confidence}'),'')::numeric,
      nullif(coalesce(v_event->>'materiality', v_event#>>'{intelligence,materiality}'),'')::numeric,
      nullif(coalesce(v_event->>'momentum', v_event#>>'{intelligence,momentum}'),'')::numeric,
      nullif(coalesce(v_event->>'mediaTone', v_event#>>'{intelligence,mediaTone,score}'),'')::numeric,
      nullif(coalesce(v_event->>'narrativeRisk', v_event#>>'{intelligence,narrativeRisk}'),'')::numeric,
      coalesce(v_event->>'lifecycleStatus', 'emerging'),
      nullif(coalesce(v_event->>'primaryEntityId', v_event#>>'{entities,0,id}'),'') ,
      coalesce(v_event->'entityIds', v_event->'entities', '[]'::jsonb),
      coalesce(nullif(v_event->>'firstSeenAt','')::timestamptz, now()),
      coalesce(nullif(v_event->>'lastSeenAt','')::timestamptz, now()),
      nullif(v_event->>'occurredAt','')::timestamptz,
      nullif(v_event->>'publishedAt','')::timestamptz,
      nullif(v_event#>>'{evidenceChain,chainHash}',''),
      nullif(v_event#>>'{evidenceChain,evidenceHash}',''),
      coalesce((v_event#>>'{evidenceChain,evidenceCount}')::integer, 0),
      coalesce((v_event#>>'{evidenceChain,independentSourceCount}')::integer, 0),
      coalesce((v_event#>>'{evidenceChain,tier0EvidenceCount}')::integer, 0),
      coalesce((v_event#>>'{evidencePolicy,unsupportedMaterialClaimCount}')::integer, 0),
      coalesce(jsonb_array_length(coalesce(v_event#>'{evidenceChain,contradictions}','[]'::jsonb)), 0),
      v_event
    )
    on conflict (id) do update set
      canonical_title = excluded.canonical_title,
      summary = excluded.summary,
      why_it_matters = excluded.why_it_matters,
      interpretation = excluded.interpretation,
      action_posture = excluded.action_posture,
      classification = excluded.classification,
      verification_status = excluded.verification_status,
      confidence = excluded.confidence,
      materiality = excluded.materiality,
      momentum = excluded.momentum,
      media_tone = excluded.media_tone,
      narrative_risk = excluded.narrative_risk,
      lifecycle_status = excluded.lifecycle_status,
      primary_entity_id = excluded.primary_entity_id,
      entity_ids = excluded.entity_ids,
      last_seen_at = greatest(public.pulse_events.last_seen_at, excluded.last_seen_at),
      occurred_at = coalesce(excluded.occurred_at, public.pulse_events.occurred_at),
      published_at = coalesce(excluded.published_at, public.pulse_events.published_at),
      evidence_chain_hash = excluded.evidence_chain_hash,
      evidence_hash = excluded.evidence_hash,
      source_count = excluded.source_count,
      independent_source_count = excluded.independent_source_count,
      tier0_evidence_count = excluded.tier0_evidence_count,
      unsupported_material_claim_count = excluded.unsupported_material_claim_count,
      contradiction_count = excluded.contradiction_count,
      current_payload = excluded.current_payload;

    if not exists (
      select 1 from public.pulse_event_versions where event_id = v_event->>'id' and payload_hash = encode(digest(v_event::text, 'sha256'),'hex')
    ) then
      insert into public.pulse_event_versions(event_id, version, reason, payload, payload_hash)
      values (v_event->>'id', v_event_version, 'scan_ingestion', v_event, encode(digest(v_event::text, 'sha256'),'hex'));
    end if;

    for v_evidence in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,evidence}', '[]'::jsonb)) loop
      v_evidence_count := v_evidence_count + 1;
      insert into public.pulse_articles(
        id, canonical_url, title, description, domain, publisher, original_publisher_key,
        provider, source_tier, channel, rights_status, official, published_at,
        first_retrieved_at, last_retrieved_at, content_fingerprint, current_payload
      ) values (
        coalesce(v_evidence->>'id', 'article-' || encode(digest(coalesce(v_evidence->>'url','') || coalesce(v_evidence->>'contentFingerprint',''), 'sha256'),'hex')),
        v_evidence->>'url',
        coalesce(v_evidence->>'title','Untitled source'),
        nullif(v_evidence->>'description',''),
        nullif(v_evidence->>'domain',''),
        nullif(v_evidence->>'publisher',''),
        nullif(v_evidence->>'originalPublisherKey',''),
        nullif(v_evidence->>'provider',''),
        nullif(v_evidence->>'tier',''),
        nullif(v_evidence->>'channel',''),
        coalesce(v_evidence->>'rightsStatus','link-and-summary-only'),
        coalesce((v_evidence->>'official')::boolean,false),
        nullif(v_evidence->>'publishedAt','')::timestamptz,
        coalesce(nullif(v_evidence->>'retrievedAt','')::timestamptz, now()),
        coalesce(nullif(v_evidence->>'retrievedAt','')::timestamptz, now()),
        v_evidence->>'contentFingerprint',
        v_evidence
      ) on conflict (id) do update set
        last_retrieved_at = excluded.last_retrieved_at,
        current_payload = excluded.current_payload,
        updated_at = now();

      insert into public.pulse_evidence(
        id, event_id, article_id, title, url, domain, publisher, provider, source_tier,
        channel, official, rights_status, published_at, retrieved_at,
        content_fingerprint, evidence_hash, payload
      ) values (
        v_evidence->>'id',
        v_event->>'id',
        v_evidence->>'id',
        nullif(v_evidence->>'title',''),
        v_evidence->>'url',
        nullif(v_evidence->>'domain',''),
        nullif(v_evidence->>'publisher',''),
        nullif(v_evidence->>'provider',''),
        nullif(v_evidence->>'tier',''),
        nullif(v_evidence->>'channel',''),
        coalesce((v_evidence->>'official')::boolean,false),
        coalesce(v_evidence->>'rightsStatus','link-and-summary-only'),
        nullif(v_evidence->>'publishedAt','')::timestamptz,
        coalesce(nullif(v_evidence->>'retrievedAt','')::timestamptz, now()),
        v_evidence->>'contentFingerprint',
        encode(digest(v_evidence::text,'sha256'),'hex'),
        v_evidence
      ) on conflict (id) do nothing;

      insert into public.pulse_event_articles(event_id, article_id, relationship)
      values (v_event->>'id', v_evidence->>'id', 'supports')
      on conflict do nothing;
    end loop;

    for v_claim in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,claimGroups}', '[]'::jsonb)) loop
      v_claim_count := v_claim_count + 1;
      insert into public.pulse_claims(
        id, event_id, claim_text, topic_key, material, supported, verification_status,
        confidence, numeric_anchors, independent_sources, last_seen_at
      ) values (
        v_claim->>'id',
        v_event->>'id',
        v_claim->>'canonicalText',
        nullif(v_claim->>'topicKey',''),
        coalesce((v_claim->>'material')::boolean,false),
        coalesce((v_claim->>'supported')::boolean,false),
        coalesce(v_claim->>'verification','single-source'),
        nullif(v_claim->>'confidence','')::numeric,
        coalesce(v_claim->'numericAnchors','[]'::jsonb),
        coalesce(v_claim->'independentSources','[]'::jsonb),
        now()
      ) on conflict (id) do update set
        claim_text = excluded.claim_text,
        material = excluded.material,
        supported = excluded.supported,
        verification_status = excluded.verification_status,
        confidence = excluded.confidence,
        numeric_anchors = excluded.numeric_anchors,
        independent_sources = excluded.independent_sources,
        last_seen_at = now(),
        updated_at = now();

      for v_article in select value from jsonb_array_elements_text(coalesce(v_claim->'evidenceIds','[]'::jsonb)) loop
        insert into public.pulse_claim_evidence(claim_id, evidence_id, relationship)
        values (v_claim->>'id', v_article#>>'{}', 'supports')
        on conflict do nothing;
      end loop;
    end loop;

    for v_contradiction in select * from jsonb_array_elements(coalesce(v_event#>'{evidenceChain,contradictions}', '[]'::jsonb)) loop
      insert into public.pulse_contradictions(id, event_id, contradiction_type, status, claim_ids, evidence_ids, values, metadata)
      values (
        v_contradiction->>'id',
        v_event->>'id',
        coalesce(v_contradiction->>'type','unknown'),
        coalesce(v_contradiction->>'status','unresolved'),
        coalesce(v_contradiction->'claimGroupIds','[]'::jsonb),
        coalesce(v_contradiction->'evidenceIds','[]'::jsonb),
        coalesce(v_contradiction->'values','[]'::jsonb),
        v_contradiction
      ) on conflict (id) do update set
        status = excluded.status,
        claim_ids = excluded.claim_ids,
        evidence_ids = excluded.evidence_ids,
        values = excluded.values,
        metadata = excluded.metadata;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanRunId', v_run_id,
    'idempotencyKey', v_idempotency,
    'eventsPersisted', v_event_count,
    'evidencePersisted', v_evidence_count,
    'claimsPersisted', v_claim_count
  );
end;
$$;

create or replace view public.pulse_current_feed as
select
  e.id,
  e.canonical_title as title,
  e.summary,
  e.why_it_matters,
  e.interpretation,
  e.action_posture,
  e.classification,
  e.verification_status,
  e.confidence,
  e.materiality,
  e.momentum,
  e.media_tone,
  e.narrative_risk,
  e.lifecycle_status,
  e.primary_entity_id,
  e.entity_ids,
  e.first_seen_at,
  e.last_seen_at,
  e.occurred_at,
  e.published_at,
  e.source_count,
  e.independent_source_count,
  e.tier0_evidence_count,
  e.unsupported_material_claim_count,
  e.contradiction_count,
  e.current_payload
from public.pulse_events e
where e.lifecycle_status not in ('retracted')
order by
  case e.classification when 'Must Know' then 1 when 'Watch' then 2 else 3 end,
  coalesce(e.published_at, e.last_seen_at) desc;

alter table public.pulse_entities enable row level security;
alter table public.pulse_entity_aliases enable row level security;
alter table public.pulse_entity_relationships enable row level security;
alter table public.pulse_sources enable row level security;
alter table public.pulse_scan_runs enable row level security;
alter table public.pulse_source_checks enable row level security;
alter table public.pulse_articles enable row level security;
alter table public.pulse_article_snapshots enable row level security;
alter table public.pulse_events enable row level security;
alter table public.pulse_event_versions enable row level security;
alter table public.pulse_event_articles enable row level security;
alter table public.pulse_evidence enable row level security;
alter table public.pulse_claims enable row level security;
alter table public.pulse_claim_evidence enable row level security;
alter table public.pulse_contradictions enable row level security;
alter table public.pulse_corrections enable row level security;
alter table public.pulse_predictions enable row level security;
alter table public.pulse_briefings enable row level security;
alter table public.pulse_user_interactions enable row level security;
alter table public.pulse_watchlists enable row level security;
alter table public.pulse_watchlist_items enable row level security;
alter table public.pulse_dependability_days enable row level security;
alter table public.pulse_audit_log enable row level security;

-- No anon/authenticated policies are created here. Service-role server APIs bypass RLS.
-- Reader/editor policies must be added only after the organisation chooses its identity and role model.

revoke all on function public.pulse_persist_scan(jsonb) from public, anon, authenticated;
revoke all on function public.pulse_record_correction(jsonb) from public, anon, authenticated;
revoke all on function public.pulse_storage_status() from public, anon, authenticated;
grant execute on function public.pulse_persist_scan(jsonb) to service_role;
grant execute on function public.pulse_record_correction(jsonb) to service_role;
grant execute on function public.pulse_storage_status() to service_role;

grant select on public.pulse_current_feed to service_role;

commit;
