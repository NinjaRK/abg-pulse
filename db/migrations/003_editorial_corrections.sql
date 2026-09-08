begin;

alter table public.pulse_corrections
  add column if not exists request_id text,
  add column if not exists supersedes_correction_id text;

create unique index if not exists pulse_corrections_request_id_uidx
  on public.pulse_corrections (request_id)
  where request_id is not null;

create index if not exists pulse_corrections_supersedes_idx
  on public.pulse_corrections (supersedes_correction_id)
  where supersedes_correction_id is not null;

create or replace function public.pulse_apply_correction(
  p_claim_id text,
  p_correction_text text,
  p_evidence_ids text[] default '{}',
  p_reason text default 'Correction supplied',
  p_actor text default null,
  p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.pulse_claims%rowtype;
  v_correction_id text;
  v_version integer;
  v_unknown_evidence text[];
  v_existing public.pulse_corrections%rowtype;
  v_previous_correction_id text;
begin
  if nullif(trim(p_claim_id), '') is null then
    raise exception 'claim id is required' using errcode = '22023';
  end if;
  if nullif(trim(p_correction_text), '') is null then
    raise exception 'correction text is required' using errcode = '22023';
  end if;
  if length(p_correction_text) > 10000 then
    raise exception 'correction text exceeds 10000 characters' using errcode = '22023';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'correction actor is required' using errcode = '22023';
  end if;
  if p_request_id is not null and length(p_request_id) > 200 then
    raise exception 'request id exceeds 200 characters' using errcode = '22023';
  end if;

  if p_request_id is not null then
    select * into v_existing
    from public.pulse_corrections
    where request_id = p_request_id;
    if found then
      if v_existing.claim_id <> p_claim_id or v_existing.correction_text <> trim(p_correction_text) then
        raise exception 'request id has already been used for a different correction' using errcode = '23505';
      end if;
      return jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'correctionId', v_existing.id,
        'claimId', v_existing.claim_id,
        'version', v_existing.version,
        'correctedAt', v_existing.corrected_at,
        'actor', v_existing.actor
      );
    end if;
  end if;

  select * into v_claim
  from public.pulse_claims
  where id = p_claim_id
  for update;
  if not found then
    raise exception 'claim not found: %', p_claim_id using errcode = 'P0002';
  end if;
  if v_claim.kind <> 'fact' then
    raise exception 'only factual claims can be corrected' using errcode = '22023';
  end if;

  select array_agg(requested_id order by requested_id)
  into v_unknown_evidence
  from unnest(coalesce(p_evidence_ids, '{}')) requested_id
  where not exists (
    select 1 from public.pulse_evidence e where e.id = requested_id
  );
  if coalesce(array_length(v_unknown_evidence, 1), 0) > 0 then
    raise exception 'unknown correction evidence: %', array_to_string(v_unknown_evidence, ', ') using errcode = '23503';
  end if;

  select max(version), max(id) filter (where id = v_claim.correction_id)
  into v_version, v_previous_correction_id
  from public.pulse_corrections
  where claim_id = p_claim_id;
  v_version := greatest(coalesce(v_version, v_claim.source_event_version, 1), 1) + 1;
  v_previous_correction_id := coalesce(v_claim.correction_id, v_previous_correction_id);
  v_correction_id := md5(
    p_claim_id || '|' || v_version::text || '|' || trim(p_correction_text) || '|' || coalesce(p_request_id, '')
  );

  insert into public.pulse_corrections (
    id, claim_id, previous_text, correction_text, normalized_correction_text,
    evidence_ids, reason, corrected_at, actor, version, graph_run_id,
    request_id, supersedes_correction_id, raw_correction
  ) values (
    v_correction_id,
    p_claim_id,
    case
      when v_previous_correction_id is null then v_claim.text
      else coalesce((select correction_text from public.pulse_corrections where id = v_previous_correction_id), v_claim.text)
    end,
    trim(p_correction_text),
    lower(regexp_replace(trim(p_correction_text), '[^[:alnum:]]+', ' ', 'g')),
    coalesce(p_evidence_ids, '{}'),
    coalesce(nullif(trim(p_reason), ''), 'Correction supplied'),
    now(),
    trim(p_actor),
    v_version,
    v_claim.last_seen_run_id,
    p_request_id,
    v_previous_correction_id,
    jsonb_build_object(
      'claimId', p_claim_id,
      'correctionText', trim(p_correction_text),
      'evidenceIds', coalesce(to_jsonb(p_evidence_ids), '[]'::jsonb),
      'reason', coalesce(nullif(trim(p_reason), ''), 'Correction supplied'),
      'actor', trim(p_actor),
      'requestId', p_request_id,
      'version', v_version,
      'supersedesCorrectionId', v_previous_correction_id
    )
  );

  update public.pulse_claims
  set lifecycle = 'corrected',
      correction_id = v_correction_id,
      last_seen_at = now()
  where id = p_claim_id;

  insert into public.pulse_audit_log (
    actor, action, object_type, object_id, graph_run_id, request_id,
    previous_value, new_value, metadata
  ) values (
    trim(p_actor), 'correct', 'claim', p_claim_id, v_claim.last_seen_run_id, p_request_id,
    jsonb_build_object(
      'text', v_claim.text,
      'lifecycle', v_claim.lifecycle,
      'correctionId', v_claim.correction_id
    ),
    jsonb_build_object(
      'correctionId', v_correction_id,
      'correctionText', trim(p_correction_text),
      'version', v_version,
      'evidenceIds', coalesce(to_jsonb(p_evidence_ids), '[]'::jsonb)
    ),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'Correction supplied'))
  );

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'correctionId', v_correction_id,
    'claimId', p_claim_id,
    'version', v_version,
    'previousText', case
      when v_previous_correction_id is null then v_claim.text
      else coalesce((select correction_text from public.pulse_corrections where id = v_previous_correction_id), v_claim.text)
    end,
    'correctionText', trim(p_correction_text),
    'evidenceIds', coalesce(to_jsonb(p_evidence_ids), '[]'::jsonb),
    'reason', coalesce(nullif(trim(p_reason), ''), 'Correction supplied'),
    'correctedAt', now(),
    'actor', trim(p_actor),
    'supersedesCorrectionId', v_previous_correction_id
  );
end;
$$;

create or replace function public.pulse_get_claim_history(
  p_claim_id text
) returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_claim public.pulse_claims%rowtype;
begin
  select * into v_claim from public.pulse_claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found: %', p_claim_id using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'claim', to_jsonb(v_claim) - 'raw_claim',
    'currentText', coalesce(
      (select c.correction_text from public.pulse_corrections c where c.id = v_claim.correction_id),
      v_claim.text
    ),
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(e) - 'raw_evidence' order by e.published_at nulls last, e.id)
      from public.pulse_claim_evidence ce
      join public.pulse_evidence e on e.id = ce.evidence_id
      where ce.claim_id = p_claim_id
    ), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(to_jsonb(c) - 'raw_correction' order by c.version, c.corrected_at)
      from public.pulse_corrections c
      where c.claim_id = p_claim_id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.occurred_at, a.id)
      from public.pulse_audit_log a
      where a.object_type = 'claim' and a.object_id = p_claim_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pulse_apply_correction(text, text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.pulse_get_claim_history(text) from public, anon, authenticated;
grant execute on function public.pulse_apply_correction(text, text, text[], text, text, text) to service_role;
grant execute on function public.pulse_get_claim_history(text) to service_role;

commit;
