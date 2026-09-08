begin;

create or replace function public.pulse_persistence_health()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with latest_run as (
    select id, generated_at, source_commit, manifest_sha256, ingested_at,
           event_count, claim_count, evidence_count,
           unsupported_material_claim_count, potential_contradiction_count
    from public.pulse_claim_graph_runs
    order by ingested_at desc
    limit 1
  ), counts as (
    select
      (select count(*) from public.pulse_claim_graph_runs) as graph_runs,
      (select count(*) from public.pulse_events) as events,
      (select count(*) from public.pulse_claims) as claims,
      (select count(*) from public.pulse_evidence) as evidence,
      (select count(*) from public.pulse_corrections) as corrections,
      (select count(*) from public.pulse_contradictions where status <> 'resolved') as open_contradictions,
      (select count(*) from public.pulse_audit_log) as audit_entries
  ), rls as (
    select jsonb_object_agg(c.relname, c.relrowsecurity order by c.relname) as tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'pulse_claim_graph_runs','pulse_events','pulse_evidence','pulse_claims',
        'pulse_claim_evidence','pulse_corrections','pulse_contradictions','pulse_audit_log'
      )
  )
  select jsonb_build_object(
    'ok', true,
    'schemaVersion', '1.0.0',
    'checkedAt', now(),
    'latestRun', coalesce((select to_jsonb(latest_run) from latest_run), 'null'::jsonb),
    'counts', (select to_jsonb(counts) from counts),
    'rls', coalesce((select tables from rls), '{}'::jsonb),
    'quality', jsonb_build_object(
      'hasIngestedGraph', exists(select 1 from latest_run),
      'latestRunHasNoUnsupportedMaterialClaims', coalesce((select unsupported_material_claim_count = 0 from latest_run), false),
      'auditTrailPresent', (select audit_entries > 0 from counts)
    )
  );
$$;

revoke all on function public.pulse_persistence_health() from public, anon, authenticated;
grant execute on function public.pulse_persistence_health() to service_role;

commit;
