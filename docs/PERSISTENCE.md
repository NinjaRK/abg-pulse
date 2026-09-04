# ABG Pulse persistent intelligence

## Why persistence is required

A live-on-demand scan can show the present. It cannot, by itself, provide shared history, cross-device Watching, claim corrections, event evolution, source-health learning, prediction grading or a 30-day dependability proof. Those require one governed system of record.

## Data model

The Supabase/Postgres migration records:

- governed entities, aliases and dated relationships;
- source definitions and immutable source checks;
- scan runs and source-health evidence;
- canonical articles and immutable retrieval snapshots;
- evolving events plus immutable event versions;
- claim-level evidence and contradictions;
- governed correction requests instead of silent rewrites;
- prediction inputs, horizons and outcomes;
- shared watchlists and user interactions;
- daily dependability scores;
- a tamper-evident audit chain.

## Security posture

Row-level security is enabled on every operational table. The migration deliberately creates no anonymous or authenticated-user data policy. Server APIs use the Supabase service role, stored only in Vercel environment variables. Reader/editor/admin policies must be added after ABG chooses the identity provider and role model.

Never commit any of these values:

- `SUPABASE_SERVICE_ROLE_KEY`
- `INGEST_SECRET`
- `EDITOR_SECRET`
- database passwords or connection strings

## Atomic ingestion

`pulse_persist_scan(jsonb)` stores one scan and its source checks, events, evidence, claims and contradictions through one database transaction. An idempotency key prevents retries from creating duplicate scan runs.

The production endpoint is:

- `POST /api/persist`
- bearer authentication with `INGEST_SECRET`
- maximum 100 events and 1,000 source checks per call
- no fallback to browser-local or demonstration state

## Corrections

`POST /api/corrections` records a pending correction. It does not directly edit a published event. An approved correction must create a new event version, update the current event state and leave the original evidence and audit history intact.

## Honest degraded mode

When no database is authorised:

- `/api/storage-status` returns `not_connected`;
- `/api/history` returns HTTP 503;
- the interface remains live-on-demand;
- no cached or demonstration story is presented as shared history.

When credentials exist but the schema is unavailable, storage is reported as degraded rather than silently ignored.

## Activation checklist

1. Create or authorise the production Supabase project.
2. Apply migrations in `db/migrations` in numerical order.
3. Set Vercel production secrets.
4. Seed entities and source definitions.
5. Verify `pulse_storage_status()` reports schema version `6.4.0`.
6. Persist a canary scan twice and confirm the same idempotency key returns one scan run.
7. Confirm evidence, source checks, event versions and audit records reject update/delete.
8. Run backup and restore drills before counting the persistence milestone as complete.

## What this does not prove

A connected database does not prove recall, classification accuracy or source completeness. Those remain separate evidence gates in the Job Meter and 30-day independent benchmark.
