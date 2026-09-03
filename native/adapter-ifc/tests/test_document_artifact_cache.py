from __future__ import annotations

import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

from document_artifact_cache import (  # noqa: E402
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

    absent: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input("c" * 64), absent) is None
    assert absent["artifactState"] == "absent"
    assert "artifactVerifyMilliseconds" not in absent

    artifact_path.write_bytes(b"corrupted")
    corrupted: dict[str, object] = {}
    assert read_document_artifact(tmp_path, key_input(), corrupted) is None
    assert corrupted["artifactState"] == "absent"
