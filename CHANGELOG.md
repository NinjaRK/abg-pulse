# v5.0.0

- Added evidence-weighted 12-milestone Job Meter.
- Added always-visible sidebar progress and detailed Control Room milestone view.
- Added explicit resource-readiness and external-dependency register.
- Added `/api/progress` and progress-governance tests.
- Current verified objective completion: 37%.

# Changelog

## 0.3.0 — 31 August 2026

- Added user-controlled periods: Since last visit, 1 hour, 6 hours, 24 hours, Today, 7 days, 30 days and custom start/end times in IST.
- Recalculated Must Know, Watch, Other, Watching, Radar, sentiment, forecasts, Ask and Search for the selected window.
- Added an exact, visible coverage window and remembered the user’s last period selection.
- Added optional comparison with the immediately preceding equal-duration period.
- Added transparent coverage proof: evidence domains, governed source registry, source classes, successful automated checks and degraded checks.
- Added period-bounded GDELT and Google News discovery and a transparent 30-day live-scan cap for long custom windows.
- Added period regression tests and browser interaction QA for period switching, comparison and source coverage.
- Expanded the automated suite to 30 passing tests and refreshed desktop, mobile and Radar QA evidence.

## 0.2.0 — 31 August 2026

- Added governed direct monitoring for eight official ABG/company newsroom and investor-relations pages.
- Added Google News RSS as an independent safety net alongside GDELT.
- Expanded discovery to ten ABG entity/topic query groups.
- Added freshness gates to prevent stale or implausibly future items from appearing as live news.
- Removed unsupported “independent corroboration” language from headline-derived signals.
- Added new-since-last-visit handling and provider-health visibility.
- Added two current 31 August intelligence records and recency-filtered the Today briefing.
- Replaced the n8n workflow with one governed scan-to-ingest pipeline.
- Fixed Supabase ingestion to write schema-complete event rows.
- Hardened official-source date extraction against cross-card date leakage.
- Fixed restricted-storage initialization in QA/private browsing contexts.
- Expanded automated coverage to 26 passing tests.
