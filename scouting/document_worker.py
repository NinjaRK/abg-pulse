"""Linux resource-limited parser worker. No document-directed network or subprocesses.

This is process isolation/defence in depth, not a claim of a container escape-proof
sandbox. Source text remains untrusted data. No OCR, JS, macros or embedded files run.
"""
from __future__ import annotations
import hashlib
import io
import json
from pathlib import Path
import re
import resource
import sys
from urllib.parse import parse_qs, urlsplit

ROOT = Path(sys.argv[1])
CONTEXT = json.loads((ROOT / "context.json").read_text())
LIMIT = CONTEXT["limits"]
resource.setrlimit(resource.RLIMIT_AS, (LIMIT["memory_mb"] * 1024**2,) * 2)
resource.setrlimit(resource.RLIMIT_CPU, (LIMIT["cpu_seconds"], LIMIT["cpu_seconds"] + 1))
resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT["output_bytes"],) * 2)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def audit(event, args):
    if event.startswith(("socket.", "subprocess.", "os.exec", "os.spawn")) or event in {"os.system", "os.fork", "os.forkpty", "pty.spawn"}:
        raise PermissionError("document_worker_operation_denied")


sys.addaudithook(audit)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scouting.collector import Document, Node, compact, canonical_url, allowed_url, CollectorError

DROP_TAGS = {"script", "style", "noscript", "nav", "footer", "form", "button", "template", "svg"}
BLOCK_TAGS = {"p", "li", "blockquote", "tr", "h1", "h2", "h3", "h4", "pre", "dt", "dd"}


def fail(code):
    return {"status": code, "passages": [], "attachments": [], "textTraversalComplete": False}


def hidden(n):
    style = re.sub(r"\s+", "", n.attrs.get("style", "").lower())
    return (n.tag in DROP_TAGS or "hidden" in n.attrs or n.attrs.get("aria-hidden", "").lower() == "true"
            or "display:none" in style or "visibility:hidden" in style
            or n.attrs.get("role") in {"navigation", "banner", "contentinfo"})


def text_of(n):
    if hidden(n): return ""
    return compact(" ".join(c if isinstance(c, str) else text_of(c) for c in n.children))


def locator(n):
    parts = []
    while n and n.tag != "document":
        peers = [c for c in n.parent.children if isinstance(c, Node) and c.tag == n.tag] if n.parent else [n]
        # Node dataclass equality recursively compares parents; use identity.
        pos = next(i for i, p in enumerate(peers, 1) if p is n)
        parts.append(f"{n.tag}:nth-of-type({pos})")
        n = n.parent
    return " > ".join(reversed(parts))


def passage(text, ref):
    digest = hashlib.sha256(text.encode()).hexdigest()
    row = {"reference": ref, "characters": len(text), "sha256": digest,
           "id": hashlib.sha256((CONTEXT["source"]["id"] + "|" + CONTEXT["url"] + "|" + CONTEXT["documentHash"] + "|" + json.dumps(ref, sort_keys=True) + "|" + digest).encode()).hexdigest()}
    if CONTEXT["mode"] == "permitted_text": row["text"] = text
    return row


def select_root(nodes):
    sid = CONTEXT["source"]["id"]
    def classes(n): return n.attrs.get("class", "").split()
    if sid == "S003": roots = [n for n in nodes if n.tag == "article" and "full-news-article" in classes(n)]
    elif sid == "S005":
        roots = [n for n in nodes if n.tag == "div" and "cmp-text" in classes(n) and any(c.tag == "h1" for c in n.descendants())]
    elif sid == "S017": roots = [n for n in nodes if n.tag == "section" and "main_section" in classes(n)]
    else:
        roots = [n for n in nodes if n.tag == "article"]
        if not roots: roots = [n for n in nodes if n.attrs.get("itemprop") == "articleBody"]
        if not roots: roots = [n for n in nodes if n.tag == "main"]
    if len(roots) != 1:
        raise CollectorError("ambiguous_article_scope" if roots else "article_scope_missing")
    return roots[0]


