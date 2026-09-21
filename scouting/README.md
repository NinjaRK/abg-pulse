# T4.1 / T4.2: bounded source-scouting collector

This is an additive candidate collector. It does not replace the production
`official.mjs` / `api/scan.js` path yet, does not publish news, and does not
write a production database. Full milestone acceptance remains open.

## Run

Python 3.11+ standard library only. No packages, API keys or credentials.

```
python -m unittest discover -s tests/scouting -v
python -m scouting.run_probe --output /tmp/abg-scouting-proof
```

The probe allows at most two listing/feed/index fetches and two article-detail
attempts per permitted source, plus robots checks. Pending URLs remain in the
report. Resource bounds are not disguised as complete archive coverage.

## What is implemented

- A machine-readable register of all 71 researched targets, with unchanged IDs,
  access findings and rights gates. All production-enabled flags remain false.
- Per-entity alias batches generated from the canonical inventory. These are
  unexecuted query drafts, not a paid search service or freshly verified roles.
- HTML candidate discovery, RSS/Atom and SEC submissions/index adapters.
- Undated listing links are retained for detail inspection; generic Download
  links are retained as document candidates. Meaningful query IDs and ordering
  survive canonicalisation. No hidden 30-item limit on a retrieved page.
- Explicit next-page traversal, loop protection and a pending page/detail queue.
- Article metadata extraction, publication versus modified dates and content
  hashes. A body count is diagnostic, not proof of full text or factual accuracy.
- Credential-free HTTPS to exact approved hosts, public-IP DNS pinning, bounded
  downloads/timeouts, no environment proxy/cookies, per-host pacing and robots
  checks. Redirects re-enter the same checks. Robots failure blocks collection;
  it does not authorise bypass. The small robots parser is not claimed to be
  certified against every RFC case.

## Deliberate boundaries

ABFRL and ABLBL terms inspected on 21 September require written permission for
use. Their automated probes are disabled, as are licence-dependent services and
unconfigured independent/regional publishers. Being listed is not consent.

The permitted probe mode is a one-time, low-volume public-metadata observation,
not a commercial reuse licence. Bodies are read transiently for parsing and then
discarded. Results retain titles, URLs, dates, hashes, character counts and
outcome codes, not full article text or original PDFs. Production reuse still
needs a recorded rights decision.

PDF candidates are retained but PDF text extraction is pending. JavaScript-only
interfaces are flagged, not rendered. The production 60-event cap, database
connection, independent-news and regional collectors, complete native-language
inventory, open-web search execution, persistent cursor resume, scheduled
operation, statement verification and independent recall benchmarks remain
separate work. No completion score changes.

## Outputs

`collector-report.json`: per-source observations, pending items and failures.
`candidates.ndjson`: all candidates found within the budget, including pending.
`query-plans.json`: draft query batches for every existing entity.
`collector-report.sha256`: integrity checksum of the local report.

An HTTP 200 or nonzero candidate count does not establish freshness, ABG
relevance, completeness, copyright permission or factual support. Sources remain
partial observations. No fresh timestamp is substituted for a missing source
publication date.

## Reference interfaces and policy checks

- NSE RSS directory: https://www.nseindia.com/static/rss-feed
- SEC submissions: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEBI RSS: https://www.sebi.gov.in/rss.html
- Robots rules: https://www.rfc-editor.org/rfc/rfc9309.html
- ABFRL: https://www.abfrl.com/terms-of-use/
- ABLBL: https://www.ablbl.in/terms-of-use/

These are interface/policy references, not evidence that every live fetch passes.
