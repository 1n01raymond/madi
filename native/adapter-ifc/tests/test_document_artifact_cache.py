from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

from document_artifact_cache import (  # noqa: E402
    DOCUMENT_ARTIFACT_SCHEMA,
    document_artifact_key,
    document_artifact_path,
    prepare_document_payload,
    publish_document_artifact,
    read_document_artifact,
    restore_document_payload,
)


def key_input(digest: str = "a" * 64) -> dict[str, object]:
    return {
        "schemaVersion": "naru.ifc-document-artifact-key.1",
        "discipline": "architecture",
        "sourceDigest": digest,
        "uriHint": "models/architecture.ifc",
        "threads": 4,
        "adapterFingerprint": "b" * 64,
    }


def extracted_document() -> dict[str, object]:
    positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    return {
        "input": object(),
        "sourceDigest": "a" * 64,
        "timestamp": "1970-01-01T00:00:00.000Z",
        "document": {"id": "document:architecture"},
        "semantics": [],
        "prototypes": [],
        "occurrences": [],
        "representations": [
            {
                "id": "representation:wall",
                "surface": {"positions": positions, "indices": [0, 1]},
                "edges": {"positions": positions, "segments": [0, 1]},
            }
        ],
        "materials": [],
        "diagnostics": [],
        "counts": {"prototypeCount": 1},
        "prototypeReuse": [],
    }


def test_publishes_deterministic_verified_artifact(tmp_path: Path) -> None:
    first_directory = tmp_path / "first"
    second_directory = tmp_path / "second"
    payload = prepare_document_payload(extracted_document())

    first_path = publish_document_artifact(first_directory, key_input(), payload)
    second_path = publish_document_artifact(second_directory, key_input(), payload)

    assert first_path.read_bytes() == second_path.read_bytes()
    assert read_document_artifact(first_directory, key_input()) == payload


def test_restores_shared_surface_edge_positions(tmp_path: Path) -> None:
    payload = prepare_document_payload(extracted_document())
    publish_document_artifact(tmp_path, key_input(), payload)

    loaded = read_document_artifact(tmp_path, key_input())
    assert loaded is not None
    document_input = object()
    restored = restore_document_payload(loaded, document_input)
    representation = restored["representations"][0]

    assert restored["input"] is document_input
    assert representation["edges"]["positions"] is representation["surface"]["positions"]


def test_corruption_and_identity_changes_are_cache_misses(tmp_path: Path) -> None:
    payload = prepare_document_payload(extracted_document())
    artifact_path = publish_document_artifact(tmp_path, key_input(), payload)
    artifact_path.write_bytes(b"corrupted")

    assert read_document_artifact(tmp_path, key_input()) is None
    assert read_document_artifact(tmp_path, key_input("c" * 64)) is None
    assert document_artifact_path(tmp_path, key_input("c" * 64)) != artifact_path

    renamed_uri = {**key_input(), "uriHint": "models/architecture-renamed.ifc"}
    renamed_discipline = {**key_input(), "discipline": "architecture-core"}
    assert read_document_artifact(tmp_path, renamed_uri) is None
    assert read_document_artifact(tmp_path, renamed_discipline) is None

    publish_document_artifact(tmp_path, key_input(), payload)
    assert read_document_artifact(tmp_path, key_input()) == payload

    different_payload = {**payload, "sourceDigest": "different"}
    with pytest.raises(ValueError, match="two different payloads"):
        publish_document_artifact(tmp_path, key_input(), different_payload)


def test_read_reports_load_and_verify_stages_without_changing_the_verdict(
    tmp_path: Path,
) -> None:
    payload = prepare_document_payload(extracted_document())
    artifact_path = publish_document_artifact(tmp_path, key_input(), payload)

    verified: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input(), verified) == payload
    assert verified["artifactState"] == "verified"
    assert verified["artifactBytes"] == artifact_path.stat().st_size
    assert verified["artifactLoadMilliseconds"] >= 0
    assert verified["artifactVerifyMilliseconds"] >= 0
    assert verified["artifactParseMilliseconds"] >= 0
    assert verified["artifactPayloadBytes"] > 0

    absent: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input("c" * 64), absent) is None
    assert absent["artifactState"] == "absent"
    assert "artifactVerifyMilliseconds" not in absent

    artifact_path.write_bytes(b"corrupted")
    corrupted: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input(), corrupted) is None
    assert corrupted["artifactState"] == "invalid"
    assert corrupted["artifactInvalidReason"].startswith("unreadable artifact")
    assert "artifactParseMilliseconds" not in corrupted


