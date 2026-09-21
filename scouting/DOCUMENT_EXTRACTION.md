# T4.2: document-content extraction checkpoint

## Scope and operation

Adds a Linux subprocess HTML/PDF inspector to the existing PR23 collector. It is
not wired to the production news feed, does not write Supabase or live-data, and
does not change any source's production activation or permission status.

Run the optional PDF dependency in an isolated Python environment:

```sh
python -m venv .venv
.venv/bin/python -m pip install --require-hashes --only-binary=:all: --no-deps -r scouting/requirements-documents.txt
.venv/bin/python -m unittest discover -s tests/scouting -v
.venv/bin/python -m scouting.run_probe --document-metadata --output /tmp/scouting
```

`--document-metadata` reuses the same bounded HTML responses, extracts selected
article-container paragraphs transiently, and retains only character counts,
hashes, original-document digest and parser-DOM references. No article text or PDF
bytes are put in probe artifacts. The normal metadata/date fields remain separate.

For content that has an actual scoped documentPolicy, `extract_document` and
`fetch_document` support retaining text, up to the stated policy and parser limits.
This configuration must be supplied by trusted application code, not by articles,
untrusted request bodies or the model interpreting an article. The policy has
exact URLs/formats, a permission reference, evidence URL, reviewer and optional
expiry. Public visibility or a successful robots fetch is not a licence.

All existing 71 sources retain their old rights status. A newly noticed SEBI
copyright condition requires permission for reproduction, so no retained SEBI
text/PDF is authorised here. Hash-only metadata remains distinct from reuse.

## Extraction results

HTML: source-scoped Novelis, UltraTech and SEBI containers; a unique semantic
article/main container elsewhere; boilerplate/hidden/script exclusions; paragraph
references; meaningful embedded PDF viewer links, including a SEBI iframe's
underlying same-host PDF. Missing/ambiguous scopes, unsegmented text and budgets
produce explicit incomplete statuses. No arbitrary whole-page fallback.

PDF: pinned pypdf 6.19.0 native-text parsing, per-page references and text hashes.
Original bytes and source identity bind every passage ID. Plain paragraphs are
available only under scoped retention permission; hash-only mode returns no text.
Encrypted or active-content PDFs are not processed. Empty/image-only pages remain
unread; there is no automated OCR. Mixed text/image documents remain incomplete.
Page, stream, input, output and text ceilings never yield a complete-document flag.
Tables, columns, reading order and factual interpretation are not independently
validated by text extraction. No date is derived from PDF CreationDate or body text.

The public W3C PDF in `document_fixture_probe.py` is a one-page parser CONTROL,
not a new ABG source, not a recall benchmark, and not a licence for another source.
Its fetched bytes and extracted body are discarded; output is a page/text hash
match. The test's expected text was independently visible in the PDF rendering.

## Process and network boundaries

Default bounds: 3 MB input; 30 pages; 500 passages; 120,000 text characters;
8 MB cumulative decoded PDF page streams; 256 MB process address space; 4 CPU
seconds; 10 wall-clock seconds; 1 MB output. Limits have hard validation ceilings.
No oversized result is silently accepted as complete.

The worker receives a minimal environment, no inherited tokens, HOME or proxies;
uses a temporary directory deleted at the end; runs under Linux resource limits;
and denies Python socket/child-process operations through an audit hook. Parent
timeout kills the worker process group. This is defence in depth, not certification
against native-code exploits or container escape. Full independent security review
remains open. Unsupported platforms fail closed rather than run unbounded.

The parser never fetches hyperlinks. Network retrieval stays in PublicTransport
with its existing TLS, exact hosts, public-IP pinning, robots, redirects and byte
limits. Candidate permissions are checked before fetching, at every redirected destination
and on the final resolved URL before parsing. Host/robots controls remain in place.
The optional transport destination guard rejects a same-host redirect outside the
exact content permission before requesting that destination. No authenticated or
private source is added by this change.

## Tests and evidence classes

New synthetic tests exercise readable/two-page, empty, mixed-empty, corrupt,
encrypted, active-content, non-PDF, oversized and compressed-stream inputs;
paragraph/Unicode/DOM references; policy expiry/scope/retention; attachment hosts;
blocked responses; worker timeout, actual memory ceiling, no inherited credentials,
and denied socket/process attempts. Prior tests remain intact.

The source probe is a bounded six-page observation with hashes/locators, not
full-source acceptance. The W3C fixture and synthetic documents test parsing, not
ABG relevance. Independent caught-versus-missed news evaluation is still open.

## Dependency and policy references checked 21 September 2026

- pypdf 6.19.0 release / BSD-3-Clause: https://pypi.org/project/pypdf/6.19.0/
- Wheel SHA256: 7e5d6e730e7dae87d560a2cee218b852f6498c8be61966f3cd02ead971e48d14
- Text extraction / memory and layout caveats: https://pypdf.readthedocs.io/en/6.18.1/user/extract-text.html
- Maintainer advisories: https://github.com/py-pdf/pypdf/security/advisories
- ToUnicode memory advisory, patched from 6.15.0: https://github.com/py-pdf/pypdf/security/advisories/GHSA-fp3f-mc75-235c
- W3C copy policy: https://www.w3.org/copyright/
- Test PDF: https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
- SEBI reproduction policy: https://www.sebi.gov.in/website-policy.html

A pinned current dependency is not a claim of zero vulnerabilities. No optional
crypto/image/ML/OCR packages or new paid services were introduced.

## Body-presence check from the first real document run

The Coolbrook UltraTech page exposed only two heading blocks in the selected
container. That is not established article-body extraction. HTML results now
report bodyPassageCount/bodyCharacters separately from headings and mark a
headings-only result html_body_not_established, with incomplete traversal.
This is a structural check, not proof of relevance or semantic completeness.
The source-specific layout needs further work; do not silently count it as a
fully read article because two headings were parsed.