def references(nodes):
    found, blocked = {}, []
    for n in nodes:
        raw = n.attrs.get("data" if n.tag == "object" else ("href" if n.tag == "a" else "src"))
        if n.tag not in {"a", "iframe", "object", "embed"} or not raw:
            continue
        try:
            u = canonical_url(raw, CONTEXT["url"])
            parsed = urlsplit(u)
            if CONTEXT["source"]["id"] == "S017" and n.tag == "iframe" and parsed.path == "/web/" and parsed.hostname in CONTEXT["source"]["allowedHosts"]:
                files = parse_qs(parsed.query).get("file", [])
                if len(files) != 1: raise CollectorError("ambiguous_pdf_viewer")
                u = canonical_url(files[0], u)
            if not urlsplit(u).path.lower().endswith(".pdf") and n.attrs.get("type") != "application/pdf":
                continue
            allowed_url(u, CONTEXT["source"]["allowedHosts"])
            if u not in found:
                found[u] = {"url": u, "kind": "attachment", "discoveredOn": CONTEXT["url"],
                            "reference": {"type": "parser_dom_path", "locator": locator(n)},
                            "retrievalStatus": "document_permission_and_fetch_pending", "publishable": False}
        except CollectorError as exc:
            # Do not log script URLs or the text of an unsafe source input.
            blocked.append({"reference": {"type": "parser_dom_path", "locator": locator(n)}, "reason": exc.code})
        if len(found) + len(blocked) >= 100:
            return list(found.values()), blocked, False
    return list(found.values()), blocked, True


def html_content(data):
    content_type = CONTEXT["contentType"]
    m = re.search(r"charset\s*=\s*[\"']?([\w-]+)", content_type, re.I)
    encoding = (m[1] if m else "utf-8-sig").lower()
    if encoding not in {"utf-8", "utf-8-sig", "utf8", "ascii", "iso-8859-1", "windows-1252"}:
        return fail("unsupported_document_charset")
    try: html = data.decode(encoding, "strict")
    except UnicodeError: return fail("document_decode_failed")
    if not re.search(r"<(?:!doctype\s+html|html|article|main|section|div|p)\b", html[:4096], re.I):
        return fail("non_html_response")
    doc = Document(html); nodes = list(doc.root.descendants())
    title = next((n.text() for n in nodes if n.tag == "title"), "")
    if re.match(r"\s*(?:access denied|just a moment|robot verification|sign in|login|attention required)", title, re.I):
        return fail("blocked_document_page")
    root = select_root(nodes)
    attachments, blocked, links_complete = references(list(root.descendants()))
    rows, count, limited = [], 0, False
    def walk(n):
        if hidden(n): return
        if n.tag in BLOCK_TAGS:
            yield n
        else:
            for child in n.children:
                if isinstance(child, Node): yield from walk(child)
    for n in walk(root):
        text = text_of(n)
        if not text: continue
        if len(rows) >= LIMIT["max_passages"] or count + len(text) > LIMIT["max_characters"]:
            limited = True; break
        rows.append(passage(text, {"type": "parser_dom_path", "locator": locator(n), "tag": n.tag, "block": len(rows) + 1}))
        count += len(text)
    # Text outside semantic blocks is not silently certified as traversed.
    semantic_text = " ".join(text_of(n) for n in walk(root))
    visible_text = text_of(root)
    unsegmented = max(0, len(visible_text) - len(semantic_text))
    media = sum(n.tag in {"img", "video", "audio", "canvas"} for n in root.descendants())
    complete = not limited and not unsegmented
    status = "html_text_extracted" if rows else ("attachment_only" if attachments else "html_text_empty")
    if (limited or unsegmented) and (rows or not attachments): status = "html_text_partial"
    return {"status": status, "passages": rows, "characters": count,
            "scope": {"type": "selected_article_container", "locator": locator(root)},
            "textTraversalComplete": complete, "limitReached": limited,
            "unsegmentedCharacters": unsegmented, "nonTextElementsNotExtracted": media,
            "attachments": attachments, "blockedAttachments": blocked, "attachmentTraversalComplete": links_complete,
            "pendingReasons": (["text_or_passage_limit"] if limited else []) + (["unsegmented_content"] if unsegmented else []),
            "layoutVerified": False}


