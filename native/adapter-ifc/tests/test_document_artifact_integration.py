from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("ifcopenshell")

ROOT = Path(__file__).resolve().parents[3]
ADAPTER = ROOT / "native" / "adapter-ifc" / "tools" / "extract_federation_scene_ir.py"
FIXTURE = ROOT / "fixtures" / "ifc" / "explicit-edge-wall.ifc"


def run_adapter(
    output_directory: Path,
    architecture: Path,
    structure: Path,
    cache_directory: Path | None,
) -> dict[str, object]:
    output_directory.mkdir(parents=True)
    command = [
        sys.executable,
        str(ADAPTER),
        "--document",
        f"architecture={architecture}",
        "--uri-hint",
        "architecture=models/architecture.ifc",
        "--document",
        f"structure={structure}",
        "--uri-hint",
        "structure=models/structure.ifc",
        "--scene",
        str(output_directory / "scene.json"),
        "--geometry",
        str(output_directory / "geometry.bin"),
        "--properties",
        str(output_directory / "properties.bin"),
        "--report",
        str(output_directory / "report.json"),
        "--threads",
        "1",
    ]
    if cache_directory is not None:
        command.extend(["--document-cache", str(cache_directory)])
    subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads((output_directory / "report.json").read_text("utf-8"))


def assert_scene_bytes_equal(left: Path, right: Path) -> None:
    for filename in ["scene.json", "geometry.bin", "properties.bin"]:
        assert (left / filename).read_bytes() == (right / filename).read_bytes()


def test_reuses_unchanged_documents_and_matches_clean_federation(tmp_path: Path) -> None:
    architecture = tmp_path / "architecture.ifc"
    structure = tmp_path / "structure.ifc"
    architecture.write_bytes(FIXTURE.read_bytes())
    structure.write_bytes(FIXTURE.read_bytes())
    cache_directory = tmp_path / "document-cache"

    clean = tmp_path / "clean"
    cold = tmp_path / "cold"
    warm = tmp_path / "warm"
    clean_report = run_adapter(clean, architecture, structure, None)
    cold_report = run_adapter(cold, architecture, structure, cache_directory)
    warm_report = run_adapter(warm, architecture, structure, cache_directory)

    assert clean_report["documentArtifactCache"] == {
        "schemaVersion": "naru.ifc-document-artifact.1",
        "status": "disabled",
        "hits": [],
        "misses": [],
    }
    assert cold_report["documentArtifactCache"]["hits"] == []
    assert cold_report["documentArtifactCache"]["misses"] == [
        "architecture",
        "structure",
    ]
    assert warm_report["documentArtifactCache"]["hits"] == [
        "architecture",
        "structure",
    ]
    assert warm_report["documentArtifactCache"]["misses"] == []
    assert_scene_bytes_equal(clean, cold)
    assert_scene_bytes_equal(clean, warm)

    structure.write_text(
        structure.read_text("utf-8").replace(
            "Edge Proof Wall",
            "Changed Edge Proof Wall",
        ),
        encoding="utf-8",
        newline="\n",
    )
    changed_incremental = tmp_path / "changed-incremental"
    changed_clean = tmp_path / "changed-clean"
    changed_report = run_adapter(
        changed_incremental,
        architecture,
        structure,
        cache_directory,
    )
    run_adapter(changed_clean, architecture, structure, None)

    assert changed_report["documentArtifactCache"]["hits"] == ["architecture"]
    assert changed_report["documentArtifactCache"]["misses"] == ["structure"]
    assert_scene_bytes_equal(changed_incremental, changed_clean)
