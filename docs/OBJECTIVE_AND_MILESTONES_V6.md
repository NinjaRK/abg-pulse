# ABG Pulse v6 — Objective, Remaining Milestones and Job Meter

## Objective

Build ABG Pulse into a dependable, comprehensive and auditable ABG intelligence platform that lets an authorised senior user understand, in under 60 seconds, what materially changed across Aditya Birla Group, its promoter family, companies, subsidiaries, brands and senior leaders; why it matters; what may become important next; and whether to act, prepare, watch or ignore—using fresh, deduplicated and evidence-backed information, without depending on Gmail or Outlook.

## Job Meter

The primary meter counts only independently verified completion against the full objective.

- Verified complete: **40%**
- Built but awaiting live or independent verification: **8%**
- Remaining to verify: **60%**
- The built-but-unverified share remains inside the 60% until its acceptance gate passes.

The meter is calculated from weighted milestones. A coded feature does not become complete merely because it exists; live operation, accuracy, source coverage and elapsed proof are counted where the objective requires them.

## Remaining milestones

### 1. Restore production release reliability

Remove the Vercel project/account deployment block, prove the exact Git commit is live, and add observable rollback and recovery evidence.

**Pass gate:** homepage and all critical APIs pass exact-commit verification; deployment, error and rollback evidence are retained.

### 2. Activate governed scheduled capture and persistence

Replace per-visitor source fan-out with scheduled reusable snapshots, then connect the production database and orchestration layer.

**Pass gate:** scheduled refreshes, retries, shared history, idempotency, queue replay and backup restore are operational.

### 3. Complete direct authoritative-source ingestion

Finish direct SEC, NSE, BSE and regulator adapters, then add courts, rating agencies and all priority company disclosure endpoints.

**Pass gate:** Tier-0 sources are directly ingested, attachment-aware, paginated, health-checked and covered by deterministic tests.

### 4. Complete the ABG entity and source graph

Add statutory subsidiaries, JV ownership, boards, subsidiary CEOs/CFOs, international leaders, aliases, role history, jurisdictions and effective dates; map each priority entity to its source coverage.

**Pass gate:** no material entity or role change can occur without being discoverable and auditably mapped.

### 5. Operationalise claim-level evidence and corrections

Populate raw records, claims, evidence links, contradictions, corrections and retractions during live ingestion.

**Pass gate:** every factual statement can be reconstructed and every correction propagates to cards, alerts, briefings and answers.

### 6. Prove relevance, entity resolution and event lifecycle

Add semantic and claim-level clustering, publisher-origin lineage, cross-language matching, confidence scores and blind hard-negative tests.

**Pass gate:** false matches, false merges and duplicate leakage meet defined thresholds on an independent corpus.

### 7. Calibrate decision intelligence

Calibrate materiality, media tone, observed public sentiment, trends, narrative drift and 6/24/72-hour forecasts against labelled historical and live outcomes.

**Pass gate:** each score is entity-specific, sample-aware, transparent and demonstrably calibrated; unsupported precision is removed.

### 8. Finish world-class daily use

Reduce card density, add role-specific briefs, cross-device Watching, accessible mobile interaction, selective alerts and repeat-use measurement.

**Pass gate:** target senior users complete the briefing in 60 seconds or less with strong comprehension and trust.

### 9. Add security and operating governance

Implement rate limits, secure ingestion, SSO/RBAC, editorial roles, critical-alert approvals, retention and rights controls.

**Pass gate:** security, permissions and editorial intervention pass independent tests.

### 10. Earn the 30-day dependability standard

Run an independent reference-set comparison every day and turn every miss, unsupported claim, false alert or silent source failure into a permanent regression test.

**Pass gate:** 30 consecutive days with 100% critical-event recall, at least 98% high-event weighted recall, zero unsupported material claims and zero silent Tier-0 outages.

## Critical path

1. Production release reliability
2. Governed scheduled capture and persistence
3. Direct authoritative ingestion
4. Claim-level evidence and corrections
5. Independent 30-day dependability benchmark

## Operating rule

The Job Meter may move only when the named acceptance evidence exists. External dependencies and elapsed time remain visible and remain inside the denominator.
