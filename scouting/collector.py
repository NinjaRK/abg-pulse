"""Candidate-preserving HTML/feed/SEC collectors with bounded public GETs.

No credentials, production writes, full-text retention, or fact-verification claims.
The legacy web application's collector is intentionally not switched by this module.
"""
from __future__ import annotations

import hashlib
import http.client
import ipaddress
import json
import math
import re
import socket
import ssl
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Callable
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree as ET
from .publication import observed_feed_day, source_publication, reconcile_publications

UTC = timezone.utc
BOT = "ABGPulseScout"
USER_AGENT = f"{BOT}/0.1 (+https://github.com/NinjaRK/abg-pulse; bounded public metadata test)"
TRACKING = {"fbclid", "gclid", "dclid", "msclkid"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
GENERIC = re.compile(r"^(?:read\s+more|learn\s+more|download(?:\s+latest\s+announcement)?|view|details|click\s+here)$", re.I)

class CollectorError(ValueError):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def canonical_url(value: str, base: str = "") -> str:
    """Keep document/query identity and query order, removing only known trackers."""
    if not isinstance(value, str) or re.search(r"[\x00-\x20\\]", value):
        raise CollectorError("unsafe_url")
    u = urlsplit(urljoin(base, value))
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        raise CollectorError("unsafe_url")
    try:
        if u.port not in (None, 443):
            raise CollectorError("unsafe_port")
    except ValueError as exc:
        raise CollectorError("unsafe_port") from exc
    if u.hostname.endswith("."):
        raise CollectorError("unsafe_host")
    parts = []
    for pair in u.query.split("&"):
        key = unquote(pair.split("=", 1)[0]).casefold()
        if pair and not (key.startswith("utm_") or key in TRACKING):
            parts.append(pair)
    return urlunsplit(("https", u.netloc.lower(), quote(u.path or "/", safe="/%:@!$&'()*+,;=-._~"), quote("&".join(parts), safe="/%?:@!$&'()*+,;=-._~"), ""))


def allowed_url(value: str, hosts: list[str]) -> str:
    url = canonical_url(value)
    if urlsplit(url).hostname not in hosts:
        raise CollectorError("host_not_allowlisted")
    return url


def date_observation(value: str | None, now: datetime | None = None) -> dict:
    """Return source precision, never substitute fetch time for missing dates."""
    extra = observed_feed_day(value, now)
    if extra is not None:
        return extra
    result = {"raw": value, "value": None, "precision": None, "state": "unknown"}
    if not value:
        return result
    text = compact(str(value))
    parsed = None
    precision = "instant"
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            parsed = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=UTC)
            precision = "day"
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})", text):
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        else:
            for fmt in ("%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y"):
                try:
                    parsed = datetime.strptime(text, fmt).replace(tzinfo=UTC)
                    precision = "day"
                    break
                except ValueError:
                    pass
            if parsed is None and re.search(r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),", text):
                parsed = parsedate_to_datetime(text)
                if parsed.tzinfo is None:
                    parsed = None
    except (ValueError, TypeError, OverflowError):
        parsed = None
    if parsed is None:
        result["state"] = "unparsed"
        return result
    now = now or datetime.now(UTC)
    result.update(value=parsed.date().isoformat() if precision == "day" else parsed.astimezone(UTC).isoformat(), precision=precision,
                  state="future" if (parsed.date() > now.date() if precision == "day" else parsed.timestamp() > now.timestamp() + 60) else "source_reported")
    return result


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    parent: Node | None = field(default=None, repr=False)
    children: list = field(default_factory=list)

    def text(self) -> str:
        if self.tag in {"script", "style", "noscript"}:
            return ""
        return compact(" ".join(c if isinstance(c, str) else c.text() for c in self.children))

    def descendants(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.descendants()


class Document(HTMLParser):
    def __init__(self, html: str):
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]
        self.nodes = 0
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if self.nodes > 60000 or len(self.stack) > 200:
            raise CollectorError("html_complexity_limit")
        # HTML's common implied closures prevent headings/cards swallowing siblings.
        if tag in {"li", "p", "tr"} and self.stack[-1].tag == tag:
            self.stack.pop()
        node = Node(tag, {k: v or "" for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                return

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def candidate(source_id, url, title, parent, kind="article", published=None):
    return {"id": hashlib.sha256((source_id + "|" + url).encode()).hexdigest(), "sourceId": source_id,
            "url": url, "title": compact(title)[:400] or None, "kind": kind,
            "discoveredOn": [parent], "publication": date_observation(published),
            "retrievalStatus": "pending", "statementVerification": "not_performed", "publishable": False}


def matches_path(url: str, patterns: list[str]) -> bool:
    target = urlsplit(url).path + ("?" + urlsplit(url).query if urlsplit(url).query else "")
    return any(re.search(p, target) for p in patterns)


def discover_html(html: str, page_url: str, source: dict) -> dict:
    doc = Document(html)
    nodes = list(doc.root.descendants())
    found, next_pages, rejected, feeds = {}, [], [], []
    heading = ""
    for node in nodes:
        if node.tag in {"h1", "h2", "h3", "h4"}:
            heading = node.text()
        if node.tag == "link" and "alternate" in node.attrs.get("rel", "") and any(t in node.attrs.get("type", "") for t in ("rss", "atom")):
            try:
                feeds.append(allowed_url(canonical_url(node.attrs.get("href", ""), page_url), source["allowedHosts"]))
            except CollectorError:
                pass
        if node.tag != "a" or not node.attrs.get("href") or node.attrs["href"].startswith("#"):
            continue
        try:
            url = allowed_url(canonical_url(node.attrs["href"], page_url), source["allowedHosts"])
        except CollectorError:
            continue  # Non-source navigation is out of this adapter's declared scope.
        label = node.text() or node.attrs.get("title", "") or node.attrs.get("aria-label", "")
        pagination = "next" in node.attrs.get("rel", "").lower().split() or bool(re.match(r"^next(?:\b|[›»])", label, re.I))
        if pagination and matches_path(url, source.get("listingPatterns", [])):
            if url != canonical_url(page_url):
                next_pages.append(url)
            continue
        kind = "attachment" if re.search(r"\.pdf(?:$|\?)", url, re.I) else "article"
        if not matches_path(url, source.get("candidatePatterns", [])):
            continue
        if url == canonical_url(page_url):
            continue
        # A generic PDF label is a discoverable document, not a rejection.
        title = heading if (not label or GENERIC.fullmatch(label)) and heading else label
        if len(title) < 3:
            title = "Document awaiting detail inspection"
        item = candidate(source["id"], url, title, page_url, kind)
        if url in found:
            old = found[url]
            if not GENERIC.fullmatch(title) and (GENERIC.fullmatch(old["title"] or "") or len(title) > len(old["title"] or "")):
                old["title"] = title[:400]
        else:
            found[url] = item
    return {"candidates": list(found.values()), "nextPages": list(dict.fromkeys(next_pages)),
            "feedLinks": list(dict.fromkeys(feeds)), "rejected": rejected,
            "pageState": "candidates_found" if found else "empty_or_unrecognised"}


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def discover_feed(xml: str, page_url: str, source: dict) -> dict:
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", xml, re.I):
        raise CollectorError("unsafe_xml_declaration")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise CollectorError("invalid_feed") from exc
    if _local(root.tag) not in {"rss", "feed", "RDF"}:
        raise CollectorError("unexpected_feed_root")
    found, rejected, next_pages = {}, [], []
    for i, item in enumerate(n for n in root.iter() if _local(n.tag) in {"item", "entry"}):
        children = list(item)
        text = lambda tag: next((compact("".join(c.itertext())) for c in children if _local(c.tag) == tag), "")
        links = [c for c in children if _local(c.tag) == "link"]
        href = next((c.attrib["href"] for c in links if c.attrib.get("href") and c.attrib.get("rel", "alternate") == "alternate"), text("link"))
        try:
            if not href:
                raise CollectorError("missing_feed_link")
            url = allowed_url(canonical_url(href, page_url), source["allowedHosts"])
        except CollectorError as exc:
            rejected.append({"position": i, "reason": exc.code})
            continue
        observed = candidate(source["id"], url, text("title"), page_url,
                             "attachment" if ".pdf" in urlsplit(url).path.lower() else "article",
                             text("pubDate") or text("published") or None)
        observed["modified"] = date_observation(text("updated") or None)
        found.setdefault(url, observed)
    for n in root.iter():
        if _local(n.tag) == "link" and n.attrib.get("rel") == "next":
            try:
                next_pages.append(allowed_url(canonical_url(n.attrib.get("href", ""), page_url), source["allowedHosts"]))
            except CollectorError:
                pass
    return {"candidates": list(found.values()), "nextPages": next_pages, "rejected": rejected,
            "pageState": "candidates_found" if found else "empty_or_unrecognised"}


def discover_sec(payload: dict, page_url: str, source: dict) -> dict:
    cik = str(source["cik"]).lstrip("0")
    if "cik" in payload and str(payload["cik"]).lstrip("0") != cik:
        raise CollectorError("issuer_mismatch")
    recent = payload.get("filings", {}).get("recent", payload)
    keys = ("accessionNumber", "primaryDocument", "filingDate", "form")
    arrays = [recent.get(k) for k in keys]
    if not all(isinstance(a, list) for a in arrays) or len({len(a) for a in arrays}) != 1:
        raise CollectorError("sec_column_mismatch")
    rows, rejected = [], []
    for i, (accession, document, published, form) in enumerate(zip(*arrays)):
        if not isinstance(accession, str) or not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession) or not document or "/" in document or ".." in document:
            rejected.append({"position": i, "reason": "invalid_filing_identifier"})
            continue
        url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{quote(document)}"
        row = candidate(source["id"], url, f"{source['issuer']} {form} {published}", page_url, "filing", published)
        row["accessionNumber"] = accession
        rows.append(row)
    pages = []
    for item in payload.get("filings", {}).get("files", []):
        name = item.get("name", "")
        if re.fullmatch(r"CIK\d{10}-submissions-\d+\.json", name):
            pages.append(f"https://data.sec.gov/submissions/{name}")
    return {"candidates": rows, "nextPages": pages, "rejected": rejected,
            "pageState": "candidates_found" if rows else "empty_or_unrecognised"}


def inspect_html(html: str, url: str, source: dict) -> dict:
    doc = Document(html)
    nodes = list(doc.root.descendants())
    metadata = {n.attrs.get("property", n.attrs.get("name", "")).lower(): n.attrs.get("content", "") for n in nodes if n.tag == "meta"}
    heading = next((n.text() for n in nodes if n.tag == "h1"), "")
    title = heading or metadata.get("og:title") or next((n.text() for n in nodes if n.tag == "title"), "")
    publication = metadata.get("article:published_time") or metadata.get("datepublished")
    modified = metadata.get("article:modified_time") or metadata.get("datemodified")
    for n in nodes:
        if n.tag == "script" and n.attrs.get("type", "").lower() == "application/ld+json":
            try:
                stack = [json.loads("".join(c for c in n.children if isinstance(c, str)))]; steps = 0
                while stack and steps < 1000:
                    val = stack.pop(); steps += 1
                    if isinstance(val, list): stack.extend(val)
                    if isinstance(val, dict):
                        types = val.get("@type", [])
                        types = [types] if isinstance(types, str) else types
                        if any(t in {"Article", "NewsArticle", "BlogPosting", "Report"} for t in types):
                            publication = publication or val.get("datePublished")
                            modified = modified or val.get("dateModified")
                            title = val.get("headline") or title
                        stack.extend(v for v in val.values() if isinstance(v, (dict, list)))
            except (ValueError, TypeError):
                pass
    # Unlabelled time tags can be navigation clocks; retain as hints, not publication.
    time_hints = [n.attrs["datetime"] for n in nodes if n.tag == "time" and n.attrs.get("datetime")]
    body = next((n.text() for n in nodes if n.tag == "article"), "") or next((n.text() for n in nodes if n.tag == "main"), "")
    title = compact(str(title))
    blocked = bool(re.search(r"^(?:access denied|just a moment|robot verification|sign in|login|attention required)", title, re.I))
    attachments = discover_html(html, url, {**source, "candidatePatterns": [r"\.pdf(?:$|\?)"]})["candidates"]
    return {"title": title[:400] or None, "publication": reconcile_publications(date_observation(publication), source_publication(nodes, url, source, date_observation)), "modified": date_observation(modified),
            "unassignedTimeHints": time_hints[:20], "bodyCharacterCount": len(body),
            "retrievalStatus": "blocked_page" if blocked else ("html_metadata_retrieved" if title else "empty_or_unrecognised"),
            "attachments": attachments, "statementVerification": "not_performed", "publishable": False}


def robots_decision(text: str, url: str, bot: str = BOT) -> tuple[bool, float]:
    """Longest matching rule, wildcard/end markers and merged matching groups.

    Conservative non-ASCII handling: compare percent-encoded UTF-8 paths. This
    small parser is exercised by tests, not advertised as exhaustive REP parity.
    """
    groups, agents, rules, delay = [], [], [], 0.0
    for line in text.splitlines() + ["User-agent: __end__"]:
        line = line.split("#", 1)[0].strip()
        if ":" not in line: continue
        key, value = [s.strip() for s in line.split(":", 1)]
        key = key.lower()
        if key == "user-agent":
            if rules or delay:
                groups.append((agents, rules, delay)); agents, rules, delay = [], [], 0.0
            agents.append(value.lower())
        elif key in {"allow", "disallow"} and agents:
            if value: rules.append((key, value))
        elif key == "crawl-delay" and agents:
            try:
                parsed = float(value)
                if not math.isfinite(parsed) or parsed < 0: raise ValueError()
                delay = max(delay, parsed)
            except ValueError: raise CollectorError("robots_ambiguous")
    selected = [g for g in groups if bot.lower() in g[0]]
    if not selected: selected = [g for g in groups if "*" in g[0]]
    u = urlsplit(url)
    def norm(s):
        s = re.sub(r"%([0-9a-fA-F]{2})", lambda m: chr(int(m[1], 16)) if chr(int(m[1], 16)) in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~' else '%' + m[1].upper(), s)
        return quote(s, safe="/%?=&:;,+!$'()*@[]~.-_")
    target = norm(u.path + ("?" + u.query if u.query else ""))
    matches = []
    for _, entries, _ in selected:
        for kind, rule in entries:
            rule = norm(rule)
            anchor = rule.endswith("$")
            rule = rule[:-1] if anchor else rule
            pattern = "^" + ".*".join(re.escape(s) for s in rule.split("*")) + ("$" if anchor else "")
            if re.search(pattern, target): matches.append((len(rule.replace("*", "")), kind == "allow"))
    wait = max([g[2] for g in selected] or [0])
    if not math.isfinite(wait) or wait < 0 or wait > 30: raise CollectorError("robots_delay_exceeds_probe_budget")
    return (max(matches)[1] if matches else True), wait


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address, timeout):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, 443), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class PublicTransport:
    """No cookies, tokens, proxy inheritance, private-IP requests or free redirects."""
    def __init__(self, hosts: list[str], timeout=15, max_bytes=3_000_000):
        self.hosts, self.timeout, self.max_bytes = hosts, timeout, max_bytes
        self.robot_cache, self.last_request, self.records = {}, {}, []

    def raw_get(self, url, limit=None):
        url = allowed_url(url, self.hosts)
        u = urlsplit(url)
        addresses = {r[4][0] for r in socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)}
        if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
            raise CollectorError("non_public_destination")
        wait = max(0.0, 1.0 - (time.monotonic() - self.last_request.get(u.hostname, 0)))
        time.sleep(wait)
        self.last_request[u.hostname] = time.monotonic()
        conn = PinnedHTTPS(u.hostname, sorted(addresses)[0], self.timeout)
        try:
            conn.request("GET", u.path + ("?" + u.query if u.query else ""), headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/rss+xml,application/atom+xml,application/json,application/xml,application/pdf;q=0.8", "Accept-Encoding": "identity"})
            response = conn.getresponse()
            headers = {k.lower(): v for k, v in response.getheaders()}
            maximum = limit or self.max_bytes
            if int(headers.get("content-length", "0")) > maximum:
                raise CollectorError("download_too_large")
            body = response.read(maximum + 1)
            if len(body) > maximum: raise CollectorError("download_too_large")
            if headers.get("content-encoding", "identity").lower() not in {"", "identity"}: raise CollectorError("compressed_response_not_supported")
            record = {"url": url, "status": response.status, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "contentType": headers.get("content-type", ""), "checkedAt": datetime.now(UTC).isoformat()}
            self.records.append(record)
            return response.status, headers, body
        finally:
            conn.close()

    def get(self, url, *, destination_guard=None):
        current = allowed_url(url, self.hosts)
        for _ in range(6):
            if destination_guard is not None:
                destination_guard(current)
            u = urlsplit(current)
            origin = f"https://{u.netloc}"
            if origin not in self.robot_cache:
                status, headers, body = self.raw_get(origin + "/robots.txt", limit=512_000)
                if status == 200:
                    if "<html" in body[:1000].decode("utf-8", "replace").lower(): raise CollectorError("robots_unreadable")
                    self.robot_cache[origin] = body.decode("utf-8", "strict")
                elif status in {404, 410}: self.robot_cache[origin] = ""
                else: raise CollectorError("robots_unavailable")
            allow, delay = robots_decision(self.robot_cache[origin], current)
            if not allow: raise CollectorError("robots_disallowed")
            time.sleep(max(0, delay - (time.monotonic() - self.last_request.get(u.hostname, 0))))
            status, headers, body = self.raw_get(current)
            if status in {301, 302, 303, 307, 308}:
                current = allowed_url(canonical_url(headers.get("location", ""), current), self.hosts)
                continue
            if status != 200: raise CollectorError("http_" + str(status))
            return current, headers, body
        raise CollectorError("redirect_limit")


def collect_source(source: dict, fetcher: Callable, max_pages=2, max_details=2, *, document_metadata=False) -> dict:
    """Bounded traversal: a budget leaves explicit pending URLs, never completeness."""
    if not isinstance(max_pages, int) or not 1 <= max_pages <= 10 or not isinstance(max_details, int) or not 0 <= max_details <= 20:
        raise CollectorError("invalid_budget")
    report = {"sourceId": source["id"], "source": source["name"], "startedAt": datetime.now(UTC).isoformat(),
              "productionEnabled": False, "rightsStatus": source["rightsStatus"], "pages": [], "candidates": [],
              "pendingPages": [], "errors": [], "archiveComplete": False, "publishable": False}
    if source.get("probeMode") != "public_metadata_only":
        report["status"] = "rights_or_configuration_pending"
        return report
    queue = list(source["seedUrls"]); visited, candidates = set(), {}
    while queue and len(visited) < max_pages:
        requested = queue.pop(0)
        if requested in visited: continue
        visited.add(requested)
        try:
            url, headers, data = fetcher(requested)
            text = data.decode("utf-8-sig", "replace")
            kind = source["adapter"]
            parsed = discover_sec(json.loads(text), url, source) if kind == "sec_submissions" else (discover_feed(text, url, source) if kind == "feed" else discover_html(text, url, source))
            report["pages"].append({"requestedUrl": requested, "url": url, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "candidateCount": len(parsed["candidates"]), "rejected": parsed["rejected"], "state": parsed["pageState"]})
            for item in parsed["candidates"]:
                if item["url"] not in candidates: candidates[item["url"]] = item
                else:
                    prev = candidates[item["url"]]
                    prev["discoveredOn"] = sorted(set(prev["discoveredOn"] + item["discoveredOn"]))
            queue.extend(p for p in parsed["nextPages"] if p not in visited and p not in queue)
        except Exception as exc:
            report["errors"].append({"url": requested, "code": getattr(exc, "code", "fetch_or_parse_failed"), "errorType": type(exc).__name__})
    report["pendingPages"] = list(dict.fromkeys(queue))
    details_attempted = 0
    for item in list(candidates.values()):
        if details_attempted >= max_details:
            item["retrievalStatus"] = "pending_detail_budget"
            continue
        if item["kind"] == "attachment":
            item["retrievalStatus"] = "attachment_pending_permission_and_extraction"
            continue
        details_attempted += 1
        try:
            url, headers, data = fetcher(item["url"])
            item.update(fetchedAt=datetime.now(UTC).isoformat(), resolvedUrl=url, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), contentType=headers.get("content-type", ""))
            if data.startswith(b"%PDF-") or "application/pdf" in headers.get("content-type", ""):
                item["retrievalStatus"] = "pdf_detected_extraction_pending"
            else:
                detail = inspect_html(data.decode("utf-8-sig", "replace"), url, source)
                # Compare feed/detail publication evidence; preserve disagreement.
                detail["publication"] = reconcile_publications(item["publication"], detail["publication"])
                attachments = detail.pop("attachments")
                if document_metadata:
                    # Reuse the already fetched bytes; existing rights allow only
                    # transient HTML inspection and hashes/locators, not retained text.
                    from .documents import extract_document
                    content = extract_document(data, url, source, content_type=headers.get("content-type", ""))
                    item["contentInspection"] = content
                    for ref in content.get("attachments", []):
                        linked = candidate(source["id"], ref["url"], "Document awaiting inspection", url, "attachment")
                        linked["discoveryReference"] = ref["reference"]
                        linked["parentDocumentHash"] = content.get("documentHash")
                        attachments.append(linked)
                item.update(detail)
                for attachment in attachments:
                    attachment["retrievalStatus"] = "attachment_pending_permission_and_extraction"
                    candidates.setdefault(attachment["url"], attachment)
        except Exception as exc:
            item["retrievalStatus"] = getattr(exc, "code", "fetch_or_parse_failed")
            item["errorType"] = type(exc).__name__
    report["candidates"] = list(candidates.values())
    report["candidateCount"] = len(candidates)
    report["detailAttempts"] = details_attempted
    report["retrievedDetails"] = sum(c["retrievalStatus"] == "html_metadata_retrieved" for c in candidates.values())
    report["status"] = "partial_observation" if report["pages"] else "no_page_retrieved"
    report["finishedAt"] = datetime.now(UTC).isoformat()
    return report