def pdf_content(data):
    import pypdf
    if pypdf.__version__ != "6.19.0": return fail("pdf_dependency_version_mismatch")
    if not data.startswith(b"%PDF-"): return fail("non_pdf_response")
    reader = pypdf.PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted: return fail("encrypted_pdf_permission_required")
    root = reader.trailer["/Root"]
    names = root.get("/Names", {})
    if hasattr(names, "get_object"): names = names.get_object()
    if any(k in root for k in ("/OpenAction", "/AA")) or any(k in names for k in ("/JavaScript", "/EmbeddedFiles")):
        return fail("pdf_active_content_requires_review")
    total = len(reader.pages)
    if total < 1: return fail("pdf_no_pages")
    if total > 10000: return fail("pdf_page_count_limit")
    rows, pages, characters, decoded = [], [], 0, 0
    limited = False
    for index in range(min(total, LIMIT["max_pages"])):
        page = reader.pages[index]
        if "/AA" in page: return fail("pdf_active_content_requires_review")
        content = page.get_contents()
        stream = content.get_data() if content is not None else b""
        decoded += len(stream)
        if decoded > LIMIT["max_decoded_stream_bytes"]:
            pages.append({"page": index + 1, "status": "decoded_stream_limit"});limited = True;break
        text = page.extract_text() or ""
        if len(text) > LIMIT["max_characters"] - characters:
            pages.append({"page": index + 1, "status": "text_budget_pending"});limited = True;break
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        if not text.strip():
            pages.append({"page": index + 1, "status": "no_text_layer_or_empty", "characters": 0})
            continue
        # Page text order is retained, not advertised as layout/table semantics.
        groups = re.split(r"\n\s*\n", text)
        blocks = [(i, compact(t)) for i, t in enumerate(groups, 1) if t.strip()]
        if len(rows) + len(blocks) > LIMIT["max_passages"]:
            pages.append({"page": index + 1, "status": "passage_budget_pending"});limited = True;break
        page_chars = 0
        for block, content_text in blocks:
            rows.append(passage(content_text, {"type": "pdf_page_text", "page": index + 1, "block": block}))
            page_chars += len(content_text)
        characters += page_chars
        pages.append({"page": index + 1, "status": "text_extracted", "characters": page_chars})
    missing_text = any(p["status"] != "text_extracted" for p in pages)
    traversed = len(pages)
    complete = traversed == total and not limited and not missing_text
    return {"status": "pdf_text_extracted" if complete else ("pdf_text_partial" if rows else "pdf_text_unavailable"),
            "parserDependency": "pypdf==6.19.0", "passages": rows, "characters": characters,
            "pageCount": total, "pages": pages, "attachments": [], "textTraversalComplete": complete,
            "pendingPages": {"from": traversed + 1, "through": total} if traversed < total else None,
            "limitReached": limited or traversed < total, "decodedStreamBytes": decoded,
            "readingOrder": "pdf_text_order_not_layout_verified", "layoutVerified": False,
            "ocrPerformed": False, "sourcePublicationNotInferred": True}


try:
    data = (ROOT / "input.bin").read_bytes()
    if len(data) > LIMIT["max_bytes"]: result = fail("document_too_large")
    elif CONTEXT["kind"] == "pdf": result = pdf_content(data)
    else: result = html_content(data)
except CollectorError as exc: result = fail(exc.code)
except MemoryError: result = fail("document_memory_limit")
except Exception: result = fail("document_parse_failed")
result.update(statementVerification="not_performed", publishable=False, semanticCompletenessVerified=False,
              isolation={"memoryLimitBytes": resource.getrlimit(resource.RLIMIT_AS)[0],
                         "cpuLimitSeconds": resource.getrlimit(resource.RLIMIT_CPU)[0],
                         "networkAndChildProcesses": "python_audit_denied"})
try:
    output = json.dumps(result, ensure_ascii=False).encode()
    if len(output) > LIMIT["output_bytes"]:
        output = json.dumps(fail("document_output_limit")).encode()
    (ROOT / "result.json").write_bytes(output)
except Exception:
    raise SystemExit(2)
