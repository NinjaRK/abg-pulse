# T5.1: source attachment is not statement verification

This is the first repair in execution roadmap v1.0, not completion of milestone T5.

## Contract

All factual assertions in the current metadata-only pipeline remain provisional when a traceable source URL is attached. No source produces a factual-verification upgrade based on its official flag, tier, number of domains, supplied approval flag or heuristic score. Assertions without a usable source remain unsupported, and the delivery projection rejects untraceable factual assertions. Full source-passage verification is T5.3 and is not implemented here.

`supportConfidence` is null. `independentEvidenceCount` is null where evidence exists because original-reporting independence has not been established; it is zero when no evidence exists. `sourceDomainCount` measures breadth only. Existing original-report URL and wire-service hints are retained, not treated as independently authenticated reporting lineage. Multiple domains may syndicate one story.

`supportPolicy: source-metadata-only-v1` and `statementVerification: not_performed` identify the output. Source URLs must be HTTP(S) and contain no embedded credentials. Attached evidence must belong to the same event. An inbound claim of verification cannot opt out of the policy.

## Legacy records and presentation

The claims API applies a non-mutating conservative projection to previously generated graphs before filters and summaries. It does not alter their raw archived bytes, timestamps or provenance. It recalculates exposed support totals, removes untrusted approval fields, and never replays a legacy numerical confidence value. Its responses use no-store rather than caching old classifications.

Public scan and stored-event responses replace heuristic confirmation with developing and expose no numerical certainty. The card and detail views show unverified/source-linked labels and statement-check-pending notices even for cached legacy events. The service-worker shell cache version changes and includes the shared support module so updated labels are installed together. Existing open/offline browser tabs are not claimed remotely upgraded until their shell update is observed.

Internal materiality/ranking calculations and forecast outputs are not calibrated or independently accepted by this repair. Forecast evaluation remains T5.4. No stored database rows are changed. Correction history and the independent-review requirements remain intact.

## Verification

On the byte-identical source tree for baseline commit 17d669f, all 299 previous Node tests passed. Four isolated safety probes then reproduced the unsafe behaviour: unrelated official metadata, different domains repeating one wire report, overconfident legacy API output, and numeric certainty rendered in cards/details. The same four probes pass on the repair.

There are 35 new Node regressions, for 334 total passing local tests. Three older test cases in claim-evidence.test.mjs intentionally had their expectations corrected: official metadata now stays provisional with null confidence, no-source confidence is null, and support summaries no longer count metadata-only assertions as verified. No test case was deleted, skipped or marked expected-failure. Unrelated original test files and the numerical milestone scorecard remain unchanged.

The browser journey gains two focused checks for legacy labels and the evidence-dialog notice. Local browser navigation was blocked by administrator policy; that policy was not changed. Browser acceptance must be run through the existing authorised CI workflow and its result recorded separately. Fixture tests do not count as production acceptance.

## Release boundary

T5.1 is implemented for review. T1.1 freshness/integrity and T1.2 descriptive status reconciliation are next in the same safeguard stage. The combined T1.3 release still needs exact deployed-code/data verification. No completion percentage or full-product readiness is claimed from this task, and no account reconnection or new infrastructure is required for the known code repairs.
