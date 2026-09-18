# T1.1: freshness, source counts and exact data-generation verification

## Scope and release state

This bounded change follows T5.1 on the existing PR #22 review branch. It does not merge main, configure the database, certify statement truth, complete source coverage or establish production/30-day reliability. T1.2 descriptive-status reconciliation and T1.3 integrated release remain separate tasks. No numerical milestone scores are changed.

## Implemented contract

- Source records require explicit UTC timestamps with valid calendar dates. Invalid clocks/configuration, future dates beyond the existing one-minute skew allowance and stale data fail closed.
- Source attempts, successes and individual outcomes must reconcile. Counts must be integers, source identifiers unique and stated item counts/statuses consistent. A successful empty result remains distinct from a failed source. Existing reader/publisher source-success thresholds are not lowered.
- Snapshots retain their existing SHA-256 serialized-payload format; readers now verify the hash rather than just accepting its presence. The identity also contains source commit, run, run attempt, generation time and coverage window.
- Claims carry the validated input-snapshot identity and their own sealed payload. Readers independently enforce both claims age (default 240 minutes) and input generation/coverage age (default 180 minutes). Snapshot freshness remains 90 minutes. Display rounding never extends a limit.
- Raw snapshot/graph readers request uncached data with per-read query identity. API/CDN caching of dynamic freshness verdicts is disabled. This does not make cache headers proof of freshness: the exact-generation verifiers also reject old payloads produced by the same code.
- Both publishers compare locally built, publicly retrieved and API-consumed data identities and content hashes. Claims additionally reconcile the public manifest and raw bytes. Consumer checks compare event bodies and source outcomes after the conservative T5.1 projection. Different workflow attempts cannot share proof merely because their code SHA matches.
- Proof artifacts include the run attempt and capture publication/consumer results separately. A successful publication is not a successful consumer proof. Concurrent publication can cause a strict generation check to fail; it must not silently accept another generation.

## Integrity is not authenticity or factual support

The snapshot format hashes `JSON.stringify` with its own `payloadHash` set to null. This preserves compatibility with existing valid snapshots, including property order; it is not a canonical JSON signature. Preserve original serialized records/hashes when implementing database storage. A hash alone does not authenticate a malicious publisher who can recompute it. Release evidence anchors the expected hash to the exact tested workflow/record. Statement truth and original-reporting independence remain T5 requirements.

The claims API reports the original graph's integrity identity before support-policy projection, filtering or summary-only output. It does not claim that this original hash covers the modified API response bytes. The verifier checks the resulting projection separately.

## Legacy data and T1.3 release coordination

Previously valid signed snapshots remain structurally compatible, subject to stricter count/provenance checks. Old claims without a sealed graph and complete input identity are deliberately rejected, not silently upgraded or backdated. Prepare/regenerate a valid graph during the T1.3 release and prove the exact public graph/consumer generation; retain original records and rollback material. Failure during transition must remain visible. Existing cached/offline browser shells are not remotely certified current by an API-only test.

The snapshot publication step uses a separate worktree so the reviewed source verifier remains available after publishing to live-data. This uses the existing repository/branch and does not create a replacement Vercel project. No production publisher is invoked by the review-branch tests.

## Evidence required before production completion

The deterministic Node and CI browser tests establish implementation behaviour, not deployment. Record exact review commit/tree, test output, adversarial before/after probes and syntax checks. At T1.3, retain timestamped production responses whose generation/hash matches the just-published expected data, plus real browser observations. Repeated unattended refresh, missed-run alerts, production rollback and database restoration remain open acceptance tasks.
