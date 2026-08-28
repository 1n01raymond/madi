"""Verified, deterministic cache storage for one extracted IFC document.

Pure Python by design: unit tests do not need IfcOpenShell. Cached payloads are
JSON rather than pickle because cache files are untrusted derived data and must
never execute code while loading.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, TextIO


DOCUMENT_ARTIFACT_SCHEMA = "naru.ifc-document-artifact.1"
_SURFACE_POSITION_ALIAS = {"$naruAlias": "surface.positions"}


class _HashTextSink:
    def __init__(self) -> None:
        self.digest = hashlib.sha256()

    def write(self, value: str) -> int:
        encoded = value.encode("utf-8")
        self.digest.update(encoded)
        return len(value)


def _dump_canonical(value: Any, sink: TextIO | _HashTextSink) -> None:
    json.dump(
        value,
        sink,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def _canonical_sha256(value: Any) -> str:
    sink = _HashTextSink()
    _dump_canonical(value, sink)
    return sink.digest.hexdigest()


def document_artifact_key(key_input: dict[str, Any]) -> str:
    return _canonical_sha256(key_input)


def document_artifact_path(
    cache_directory: Path,
    key_input: dict[str, Any],
) -> Path:
    return cache_directory / f"{document_artifact_key(key_input)}.json.gz"


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


def read_document_artifact(
    cache_directory: Path,
    key_input: dict[str, Any],
) -> dict[str, Any] | None:
    path = document_artifact_path(cache_directory, key_input)
    try:
        with gzip.open(path, "rt", encoding="utf-8") as source:
            envelope = json.load(source)
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return None
    if (
        not isinstance(envelope, dict)
        or envelope.get("schemaVersion") != DOCUMENT_ARTIFACT_SCHEMA
        or envelope.get("key") != document_artifact_key(key_input)
        or envelope.get("keyInput") != key_input
        or not isinstance(envelope.get("payload"), dict)
        or envelope.get("payloadSha256") != _canonical_sha256(envelope["payload"])
    ):
        return None
    return envelope["payload"]


def publish_document_artifact(
    cache_directory: Path,
    key_input: dict[str, Any],
    payload: dict[str, Any],
) -> Path:
    cache_directory.mkdir(parents=True, exist_ok=True)
    destination = document_artifact_path(cache_directory, key_input)
    existing = read_document_artifact(cache_directory, key_input)
    if existing is not None:
        if _canonical_sha256(existing) != _canonical_sha256(payload):
            raise ValueError(
                "IFC document artifact key produced two different payloads."
            )
        return destination
    envelope = {
        "schemaVersion": DOCUMENT_ARTIFACT_SCHEMA,
        "key": document_artifact_key(key_input),
        "keyInput": key_input,
        "payload": payload,
        "payloadSha256": _canonical_sha256(payload),
    }
    descriptor, temporary_name = tempfile.mkstemp(
        dir=cache_directory,
        prefix=f".{destination.stem}-",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "wb") as raw_output:
            with gzip.GzipFile(
                filename="",
                mode="wb",
                fileobj=raw_output,
                mtime=0,
            ) as compressed:
                text_output = _Utf8TextWriter(compressed)
                _dump_canonical(envelope, text_output)
                text_output.flush()
            raw_output.flush()
            os.fsync(raw_output.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return destination


class _Utf8TextWriter:
    def __init__(self, output: Any) -> None:
        self.output = output

    def write(self, value: str) -> int:
        self.output.write(value.encode("utf-8"))
        return len(value)

    def flush(self) -> None:
        self.output.flush()
