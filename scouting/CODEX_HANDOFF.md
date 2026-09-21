# Collector handoff and acceptance contract

This file is a work handoff inside PR #23, not a second roadmap or a claim that
another agent has accepted a task. Master scope remains issue #19 and T4.1/T4.2.

## Coordination checkpoint, 21 September 2026

Sol remains responsible for implementation, test evidence, integration and release
reporting. A direct Codex review request through this session was blocked before
posting. No Codex task ID, acknowledgement, review or patch has been received.
A ready handoff does not mean work is running in the background.

The collector's pre-date-repair baseline is commit
`948f0cdbc84237fb4626aaa33d16136a9153497c` on
`build/scouting-collector-20260921`. Read the current PR head before editing;
never rewind the branch to this baseline or write concurrently with another agent.

## Read-only review task for Codex when its session is available

Read root AGENTS.md, scouting/README.md, this file, the actual PR diff, and tests.
Review candidate preservation, publication-date provenance/precision, page/feed
conflicts, URL/DNS/redirect boundaries, robots and permission gates, pagination
and result accounting. Report reproducible file/line findings and severity.
Do not push, merge, change permissions or run production writes during review.
State the exact inspected commit and test commands. Do not merely echo PR text.

The source-date selectors were observed in read-only workflow 35568124595:
- Novelis: release-header `article.full-news-article .related-documents-line time.date`.
  A timezone-free datetime is not an instant. The visible day can be retained.
- SEBI: `section.main_section .date_value h5`; RSS may supply `17 Sep, 2026 +0530`.
  An offset accompanying a day does not establish a publication hour.
- UltraTech: the inspected Q1FY24 page did not establish a publication date.
  The quarter-ending date in its body is not a publication date. Leave it unknown.

## Next implementation task after date repair acceptance

Add bounded document extraction in a separately reviewed change. Preserve the
existing network safety and source permission decisions. Initially test using
synthetic or explicitly permitted documents. PDF links alone do not constitute
content extraction. Avoid new dependencies until a maintained parser and its
licence/security requirements are checked; pin approved dependencies.

Completion evidence must include readable PDF, empty/scanned PDF, corrupt file,
non-PDF response, oversized/decompression-heavy document, external attachment
host, access/robots failure and permission-disabled source cases. Retain page
references and permitted evidence only. A scanned or unreadable document stays
pending; no invented content or dates. Use bounded process time/memory and no
execution of document scripts, macros or embedded instructions.

Reconcile discovered URLs with retrieved, duplicate, blocked and pending outcomes.
Compare a fixed, independently enumerated sample with actual collector output;
state sample size and misses. Do not present archive counts as current ABG news.

## Required checks and release boundaries

```
npm test
npm run check
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests/scouting -v
python -m scouting.regression_report
```

Synthetic tests, live source observations and independent acceptance are distinct.
No test deletion/skipping or weakened assertions to obtain success. No automatic
changes to source permissions, main, live-data, Supabase, deployment configuration
or completion percentages. Restricted sources remain restricted. PR23 is not
production-integrated merely because its development workflow passes.

The database authorisation and secure-configuration dependency stays visible but
does not prevent isolated collector work. Final security/editorial acceptance
still requires the owners named in the existing roadmap, not fictional self-review.
