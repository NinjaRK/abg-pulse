# ABG Pulse dependability instrumentation

## Purpose

ABG Pulse must not call itself dependable because a deployment is green or unit tests pass. Dependability is earned by comparing the production output with an independently assembled reference set over 30 consecutive operating days.

## New operational endpoints

- `/api/coverage` shows configured entity/source/query coverage and every known gap. It explicitly distinguishes a registered domain from a directly monitored source.
- `/api/dependability` shows whether the 30-day proof has started, the current pass streak, days remaining and the acceptance gates.

## Daily evidence capture

The scheduled GitHub Actions workflow captures production health, source coverage, the live scan and dependability status for the preceding UTC day. Every file receives a SHA-256 digest in the artifact manifest. Artifacts are retained for 90 days.

This capture is evidence, not the independent benchmark itself. The independent reference-event set must be assembled through a separate process from the production scanner.

## Release gates

A day passes only when all of these are true:

1. Critical-event recall is 100%.
2. Materiality-weighted recall is at least 98%.
3. Precision is at least 90%.
4. Unsupported material claims equal zero.
5. Silent Tier-0 source outages equal zero.

The product objective is achieved only after 30 consecutive passing days and the remaining entity, source, security, persistence and usability milestones have passed their own gates.

## Fail-closed rules

- Missing reference events are visible as misses.
- Unmatched published events are visible as false positives.
- Material claims without evidence fail the day.
- A reference set not declared independent is rejected.
- The Job Meter cannot call dependability proven with fewer than 30 passing records.
