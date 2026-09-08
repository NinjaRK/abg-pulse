# ABG Pulse: objective and execution queue

## Objective

Build a dependable, comprehensive and auditable ABG intelligence platform. In under 60 seconds, a senior user should understand what materially changed across the Aditya Birla Group ecosystem, why it matters, what may become important next, and whether to act, watch or ignore. Every factual claim needs traceable evidence. Missing coverage, uncertainty and operational failures must remain visible.

## Working rule

Complete one testable subtask, retain its evidence, and then take the next. A blocked dependency stays blocked; work may move to the next independent subtask, never mark the blocked task complete. Security and evidence checks apply throughout. Code completion, deployment, current feed operation and long-term dependability are separate states.

The original eight milestone weights remain in `data/build-milestones.json`. This execution order follows dependencies rather than renumbering or inflating that scorecard.

| Order | Task | Work to complete | Acceptance evidence |
|---|---|---|---|
| T1 / M1 | Restore the working live feed | Correct snapshot-to-claims paths; repair publication verification; allow bounded rolling-window lag with an explicit checked-through label; prove deployed scan and claims endpoints; prove scheduled refresh and rollback. | Exact code commit live; real feed and claim graph available; checksum and provenance match; freshness and gaps visible; scheduler and rollback evidence retained. |
| T2 / M4 | Connect persistent evidence storage | Use a separately authorised ABG Pulse database; apply reviewed migrations; ingest real claim/evidence data; prove correction propagation, access boundaries and backup/restore. | Production read-write-read tests, denied unauthorised operations, correction history, successful restore. Isolated PostgreSQL tests alone do not close this task. |
| T3 / M2 | Complete the ABG universe | Reconcile companies, subsidiaries, brands, JVs, promoters, boards and leadership with ownership, aliases and effective dates. | Current primary-source inventory, bidirectional reconciliation and change-detection tests; unresolved entities listed. |
| T4 / M3 | Complete authoritative coverage | Integrate official company, exchange, regulator, court, rating and overseas sources; handle pagination and attachments, permitted use, retries and source-health baselines. | Every priority entity mapped to working direct sources; missed events and source outages visible. |
| T5 / M5 | Improve intelligence quality | Deduplicate events; remove market tips and weak mentions; separate facts and interpretation; calibrate materiality, certainty, momentum, media tone, public sentiment and forecasts. | Blind labelled benchmark with precision/recall and human review; no unsupported material claims; no invented sentiment samples. |
| T6 / M6 | Finish the executive daily journey | Deliver readable mobile briefs, Must Know / Watch / Other, since-last-visit updates, cross-device watchlists, selective alerts, sharing/export and accessibility. | End-to-end browser checks and target-user median briefing time at or below 60 seconds. |
| T7 / M7 | Finish access and governance | Authorised audience, identity/roles, rate limits, secret rotation, editorial approvals, source rights, retention and incident controls. | Security/access tests, accountable owner decisions and operational controls. No restricted data before this gate. |
| T8 / M8 | Earn dependable-service status | Run an independent benchmark for 30 actual operating days after the prerequisites are operational. | 100% critical-event recall, at least 98% high-materiality weighted recall, zero unsupported material claims and zero silent Tier-0 outages across the actual proof period. |

## Current execution record: 8 September 2026

### T1: fixes prepared, release evidence required

- Confirmed the snapshot publisher writes `live-data/live-snapshot.json`, while the claims builder incorrectly requested `live-data/data/live-snapshot.json`.
- Confirmed shell heredoc errors in the post-publication checks. The 09:31 UTC scheduled run did publish a snapshot but failed its verification step.
- Reproduced the rolling-window failure: the public consumer demanded complete coverage through the request time even when a recent snapshot was valid.
- Added integration regressions. Existing test files and milestone scores are unchanged.
- Canonical snapshot path, shell syntax and bounded trailing-lag handling are now covered by tests. Missing historical coverage, stale coverage, invalid settings and implausibly future timestamps remain failures.
- A production verification job checks the exact deployment, live scan, claims, manifest and upstream age using public GET requests only. Its success does not claim the database or the whole product is ready.
- Merge, deployment and scheduled-run outcomes must be attached to the release pull request before closing the corresponding subtasks.

### T2: connection gate blocked

The connected database account currently exposes only a separate application project, not an authorised ABG Pulse database. It was not modified. The deployment-management connection currently returns HTTP 403. Required before production persistence: a separately authorised ABG Pulse database plus permission to set its server-side deployment configuration. No new paid resource or cross-project database reuse is authorised by this plan.

### T3–T8

Existing implementation is retained. These tasks are not newly completed by this feed repair. Once T1's operating checks pass, address T2's connection gate; if it remains blocked, continue independent T3 inventory work while preserving the explicit block.

## Progress accounting

The inherited scorecard reads 55% built and 40% verified. It is a recorded milestone model, not a current certification of readiness. This patch does not increase either percentage. Task closure requires evidence, not a successful build alone.
