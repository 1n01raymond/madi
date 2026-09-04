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
OUTPUTS = ["scene.json", "geometry.bin", "properties.bin", "report.json"]


def run_adapter(
    output_directory: Path,
    architecture: Path,
    structure: Path,
    preview_directory: Path | None = None,
    cache_directory: Path | None = None,
) -> None:
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
    if preview_directory is not None:
        command.extend(["--structure-preview", str(preview_directory)])
    if cache_directory is not None:
        command.extend(["--document-cache", str(cache_directory)])
    subprocess.run(command, check=True, capture_output=True, text=True)


def federation(tmp_path: Path) -> tuple[Path, Path]:
    """An architecture document deliberately larger than the structure one."""

    architecture = tmp_path / "architecture.ifc"
    structure = tmp_path / "structure.ifc"
    structure.write_bytes(FIXTURE.read_bytes())
    architecture.write_text(
        FIXTURE.read_text("utf-8").replace("Edge Proof Wall", "Much Longer Wall Name"),
        encoding="utf-8",
        newline="\n",
    )
    assert architecture.stat().st_size > structure.stat().st_size
    return architecture, structure


def test_staging_emits_smallest_source_first_and_moves_no_output_byte(
    tmp_path: Path,
) -> None:
    architecture, structure = federation(tmp_path)
    plain = tmp_path / "plain"
    staged = tmp_path / "staged"
    preview_directory = tmp_path / "preview"
    run_adapter(plain, architecture, structure)
    run_adapter(staged, architecture, structure, preview_directory)

    for filename in OUTPUTS:
        assert (plain / filename).read_bytes() == (staged / filename).read_bytes()

    index = json.loads((preview_directory / "index.json").read_text("utf-8"))
    assert index["emissionOrder"] == ["structure", "architecture"]
    assert [item["discipline"] for item in index["documents"]] == [
        "structure",
        "architecture",
    ]
    assert index["complete"] is True

    scene = json.loads((staged / "scene.json").read_text("utf-8"))
    for descriptor in index["documents"]:
        discipline = descriptor["discipline"]
        preview = json.loads(
            (preview_directory / descriptor["path"]).read_text("utf-8")
        )
        occurrences = [
            occurrence
            for occurrence in scene["occurrences"]
            if occurrence["metadata"]["entries"]["discipline"] == discipline
        ]
        assert descriptor["nodeCount"] == len(occurrences)
        assert [node["id"] for node in preview["nodes"]] == [
            occurrence["id"] for occurrence in occurrences
        ]
        assert [node.get("name") for node in preview["nodes"]] == [
            occurrence.get("name") for occurrence in occurrences
        ]
        assert [
            preview["nodes"][node["parent"]]["id"] if node["parent"] is not None else None
            for node in preview["nodes"]
        ] == [occurrence.get("parentId") for occurrence in occurrences]


def test_a_restored_document_publishes_the_tree_extraction_would_have(
    tmp_path: Path,
) -> None:
    architecture, structure = federation(tmp_path)
    cache_directory = tmp_path / "document-cache"
    cold = tmp_path / "cold"
    warm = tmp_path / "warm"
    cold_preview = tmp_path / "cold-preview"
    warm_preview = tmp_path / "warm-preview"
    run_adapter(cold, architecture, structure, cold_preview, cache_directory)
    run_adapter(warm, architecture, structure, warm_preview, cache_directory)

    warm_report = json.loads((warm / "report.json").read_text("utf-8"))
    assert warm_report["documentArtifactCache"]["hits"] == [
        "architecture",
        "structure",
    ]
    for filename in ["index.json", "structure-architecture.json", "structure-structure.json"]:
        assert (cold_preview / filename).read_bytes() == (
            warm_preview / filename
        ).read_bytes()
