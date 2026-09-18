# T1.2: dated progress descriptions, unchanged scores

This is the descriptive-status reconciliation in roadmap #19. It is not a new milestone, progress increase or runtime certification.

## Status represented by this change

| Evidence class | Recorded fact | Limit |
|---|---|---|
| Production observation | 17 September 2026, 08:48:54 UTC; code `17d669f` served basic homepage/news/claims endpoints. | Database was unconfigured; this is a historical observation, not a new probe. |
| Safeguard implementation | PR #22 candidate `9ec41de` passed 412 software tests, 13 QA browser checks and isolated PostgreSQL CI. | Source is tested; combined production/data-generation acceptance remains open. |
| Roadmap handoff | T5.1 and T1.1 implementation precede T1.2 metadata reconciliation; next release gate is T1.3. | After that gate passes, continue T2.1 inspection of the existing intended database. |
| Original scores | M1-M8 IDs, weights, parent states, verified/build scores and quantitative acceptance gates remain unchanged. | The 4 September score model is not a current service-readiness certification. |

## Corrected descriptions

The current programme names the M1/M5 safeguard work instead of the superseded M1/M3 source sprint. The old Vercel release block is recorded as resolved through the existing Git route; the closed reconnection/resumption action is no longer an unresolved dependency. Project-management connector visibility is separate from deployment evidence.

Database access and operation remain unverified for Personal / ABG Pulse Production, `kzqymboxilxvdgacwypy`. No new project, unrelated database or new orchestrator is required by this update. Source coverage remains incomplete; reviewers and a maintainer remain unassigned. Minimum security/rights decisions precede private data, and the 30-day qualifying window follows integrated acceptance.

`data/build-milestones.json` remains the shared API/UI description source. Its `programme.evidenceCheckpoint` distinguishes description date, historical production observation and tested candidate evidence. The existing sprint panel displays the retained-score caveat. No separate competing status database is introduced.

## Verification requirements

Twelve new Node regressions cover immutable scores/weights, retained acceptance targets, active-task consistency, removed obsolete instructions, correct database target, exclusion of the closed Vercel dependency, dated evidence and the release-first handoff. One existing test's expected active IDs changes from M1/M3 to M1/M5; its score and milestone assertions remain intact. A browser check verifies the actual rendered descriptions and unchanged 40%/55% displays.

The final-head CI outcome, exact reviewed source tree and any production release evidence belong in PR #22 and the checkpoint comment on issue #19. A description edit does not cause the claims reader, source pipeline, production database or independent review to pass.

## T1.3 release boundary

Preserve the previously deployed source/data before release. Generate the compatible graph from real, fresh source input, keep original evidence dates, and verify exact expected/published/consumed generation identities. A hash is an integrity check, not authentication or factual truth. Do not merge merely to replace known old data with a deliberate validation error; establish a safe publication/deployment sequence and retain failure evidence.

No production database writes, credential changes or new paid resources are part of T1.2. The full T1/T5 milestones and overall product remain open after this metadata task.
