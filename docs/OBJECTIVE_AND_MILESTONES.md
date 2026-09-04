# ABG Pulse — objective, milestones and Job Meter

## Objective

Build ABG Pulse into a **dependable, comprehensive and auditable ABG intelligence platform** that lets a senior user understand, in under 60 seconds:

- what materially changed across the Aditya Birla Group ecosystem;
- why it matters;
- what may become important next; and
- whether to act, watch or ignore.

Every factual claim must be traceable to evidence. Every source failure, coverage gap and unproven score must remain visible.

## Progress meter

ABG Pulse uses two weighted numbers so activity is never confused with achievement:

| Measure | Meaning | Current |
|---|---|---:|
| Verified complete | Acceptance evidence exists | 40% |
| Built | Code or operating capability is implemented and tested | 55% |
| Built, awaiting proof | Implemented but not yet live or independently proven | 15% |
| Not yet built | Remaining implementation work | 45% |
| Remaining to verify | Work still required before the objective can be declared achieved | 60% |

The milestone weights total 100%. The verified number is the product truth. The built number shows momentum, not delivery.

## Remaining milestones

| ID | Milestone | Weight | Verified | Built | Pass gate |
|---|---|---:|---:|---:|---|
| M1 | Stable production and governed ingestion | 15% | 50% | 75% | Exact commit live; scheduled reusable snapshot; no source fan-out on user refresh; visible freshness; rollback proven |
| M2 | Complete ABG entity and stakeholder graph | 12% | 70% | 75% | Statutory subsidiaries, brands, boards, leaders, relationships, jurisdictions and effective dates reconciled |
| M3 | Direct authoritative source coverage | 15% | 30% | 45% | Tier-0 company, exchange, regulator, court, rating and overseas filing adapters operational |
| M4 | Persistent evidence, corrections and audit | 15% | 25% | 45% | Production database stores raw records, claims, evidence, contradictions, corrections, history and user state |
| M5 | Precision and decision-grade intelligence | 16% | 45% | 65% | Blind benchmarks prove precision/recall; scores are calibrated, entity-specific and multilingual where needed |
| M6 | World-class executive daily-use experience | 10% | 80% | 85% | Median briefing ≤60 seconds; role-specific briefs, cross-device Watching, alerts, share/export and accessibility pass |
| M7 | Security, access, rights and governance | 7% | 10% | 20% | SSO/RBAC, rate limits, rights enforcement, editorial permissions, retention and security testing pass |
| M8 | Thirty-day independent dependability proof | 10% | 0% | 5% | 30 live days: 100% critical-event recall, ≥98% high-materiality weighted recall, zero unsupported material claims and zero silent Tier-0 outages |

## Active sprint

**Stable ingestion and authoritative-source foundation**

1. Replace expensive 65-source scans on every visitor refresh with a governed reusable snapshot.
2. Expose snapshot age, source health, source commit and workflow provenance.
3. Complete the first direct-source wave for SEC, NSE, BSE and core regulators.
4. Show verified progress and built-but-unproven progress separately in the product.

## Build discipline

- No milestone moves without evidence.
- A passing unit test does not prove live dependability.
- A live endpoint does not prove comprehensive coverage.
- A score is not decision-grade until calibrated against real outcomes.
- Vercel, database, identity and licensed-data dependencies remain visible and are requested only at their actual release gates.
