"""Verified per-document Scene IR artifacts for the IFC federation adapter.

An artifact is one deterministic gzip stream (mtime 0, no embedded file name)
whose decompressed content is a canonical-JSON header line followed by exactly
``payloadBytes`` bytes of canonical payload JSON (UTF-8, sorted keys, compact
separators, no NaN):

    {"key":...,"keyInput":{...},"payloadBytes":N,"payloadSha256":"...",
     "schemaVersion":"naru.ifc-document-artifact.2"}\n
    <payload JSON, exactly N bytes>

The header names what the payload must hash to. A reader checks the schema,
the key, and the key input, hashes the payload bytes it just decompressed, and
parses them only when the length and the digest match: verification is one
read and one hash of the stored bytes, never a re-serialization of the parsed
object (ADR-0019 slice 1). Any file that fails a check is a miss; nothing
executable such as pickle is ever loaded. Publication serializes the payload
once, writes to a temporary sibling, and renames it into place.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

DOCUMENT_ARTIFACT_SCHEMA = "naru.ifc-document-artifact.2"
_SURFACE_POSITION_ALIAS = {"$naruAlias": "surface.positions"}


def _canonical_bytes(value: Any) -> bytes:
    """Serialize `value` as canonical JSON: sorted keys, compact, UTF-8, no NaN."""

    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def document_artifact_key(key_input: dict[str, Any]) -> str:
    return _canonical_sha256(key_input)


def document_artifact_path(
    cache_directory: str | os.PathLike[str],
    key_input: dict[str, Any],
) -> Path:
    return Path(cache_directory) / f"{document_artifact_key(key_input)}.json.gz"


def prepare_document_payload(extracted: dict[str, Any]) -> dict[str, Any]:
    """Remove process-only input and encode shared geometry-list identity."""

    payload = {key: value for key, value in extracted.items() if key != "input"}
    representations = []
    for representation in extracted["representations"]:
        representation_copy = dict(representation)
        surface = representation.get("surface")
        edges = representation.get("edges")
        if surface is not None:
            representation_copy["surface"] = dict(surface)
        if edges is not None:
            edges_copy = dict(edges)
            if surface is not None and edges.get("positions") is surface.get("positions"):
                edges_copy["positions"] = _SURFACE_POSITION_ALIAS
            representation_copy["edges"] = edges_copy
        representations.append(representation_copy)
    payload["representations"] = representations
    return payload


def restore_document_payload(
    payload: dict[str, Any],
    document_input: Any,
) -> dict[str, Any]:
    """Restore process-only input and geometry aliases after JSON loading."""

    for representation in payload["representations"]:
        surface = representation.get("surface")
        edges = representation.get("edges")
        if (
            surface is not None
            and edges is not None
            and edges.get("positions") == _SURFACE_POSITION_ALIAS
        ):
            edges["positions"] = surface["positions"]
    return {"input": document_input, **payload}




class _StoredArtifact:
    """What one read of an artifact file established, before any parsing."""

    __slots__ = ("state", "reason", "header", "payload_bytes", "file_bytes", "load_ms", "verify_ms")

    def __init__(self, state: str, reason: str | None) -> None:
        self.state = state
        self.reason = reason
        self.header: dict[str, Any] | None = None
        self.payload_bytes: bytes | None = None
        self.file_bytes = 0
        self.load_ms = 0.0
        self.verify_ms = 0.0


def _header_failure(header: Any, key: str, key_input: dict[str, Any]) -> str | None:
    if not isinstance(header, dict):
        return "header is not an object"
    if header.get("schemaVersion") != DOCUMENT_ARTIFACT_SCHEMA:
        return "schema mismatch"
    if header.get("key") != key:
        return "key mismatch"
    if header.get("keyInput") != key_input:
        return "key input mismatch"
    payload_bytes = header.get("payloadBytes")
    if isinstance(payload_bytes, bool) or not isinstance(payload_bytes, int) or payload_bytes < 0:
        return "payloadBytes is not a byte count"
    if not isinstance(header.get("payloadSha256"), str):
        return "payloadSha256 is not a digest"
    return None


def _load_stored_artifact(path: Path, key: str, key_input: dict[str, Any]) -> _StoredArtifact:
    """Read one artifact file and verify its stored bytes without parsing the payload."""

    started = time.perf_counter()
    try:
        with gzip.open(path, "rb") as source:
            header_line = source.readline()
            payload = source.read()
        file_bytes = path.stat().st_size
    except FileNotFoundError:
        return _StoredArtifact("absent", None)
    except (OSError, EOFError) as error:
        # Present but not a readable gzip member (corrupt or truncated stream).
        result = _StoredArtifact("invalid", f"unreadable artifact: {type(error).__name__}")
        result.load_ms = (time.perf_counter() - started) * 1000.0
        return result
    result = _StoredArtifact("invalid", None)
    result.file_bytes = file_bytes
    result.load_ms = (time.perf_counter() - started) * 1000.0
    started = time.perf_counter()
    try:
        header = json.loads(header_line)
    except (UnicodeDecodeError, json.JSONDecodeError):
        header = None
    failure = _header_failure(header, key, key_input)
    if failure is None and len(payload) != header["payloadBytes"]:
        failure = "payload length mismatch"
    if failure is None and hashlib.sha256(payload).hexdigest() != header["payloadSha256"]:
        failure = "payload digest mismatch"
    result.verify_ms = (time.perf_counter() - started) * 1000.0
    if failure is not None:
        result.reason = failure
        return result
    result.state = "verified"
    result.header = header
    result.payload_bytes = payload
    return result


def read_document_artifact(
    cache_directory: str | os.PathLike[str],
    key_input: dict[str, Any],
    timing: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Return the verified payload for `key_input`, or None when it must be re-extracted.

    `timing`, when given, receives the load/verify/parse split, the stored
    byte counts, and `artifactState` (`verified`, `invalid`, or `absent`).
    """

    path = document_artifact_path(cache_directory, key_input)
    stored = _load_stored_artifact(path, document_artifact_key(key_input), key_input)
    if timing is not None:
        timing["artifactState"] = stored.state
        if stored.state != "absent":
            timing["artifactLoadMilliseconds"] = stored.load_ms
            timing["artifactBytes"] = stored.file_bytes
            timing["artifactVerifyMilliseconds"] = stored.verify_ms
        if stored.reason is not None:
            timing["artifactInvalidReason"] = stored.reason
    if stored.state != "verified" or stored.payload_bytes is None:
        return None
    started = time.perf_counter()
    try:
        payload = json.loads(stored.payload_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = None
    parse_ms = (time.perf_counter() - started) * 1000.0
    if not isinstance(payload, dict):
        if timing is not None:
            timing["artifactState"] = "invalid"
            timing["artifactInvalidReason"] = "payload is not a JSON object"
        return None
    if timing is not None:
        timing["artifactPayloadBytes"] = len(stored.payload_bytes)
        timing["artifactParseMilliseconds"] = parse_ms
    return payload


def publish_document_artifact(
    cache_directory: str | os.PathLike[str],
    key_input: dict[str, Any],
    payload: dict[str, Any],
) -> Path:
    """Write the artifact for `key_input` atomically; idempotent for an identical payload.

    The payload is serialized exactly once. An existing artifact whose stored
    bytes verify and name the same digest is kept; one naming a different
    digest is an error (one key must never mean two payloads); one that fails
    verification is overwritten.
    """

    if not isinstance(payload, dict):
        raise TypeError("IFC document artifact payload must be a JSON object.")
    directory = Path(cache_directory)
    directory.mkdir(parents=True, exist_ok=True)
    key = document_artifact_key(key_input)
    path = directory / f"{key}.json.gz"
    payload_bytes = _canonical_bytes(payload)
    payload_sha256 = hashlib.sha256(payload_bytes).hexdigest()
    existing = _load_stored_artifact(path, key, key_input)
    if existing.state == "verified" and existing.header is not None:
        if existing.header["payloadSha256"] != payload_sha256:
            raise ValueError("IFC document artifact key produced two different payloads.")
        return path
    del existing
    header_line = _canonical_bytes(
        {
            "schemaVersion": DOCUMENT_ARTIFACT_SCHEMA,
            "key": key,
            "keyInput": key_input,
            "payloadBytes": len(payload_bytes),
            "payloadSha256": payload_sha256,
        }
    ) + b"\n"
    descriptor, temporary_name = tempfile.mkstemp(
        dir=directory, prefix=f".{path.stem}-", suffix=".tmp"
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as raw_output:
            with gzip.GzipFile(
                filename="", mode="wb", fileobj=raw_output, mtime=0
            ) as compressed:
                compressed.write(header_line)
                compressed.write(payload_bytes)
            raw_output.flush()
            os.fsync(raw_output.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return path
