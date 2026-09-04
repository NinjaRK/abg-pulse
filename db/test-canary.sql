\set ON_ERROR_STOP on

insert into public.pulse_entities(id, name, entity_type, status, priority, official_company_entry)
values ('company-1', 'Canary Company Limited', 'company', 'active', 'critical', true)
on conflict (id) do nothing;

insert into public.pulse_sources(id, name, source_type, tier, authority, domain, url, rights_status, cadence, direct, official)
values ('tier0-test', 'Canary exchange filing', 'exchange filing', 'tier0', 'Canary Exchange', 'example.com', 'https://example.com/filing', 'metadata-and-link', 'on-demand', true, true)
on conflict (id) do nothing;

select public.pulse_persist_scan($payload$
{
  "idempotencyKey": "canary-scan-2026-09-03",
  "status": "completed",
  "mode": "canary",
  "windowStart": "2026-09-03T00:00:00.000Z",
  "windowEnd": "2026-09-04T00:00:00.000Z",
  "startedAt": "2026-09-04T00:00:01.000Z",
  "completedAt": "2026-09-04T00:00:02.000Z",
  "commitSha": "canary",
  "serviceVersion": "6.4.0",
  "queryCount": 1,
  "successfulQueries": 1,
  "rawArticleCount": 1,
  "relevantArticleCount": 1,
  "registryReconciled": true,
  "sourceHealth": { "summary": { "tier0Checks": 1, "tier0ExplicitFailures": 0, "tier0SilentFailures": 0 } },
  "sourceChecks": [
    {
      "sourceId": "tier0-test",
      "name": "tier0-test",
      "provider": "Canary Exchange",
      "tier": "tier0",
      "authority": "Canary Exchange",
      "entityId": "company-1",
      "status": "healthy",
      "ok": true,
      "itemCount": 1,
      "durationMs": 12,
      "attempts": 1,
      "schemaValidated": true,
      "emptyIsValid": true,
      "silentFailure": false
    }
  ],
  "events": [
    {
      "id": "event-1",
      "title": "Canary Company announces a ₹1,000 crore investment",
      "summary": "The company disclosed the investment through an official filing.",
      "whyItMatters": "Material capital allocation.",
      "classification": "Must Know",
      "verificationStatus": "confirmed",
      "confidence": 98,
      "materiality": 90,
      "momentum": 50,
      "mediaTone": 5,
      "narrativeRisk": 10,
      "lifecycleStatus": "confirmed",
      "primaryEntityId": "company-1",
      "entityIds": ["company-1"],
      "firstSeenAt": "2026-09-03T10:00:00.000Z",
      "lastSeenAt": "2026-09-03T10:00:00.000Z",
      "occurredAt": "2026-09-03T09:59:00.000Z",
      "publishedAt": "2026-09-03T10:00:00.000Z",
      "evidencePolicy": {
        "unsupportedMaterialClaimCount": 0,
        "mustKnowEligible": true,
        "disputed": false
      },
      "evidenceChain": {
        "chainHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "evidenceHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "evidenceCount": 1,
        "independentSourceCount": 1,
        "tier0EvidenceCount": 1,
        "evidence": [
          {
            "id": "evidence-1",
            "title": "Canary Company announces a ₹1,000 crore investment",
            "description": "Official exchange disclosure.",
            "url": "https://example.com/filing/1",
            "domain": "example.com",
            "publisher": "Canary Exchange",
            "provider": "Canary Exchange direct filing",
            "publishedAt": "2026-09-03T10:00:00.000Z",
            "retrievedAt": "2026-09-03T10:00:01.000Z",
            "tier": "tier0",
            "channel": "official-filing",
            "official": true,
            "rightsStatus": "metadata-and-link",
            "contentFingerprint": "fingerprint-1"
          }
        ],
        "claimGroups": [
          {
            "id": "claim-group-1",
            "canonicalText": "Canary Company announces a ₹1,000 crore investment",
            "topicKey": "canary investment",
            "material": true,
            "supported": true,
            "verification": "confirmed-by-authoritative-source",
            "confidence": 98,
            "numericAnchors": ["1000 crore"],
            "independentSources": ["canary exchange"],
            "evidenceIds": ["evidence-1"]
          }
        ],
        "contradictions": []
      }
    }
  ],
  "metadata": { "canary": true }
}
$payload$::jsonb);

-- The same idempotency key must not create a second scan run.
select public.pulse_persist_scan($payload$
{
  "idempotencyKey": "canary-scan-2026-09-03",
  "status": "completed",
  "mode": "canary",
  "windowStart": "2026-09-03T00:00:00.000Z",
  "windowEnd": "2026-09-04T00:00:00.000Z",
  "queryCount": 0,
  "successfulQueries": 0,
  "sourceChecks": [],
  "events": []
}
$payload$::jsonb);

DO $verify$
declare
  v_count integer;
  v_watchlist uuid;
begin
  select count(*) into v_count from public.pulse_scan_runs where idempotency_key = 'canary-scan-2026-09-03';
  if v_count <> 1 then raise exception 'Expected one idempotent scan run; found %', v_count; end if;

  select count(*) into v_count from public.pulse_source_checks;
  if v_count <> 1 then raise exception 'Expected one immutable source check; found %', v_count; end if;

  select count(*) into v_count from public.pulse_events where id = 'event-1';
  if v_count <> 1 then raise exception 'Expected one event; found %', v_count; end if;

  select count(*) into v_count from public.pulse_event_versions where event_id = 'event-1';
  if v_count <> 1 then raise exception 'Expected one unique event version; found %', v_count; end if;

  select count(*) into v_count from public.pulse_evidence where event_id = 'event-1';
  if v_count <> 1 then raise exception 'Expected one evidence record; found %', v_count; end if;

  select count(*) into v_count from public.pulse_claims where event_id = 'event-1';
  if v_count <> 1 then raise exception 'Expected one claim; found %', v_count; end if;

  select count(*) into v_count from public.pulse_claim_evidence;
  if v_count <> 1 then raise exception 'Expected one claim-evidence relationship; found %', v_count; end if;

  select count(*) into v_count from public.pulse_audit_log;
  if v_count < 2 then raise exception 'Expected audit records; found %', v_count; end if;

  insert into public.pulse_watchlists(name) values ('Canary') returning id into v_watchlist;
  insert into public.pulse_watchlist_items(watchlist_id, entity_id) values (v_watchlist, 'company-1');
  insert into public.pulse_watchlist_items(watchlist_id, event_id) values (v_watchlist, 'event-1');
  select count(*) into v_count from public.pulse_watchlist_items where watchlist_id = v_watchlist;
  if v_count <> 2 then raise exception 'Watchlist must support entity-only and event-only items.'; end if;
end;
$verify$;

select public.pulse_record_correction($correction$
{
  "eventId": "event-1",
  "claimId": "event-1:claim-group-1",
  "type": "clarification",
  "reason": "Canary correction workflow verification",
  "replacementText": "Clarified canary claim",
  "evidenceIds": ["event-1:evidence-1"],
  "requestedBy": "ci"
}
$correction$::jsonb);

select public.pulse_storage_status();