def _decompress(artifact_path: Path) -> tuple[dict[str, object], bytes]:
    with gzip.open(artifact_path, "rb") as source:
        header = json.loads(source.readline())
        body = source.read()
    return header, body


def test_artifact_is_a_header_line_over_the_stored_payload_bytes(tmp_path: Path) -> None:
    payload = prepare_document_payload(extracted_document())
    artifact_path = publish_document_artifact(tmp_path, key_input(), payload)
    header, body = _decompress(artifact_path)

    assert header["schemaVersion"] == DOCUMENT_ARTIFACT_SCHEMA
    assert header["key"] == document_artifact_key(key_input())
    assert header["keyInput"] == key_input()
    assert header["payloadBytes"] == len(body)
    assert header["payloadSha256"] == hashlib.sha256(body).hexdigest()
    assert json.loads(body) == payload
    # The payload is canonical JSON, so the header digest is reproducible from the object.
    canonical = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False
    ).encode("utf-8")
    assert body == canonical


def _rewrite(artifact_path: Path, header: dict[str, object], body: bytes) -> None:
    line = json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8") + b"\n"
    with gzip.GzipFile(filename="", mode="wb", fileobj=artifact_path.open("wb"), mtime=0) as out:
        out.write(line + body)


def test_stored_byte_verification_rejects_tampering_truncation_and_old_envelopes(
    tmp_path: Path,
) -> None:
    payload = prepare_document_payload(extracted_document())
    artifact_path = publish_document_artifact(tmp_path, key_input(), payload)
    original = artifact_path.read_bytes()
    header, body = _decompress(artifact_path)

    def state_after(rewrite_header: dict[str, object], rewrite_body: bytes) -> dict[str, object]:
        _rewrite(artifact_path, rewrite_header, rewrite_body)
        timing: dict[str, object] = {}
        assert read_document_artifact(tmp_path, key_input(), timing) is None
        assert timing["artifactState"] == "invalid"
        return timing

    flipped = bytearray(body)
    flipped[len(flipped) // 2] ^= 0x01
    assert state_after(header, bytes(flipped))["artifactInvalidReason"] == "payload digest mismatch"
    assert state_after(header, body[:-1])["artifactInvalidReason"] == "payload length mismatch"
    assert state_after({**header, "schemaVersion": "naru.ifc-document-artifact.1"}, body)[
        "artifactInvalidReason"
    ] == "schema mismatch"
    assert state_after({**header, "key": "0" * 64}, body)["artifactInvalidReason"] == "key mismatch"

    # A `.1`-shaped envelope (one JSON object, no header line) is a miss, never parsed as a payload.
    envelope = {"schemaVersion": "naru.ifc-document-artifact.1", "payload": payload}
    with gzip.GzipFile(filename="", mode="wb", fileobj=artifact_path.open("wb"), mtime=0) as out:
        out.write(json.dumps(envelope).encode("utf-8"))
    old: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input(), old) is None
    assert old["artifactState"] == "invalid"

    # A gzip stream cut mid-member is unreadable, and therefore invalid rather than absent.
    whole = artifact_path.read_bytes()
    artifact_path.write_bytes(whole[: len(whole) // 2])
    cut: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input(), cut) is None
    assert cut["artifactState"] == "invalid"

    # Republishing over any invalid artifact restores a verified one with the same bytes.
    assert publish_document_artifact(tmp_path, key_input(), payload) == artifact_path
    assert artifact_path.read_bytes() == original
    assert read_document_artifact(tmp_path, key_input()) == payload
