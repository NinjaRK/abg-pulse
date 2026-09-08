# Installation and current-period delivery repair — 8 September 2026

## Reproduced failure
At source 7011eb6f09ae65d5085ff90b87df3ea62e59d946, GitHub Actions run 34203145692 proved that npm install overwrote api/health.js, api/progress.js, api/scan.js and data/build-milestones.json. The archived bootstrap executed during postinstall. The original source also had three failing claim-projection tests because an absent search term became the literal string "null".

## Changes
- bootstrap.mjs is a read-only validator. It never unpacks runtime archives, patches code, or writes source.
- Existing entry-point and registry files must be present and well formed; missing source is a visible error.
- CI now runs the real installation lifecycle and fails on tracked-source changes.
- Claim search treats a missing, null, empty or whitespace query as no text filter.
- A fresh scheduled snapshot may serve the observed part of a current period; the unchecked tail and actual coverage end remain explicit. Strict callers, missing history, wholly unobserved periods, future periods and stale snapshots remain fail-closed.
- The interface preserves server-reported coverage times and labels the checked-through time rather than claiming a new live scan on each page refresh.
- The production Job Meter check validates weights and evidence instead of requiring the obsolete twelve-milestone layout.

## Evidence and boundaries
Local full regression: 169 tests passed, 0 failed; syntax and governed-data validation passed. Running the real npm install lifecycle left source hashes unchanged. Eight focused install tests and six claim/snapshot tests were added. Remote CI and the exact-commit deployment still require their own verification; these local results do not prove production availability, full coverage or the thirty-day benchmark.

The milestone percentages are unchanged. No external account, database, paid service or n8n instance has been provisioned by this change.
