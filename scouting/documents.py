"""Bounded, provenance-linked document inspection; no publication or network by parser.

Source configuration is trusted application configuration, never page-supplied input.
Existing metadata probes receive hashes/locators only. Text retention and PDF fetching
require an explicit scoped documentPolicy. No existing source is enabled here.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from urllib.parse import urlsplit

from .collector import CollectorError, allowed_url, canonical_url

PARSER_VERSION = "abg-documents-v1"
PYPDF_VERSION = "6.19.0"
WORKER = Path(__file__).with_name("document_worker.py")


@dataclass(frozen=True)
class Limits:
    max_bytes: int = 3_000_000
    max_pages: int = 30
    max_passages: int = 500
    max_characters: int = 120_000
    max_decoded_stream_bytes: int = 8_000_000
    memory_mb: int = 256
    cpu_seconds: int = 4
    wall_seconds: int = 10
    output_bytes: int = 1_000_000

    def validate(self):
        bounds = {
            "max_bytes": (256, 10_000_000), "max_pages": (1, 100),
            "max_passages": (1, 1000), "max_characters": (20, 200_000),
            "max_decoded_stream_bytes": (256, 16_000_000), "memory_mb": (64, 512),
            "cpu_seconds": (1, 10), "wall_seconds": (1, 30),
            "output_bytes": (2048, 2_000_000)}
        for key, (low, high) in bounds.items():
            value = getattr(self, key)
            if type(value) is not int or not low <= value <= high:
                raise CollectorError("invalid_document_limit", key)
        return self


def failure(code: str) -> dict:
    return {"status": code, "passages": [], "attachments": [],
            "textTraversalComplete": False, "statementVerification": "not_performed",
            "semanticCompletenessVerified": False, "publishable": False}


def _policy(source: dict, url: str, kind: str, retain_text: bool) -> dict:
    """Apply rights BEFORE network or parser work; a public URL is not permission."""
    allowed_url(url, source.get("allowedHosts", []))
    policy = source.get("documentPolicy", {})
    if policy.get("permission") == "granted":
        if not all(isinstance(policy.get(k), str) and policy[k].strip()
                   for k in ("referenceId", "approvedBy", "evidenceUrl")):
            raise CollectorError("document_permission_incomplete")
        canonical_url(policy["evidenceUrl"])
        urls = policy.get("urls", [])
        if not isinstance(urls, list) or url not in [canonical_url(u) for u in urls]:
            raise CollectorError("document_outside_permission_scope")
        if kind not in policy.get("formats", []):
            raise CollectorError("document_format_not_permitted")
        expires = policy.get("expiresAt")
        if expires:
            try:
                dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                if dt.tzinfo is None or dt <= datetime.now(timezone.utc):
                    raise ValueError()
            except (ValueError, TypeError):
                raise CollectorError("document_permission_expired_or_invalid")
        maximum = policy.get("maxRetainedCharacters", 0)
        if type(maximum) is not int or maximum < 0 or maximum > 200_000:
            raise CollectorError("document_permission_incomplete")
        if retain_text and maximum < 20:
            raise CollectorError("text_retention_not_permitted")
        return {"mode": "permitted_text" if retain_text else "hash_only",
                "referenceId": policy["referenceId"], "maxRetainedCharacters": maximum}
    if kind == "html" and not retain_text and source.get("probeMode") == "public_metadata_only":
        return {"mode": "hash_only", "referenceId": "existing-bounded-public-metadata-probe",
                "maxRetainedCharacters": 0}
    raise CollectorError("document_permission_pending")


def _run_worker(data: bytes, context: dict, limits: Limits) -> dict:
    if sys.platform != "linux":
        return failure("document_isolation_unsupported")
    # The worker gets no inherited tokens, database settings, proxy or HOME config.
    env = {"PATH": os.defpath, "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    with tempfile.TemporaryDirectory(prefix="abg-document-") as folder:
        root = Path(folder)
        (root / "input.bin").write_bytes(data)
        (root / "context.json").write_text(json.dumps({**context, "limits": asdict(limits)}))
        with (root / "errors.log").open("wb") as errors:
            process = subprocess.Popen(
                [sys.executable, "-I", str(WORKER.resolve()), str(root)], cwd=root,
                env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=errors, start_new_session=True)
            try:
                process.wait(timeout=limits.wall_seconds)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                return failure("document_timeout")
        if process.returncode:
            return failure("document_resource_or_worker_failure")
        output = root / "result.json"
        if not output.is_file() or output.stat().st_size > limits.output_bytes:
            return failure("document_output_invalid")
        try:
            result = json.loads(output.read_bytes())
            if not isinstance(result, dict) or not isinstance(result.get("passages"), list):
                raise ValueError()
            if len(result["passages"]) > limits.max_passages:
                raise ValueError()
            if context["mode"] == "hash_only" and any("text" in p for p in result["passages"]):
                raise ValueError()
            return result
        except (ValueError, TypeError, OSError):
            return failure("document_output_invalid")


def extract_document(data: bytes, url: str, source: dict, *, content_type: str,
                     retain_text: bool = False, limits: Limits | None = None) -> dict:
    """Inspect already-retrieved bytes; never fetch embedded links or execute scripts.

    hash_only permits transient HTML parsing under existing metadata-probe scope;
    it does not retain article text. Retained text/PDF parsing require scoped rights.
    Parser success is not factual verification, relevance or complete source coverage.
    """
    limits = (limits or Limits()).validate()
    if type(retain_text) is not bool:
        return failure("invalid_retention_mode")
    if not isinstance(data, bytes):
        return failure("document_bytes_required")
    result = failure("document_not_processed")
    try:
        url = canonical_url(url)
        if not source.get("id"):
            raise CollectorError("document_source_missing")
        media = content_type.split(";", 1)[0].strip().lower()
        is_pdf = data.startswith(b"%PDF-")
        kind = "pdf" if is_pdf or media == "application/pdf" else "html"
        policy = _policy(source, url, kind, retain_text)
        if len(data) > limits.max_bytes:
            raise CollectorError("document_too_large")
        if kind == "pdf" and not is_pdf:
            raise CollectorError("non_pdf_response")
        if kind == "html" and media not in {"text/html", "application/xhtml+xml"}:
            raise CollectorError("unsupported_document_type")
        if policy["mode"] == "permitted_text":
            limits = replace(limits, max_characters=min(limits.max_characters, policy["maxRetainedCharacters"]))
        digest = hashlib.sha256(data).hexdigest()
        result = _run_worker(data, {"source": {"id": source["id"], "allowedHosts": source["allowedHosts"]},
            "url": url, "kind": kind, "contentType": content_type, "mode": policy["mode"],
            "documentHash": digest}, limits)
        if kind == "html":
            body_tags = {"p", "li", "blockquote", "tr", "pre", "dt", "dd"}
            body_passages = [p for p in result["passages"] if p.get("reference", {}).get("tag") in body_tags]
            result["bodyPassageCount"] = len(body_passages)
            result["bodyCharacters"] = sum(p["characters"] for p in body_passages)
            # A headline and subheading are not proof that the article was read.
            if not body_passages and result.get("status") in {"html_text_extracted", "html_text_partial"}:
                result["status"] = "html_body_not_established"
                result["textTraversalComplete"] = False
                result["pendingReasons"] = list(dict.fromkeys(result.get("pendingReasons", []) + ["article_body_not_established"]))
        result.update(sourceId=source["id"], url=url, documentHash=digest, bytes=len(data),
                      parserVersion=PARSER_VERSION, contentPolicy=policy,
                      sourcePublicationNotInferred=True, sourcePublication=None,
                      inspectedAt=datetime.now(timezone.utc).isoformat(),
                      statementVerification="not_performed", semanticCompletenessVerified=False,
                      publishable=False, textRetained=policy["mode"] == "permitted_text" and bool(result["passages"]))
    except CollectorError as exc:
        result = failure(exc.code)
    return result


def fetch_document(item: dict, source: dict, fetcher, *, retain_text=False,
                   limits: Limits | None = None) -> dict:
    """Policy-first attachment/document adapter using the existing restricted transport.

    fetcher is the trusted PublicTransport.get boundary (or an isolated test double).
    A redirected target is policy checked again; production source policies stay off.
    """
    limits = (limits or Limits()).validate()
    try:
        url = allowed_url(item["url"], source.get("allowedHosts", []))
        kind = "pdf" if item.get("kind") == "attachment" or urlsplit(url).path.lower().endswith(".pdf") else "html"
        _policy(source, url, kind, retain_text)
        def guard(target):
            target_kind = "pdf" if kind == "pdf" or urlsplit(target).path.lower().endswith(".pdf") else "html"
            _policy(source, target, target_kind, retain_text)
        resolved, headers, data = fetcher(url, destination_guard=guard)
        allowed_url(resolved, source["allowedHosts"])
        return extract_document(data, resolved, source, content_type=headers.get("content-type", ""),
                                retain_text=retain_text, limits=limits)
    except CollectorError as exc:
        return failure(exc.code)
    except Exception:
        return failure("document_fetch_failed")
