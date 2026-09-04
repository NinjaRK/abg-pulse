-- ABG Pulse material-change notification ledger
-- Requires 001_abg_pulse_core.sql.

begin;

create table if not exists public.pulse_notifications (
  notification_key text primary key,
  event_id text not null references public.pulse_events(id) on delete restrict,
  change_type text not null check (change_type in ('new','material_update','corrected','retracted')),
  score numeric(5,2) not null check (score >= 0 and score <= 100),
  destination text not null default 'webhook',
  status text not null default 'reserved' check (status in ('reserved','sent','failed','suppressed')),
  alert_summary text not null,
  reasons jsonb not null default '[]'::jsonb,
  signals jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  reserved_at timestamptz not null default now(),
  sent_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  delivery_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sent_at is null or sent_at >= reserved_at)
);
create index if not exists pulse_notifications_event_idx on public.pulse_notifications(event_id, reserved_at desc);
create index if not exists pulse_notifications_status_idx on public.pulse_notifications(status, reserved_at) where status in ('reserved','failed');

create trigger pulse_notifications_updated_at
before update on public.pulse_notifications
for each row execute function public.pulse_set_updated_at();

create trigger pulse_notifications_audit
after insert or update or delete on public.pulse_notifications
for each row execute function public.pulse_audit_trigger();

alter table public.pulse_notifications enable row level security;

create or replace function public.pulse_reserve_notifications(p_changes jsonb, p_destination text default 'webhook')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_change jsonb;
  v_inserted_key text;
  v_reserved jsonb := '[]'::jsonb;
  v_event_id text;
begin
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'changes_must_be_array';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    if coalesce((v_change->>'notificationEligible')::boolean, false) is not true then
      continue;
    end if;
    v_event_id := coalesce(v_change->>'eventId', v_change#>>'{event,id}');
    if coalesce(v_event_id, '') = '' or coalesce(v_change->>'notificationKey', '') = '' then
      raise exception 'eligible_change_missing_event_or_notification_key';
    end if;

    v_inserted_key := null;
    insert into public.pulse_notifications(
      notification_key, event_id, change_type, score, destination, status,
      alert_summary, reasons, signals, payload
    ) values (
      v_change->>'notificationKey',
      v_event_id,
      coalesce(v_change->>'type', 'material_update'),
      coalesce((v_change->>'score')::numeric, 0),
      coalesce(nullif(p_destination, ''), 'webhook'),
      'reserved',
      coalesce(nullif(v_change->>'alertSummary', ''), coalesce(v_change#>>'{event,title}', 'Material ABG development')),
      coalesce(v_change->'reasons', '[]'::jsonb),
      coalesce(v_change->'signals', '[]'::jsonb),
      v_change
    ) on conflict (notification_key) do nothing
    returning notification_key into v_inserted_key;

    if v_inserted_key is not null then
      v_reserved := v_reserved || jsonb_build_array(jsonb_build_object(
        'notificationKey', v_inserted_key,
        'eventId', v_event_id,
        'status', 'reserved',
        'destination', coalesce(nullif(p_destination, ''), 'webhook'),
        'alertSummary', coalesce(nullif(v_change->>'alertSummary', ''), coalesce(v_change#>>'{event,title}', 'Material ABG development')),
        'change', v_change
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'submitted', jsonb_array_length(p_changes),
    'reserved', jsonb_array_length(v_reserved),
    'duplicatesSuppressed', jsonb_array_length(p_changes) - jsonb_array_length(v_reserved),
    'notifications', v_reserved
  );
end;
$$;

create or replace function public.pulse_mark_notification(
  p_notification_key text,
  p_status text,
  p_response jsonb default null,
  p_error text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.pulse_notifications%rowtype;
begin
  if p_status not in ('sent','failed','suppressed') then
    raise exception 'invalid_notification_status';
  end if;
  update public.pulse_notifications set
    status = p_status,
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
    last_error = case when p_status = 'failed' then nullif(p_error, '') else null end,
    delivery_response = p_response
  where notification_key = p_notification_key
  returning * into v_row;
  if not found then raise exception 'notification_not_found'; end if;
  return jsonb_build_object(
    'ok', true,
    'notificationKey', v_row.notification_key,
    'status', v_row.status,
    'attemptCount', v_row.attempt_count,
    'sentAt', v_row.sent_at,
    'lastError', v_row.last_error
  );
end;
$$;

create or replace function public.pulse_recent_notification_keys(p_limit integer default 1000)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(notification_key order by reserved_at desc), '[]'::jsonb)
  from (
    select notification_key, reserved_at
    from public.pulse_notifications
    order by reserved_at desc
    limit greatest(1, least(coalesce(p_limit, 1000), 5000))
  ) recent;
$$;

create or replace function public.pulse_storage_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'schemaVersion', '6.5.0',
    'entities', (select count(*) from public.pulse_entities),
    'sources', (select count(*) from public.pulse_sources),
    'events', (select count(*) from public.pulse_events),
    'claims', (select count(*) from public.pulse_claims),
    'evidence', (select count(*) from public.pulse_evidence),
    'scanRuns', (select count(*) from public.pulse_scan_runs),
    'latestScanAt', (select max(completed_at) from public.pulse_scan_runs),
    'openContradictions', (select count(*) from public.pulse_contradictions where status = 'unresolved'),
    'pendingCorrections', (select count(*) from public.pulse_corrections where status = 'pending'),
    'notificationReserved', (select count(*) from public.pulse_notifications where status = 'reserved'),
    'notificationFailed', (select count(*) from public.pulse_notifications where status = 'failed'),
    'notificationSent', (select count(*) from public.pulse_notifications where status = 'sent'),
    'dependabilityDays', (select count(*) from public.pulse_dependability_days where status in ('pass','fail')),
    'auditHead', (select entry_hash from public.pulse_audit_log order by id desc limit 1)
  );
$$;

revoke all on function public.pulse_reserve_notifications(jsonb, text) from public, anon, authenticated;
revoke all on function public.pulse_mark_notification(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.pulse_recent_notification_keys(integer) from public, anon, authenticated;
grant execute on function public.pulse_reserve_notifications(jsonb, text) to service_role;
grant execute on function public.pulse_mark_notification(text, text, jsonb, text) to service_role;
grant execute on function public.pulse_recent_notification_keys(integer) to service_role;

commit;
