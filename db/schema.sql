-- ABG Pulse — production-oriented PostgreSQL/Supabase schema
-- Run in a fresh Supabase project. Service-role access is used by server-side API routes.

create extension if not exists pgcrypto;

create type public.entity_type as enum (
  'group','company','subsidiary','business','brand','product','person','stakeholder','initiative','geography','industry'
);
create type public.source_class as enum (
  'official','exchange','regulator','court','rating','major_media','specialist_media','regional','international','social_official','discovery','signal'
);
create type public.event_bucket as enum ('must','watch','other');
create type public.verification_status as enum ('confirmed','strong','developing','corrected','retracted');
create type public.event_lifecycle as enum ('emerging','developing','confirmed','updated','corrected','retracted','closed');
create type public.claim_type as enum ('fact','interpretation','forecast');

create table public.entities (
  id text primary key,
  name text not null,
  entity_type public.entity_type not null,
  priority_tier smallint not null default 3 check (priority_tier between 0 and 5),
  official_url text,
  active boolean not null default true,
  effective_from date,
  effective_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entity_aliases (
  id bigint generated always as identity primary key,
  entity_id text not null references public.entities(id) on delete cascade,
  alias text not null,
  language_code text not null default 'en',
  ambiguity_notes text,
  active boolean not null default true,
  unique (entity_id, alias, language_code)
);
create index entity_aliases_alias_idx on public.entity_aliases using gin (to_tsvector('simple', alias));

create table public.entity_relationships (
  id bigint generated always as identity primary key,
  from_entity_id text not null references public.entities(id) on delete cascade,
  to_entity_id text not null references public.entities(id) on delete cascade,
  relationship_type text not null,
  effective_from date,
  effective_to date,
  evidence_url text,
  metadata jsonb not null default '{}'::jsonb,
  unique (from_entity_id, to_entity_id, relationship_type, effective_from)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  name text not null,
  source_class public.source_class not null,
  evidence_tier smallint not null check (evidence_tier between 0 and 4),
  language_codes text[] not null default array['en']::text[],
  geographies text[] not null default '{}'::text[],
  rights_classification text not null,
  fetch_policy text not null default 'metadata-only',
  active boolean not null default true,
  last_reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_health (
  id bigint generated always as identity primary key,
  source_id uuid not null references public.sources(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('healthy','degraded','failed','unknown')),
  response_ms integer,
  item_count integer,
  anomaly_score numeric(6,3),
  error_code text,
  notes text
);
create index source_health_source_time_idx on public.source_health(source_id, checked_at desc);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  query_count integer not null default 0,
  raw_item_count integer not null default 0,
  accepted_item_count integer not null default 0,
  event_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  cost_estimate numeric(12,4),
  metadata jsonb not null default '{}'::jsonb
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  source_id uuid references public.sources(id),
  title text not null,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  language_code text,
  source_country text,
  accessible_content_status text not null default 'metadata-only',
  content_hash text,
  syndication_lineage text,
  raw_metadata jsonb not null default '{}'::jsonb,
  ingestion_run_id uuid references public.ingestion_runs(id),
  created_at timestamptz not null default now()
);
create index articles_published_idx on public.articles(published_at desc);
create index articles_title_search_idx on public.articles using gin (to_tsvector('english', title));

create table public.events (
  id text primary key,
  headline text not null,
  bucket public.event_bucket not null,
  status public.verification_status not null,
  lifecycle public.event_lifecycle not null default 'emerging',
  category text not null default 'Corporate',
  summary text not null,
  why_it_matters text,
  materiality_score smallint check (materiality_score between 0 and 100),
  certainty_score smallint check (certainty_score between 0 and 100),
  momentum_score smallint check (momentum_score between 0 and 100),
  sentiment_score smallint check (sentiment_score between -100 and 100), -- retained as media tone for backwards compatibility
  media_tone_score smallint check (media_tone_score between -100 and 100),
  public_sentiment_score smallint check (public_sentiment_score between -100 and 100),
  public_sentiment_sample_size integer not null default 0 check (public_sentiment_sample_size >= 0),
  public_sentiment_channel_count integer not null default 0 check (public_sentiment_channel_count >= 0),
  public_sentiment_confidence text not null default 'unavailable' check (public_sentiment_confidence in ('unavailable','low','medium','high')),
  reputation_impact_score smallint check (reputation_impact_score between -100 and 100),
  narrative_alignment_score smallint check (narrative_alignment_score between 0 and 100),
  source_count integer not null default 0,
  first_reported_at timestamptz,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  is_published boolean not null default false,
  payload jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index events_published_idx on public.events(is_published, bucket, published_at desc);
create index events_payload_idx on public.events using gin(payload);
create index events_headline_search_idx on public.events using gin(to_tsvector('english', headline));

create table public.event_articles (
  event_id text not null references public.events(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  relationship text not null default 'reports' check (relationship in ('reports','updates','corrects','retracts','context')),
  independent_source boolean not null default true,
  added_at timestamptz not null default now(),
  primary key (event_id, article_id)
);

create table public.event_entities (
  event_id text not null references public.events(id) on delete cascade,
  entity_id text not null references public.entities(id) on delete cascade,
  role text not null default 'subject',
  confidence numeric(5,4) not null default 1.0 check (confidence between 0 and 1),
  primary key (event_id, entity_id, role)
);

create table public.public_conversation_observations (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  source_url text not null,
  platform text not null,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  tone_score smallint check (tone_score between -100 and 100),
  engagement_count integer check (engagement_count is null or engagement_count >= 0),
  language_code text,
  accessible_publicly boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  unique (event_id, source_url)
);
create index public_conversation_event_idx on public.public_conversation_observations(event_id, observed_at desc);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  claim_text text not null,
  claim_type public.claim_type not null default 'fact',
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active','disputed','corrected','withdrawn')),
  supersedes_claim_id uuid references public.claims(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index claims_event_idx on public.claims(event_id, claim_type);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  source_url text not null,
  source_tier smallint not null check (source_tier between 0 and 4),
  evidence_excerpt text,
  excerpt_location text,
  supports boolean not null default true,
  independent_lineage boolean not null default true,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index evidence_claim_idx on public.evidence(claim_id);

create table public.narratives (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  verified_frame text not null,
  emerging_frame text not null,
  drift_score smallint not null check (drift_score between 0 and 100),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  misattribution_risk boolean not null default false,
  recommended_posture text,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  generated_at timestamptz not null default now(),
  horizon_hours integer not null check (horizon_hours in (6,24,72)),
  probability smallint not null check (probability between 0 and 100),
  predicted_bucket public.event_bucket,
  recommended_posture text,
  model_version text not null,
  drivers jsonb not null default '[]'::jsonb,
  outcome text check (outcome in ('hit','false_alarm','miss','pending')) default 'pending',
  graded_at timestamptz,
  calibration_notes text
);
create index predictions_pending_idx on public.predictions(outcome, generated_at);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  correction_type text not null,
  previous_payload jsonb not null,
  corrected_payload jsonb not null,
  reason text not null,
  propagated_to jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by text
);

create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  event_id text references public.events(id) on delete set null,
  user_id uuid,
  feedback_type text not null,
  comment text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  object_type text not null,
  object_id text,
  before_state jsonb,
  after_state jsonb,
  model_or_rule_version text,
  evidence_refs jsonb not null default '[]'::jsonb
);
create index audit_log_object_idx on public.audit_log(object_type, object_id, occurred_at desc);

-- Keep updated_at deterministic.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger entities_set_updated_at before update on public.entities
for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before update on public.sources
for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();
create trigger claims_set_updated_at before update on public.claims
for each row execute function public.set_updated_at();

-- RLS: all intelligence remains private by default. The server API uses the service role.
alter table public.entities enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.entity_relationships enable row level security;
alter table public.sources enable row level security;
alter table public.source_health enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.articles enable row level security;
alter table public.events enable row level security;
alter table public.event_articles enable row level security;
alter table public.event_entities enable row level security;
alter table public.public_conversation_observations enable row level security;
alter table public.claims enable row level security;
alter table public.evidence enable row level security;
alter table public.narratives enable row level security;
alter table public.predictions enable row level security;
alter table public.corrections enable row level security;
alter table public.user_feedback enable row level security;
alter table public.audit_log enable row level security;

-- Add authenticated read policies only when SSO/private user authentication is connected.
-- No anon policy is intentionally created.
