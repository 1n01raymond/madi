from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

from structure_preview import (  # noqa: E402
    INDEX_FILENAME,
    STRUCTURE_PREVIEW_INDEX_SCHEMA,
    STRUCTURE_PREVIEW_SCHEMA,
    StructurePreviewPublisher,
    build_structure_preview,
    preview_filename,
    read_structure_preview,
    read_structure_preview_index,
)


def nodes() -> list[tuple[str, str, str | None, str | None]]:
    return [
        ("occurrence:ifc:arch-0123:1", "IfcProject", "Site model", None),
        ("occurrence:ifc:arch-0123:2", "IfcBuilding", None, "occurrence:ifc:arch-0123:1"),
        ("occurrence:ifc:arch-0123:3", "IfcWall", "Wall A", "occurrence:ifc:arch-0123:2"),
    ]


def preview(discipline: str = "architecture") -> dict[str, object]:
    return build_structure_preview(
        discipline=discipline,
        uri_hint=f"{discipline}.ifc",
        document_id=f"document:ifc:{discipline}-0123",
        source_digest="b" * 64,
        source_bytes=2048,
        schema="IFC4",
        nodes=nodes(),
    )


def test_parents_resolve_to_indexes_and_names_are_optional() -> None:
    built = preview()
    assert built["schemaVersion"] == STRUCTURE_PREVIEW_SCHEMA
    assert built["nodes"] == [
        {"id": "occurrence:ifc:arch-0123:1", "type": "IfcProject", "parent": None, "name": "Site model"},
        {"id": "occurrence:ifc:arch-0123:2", "type": "IfcBuilding", "parent": 0},
        {"id": "occurrence:ifc:arch-0123:3", "type": "IfcWall", "parent": 1, "name": "Wall A"},
    ]


def test_duplicate_ids_are_refused() -> None:
    duplicated = [*nodes(), nodes()[0]]
    with pytest.raises(ValueError, match="duplicate node ids"):
        build_structure_preview(
            discipline="architecture",
            uri_hint="architecture.ifc",
            document_id="document:ifc:architecture-0123",
            source_digest="b" * 64,
            source_bytes=2048,
            schema="IFC4",
            nodes=duplicated,
        )


def test_an_unresolvable_parent_is_refused_rather_than_treated_as_a_root() -> None:
    orphaned = [("occurrence:ifc:arch-0123:9", "IfcWall", None, "occurrence:ifc:arch-0123:8")]
    with pytest.raises(ValueError, match="unknown parent"):
        build_structure_preview(
            discipline="architecture",
            uri_hint="architecture.ifc",
            document_id="document:ifc:architecture-0123",
            source_digest="b" * 64,
            source_bytes=2048,
            schema="IFC4",
            nodes=orphaned,
        )


def test_an_empty_index_exists_before_the_first_document(tmp_path: Path) -> None:
    publisher = StructurePreviewPublisher(
        tmp_path / "preview",
        disciplines=["structure", "architecture"],
        emission_order=["architecture", "structure"],
    )
    index = read_structure_preview_index(publisher.directory)
    assert index["schemaVersion"] == STRUCTURE_PREVIEW_INDEX_SCHEMA
    assert index["disciplines"] == ["architecture", "structure"]
    assert index["emissionOrder"] == ["architecture", "structure"]
    assert index["documents"] == []
    assert index["complete"] is False


def test_the_index_names_only_completed_files_and_closes_when_all_arrive(
    tmp_path: Path,
) -> None:
    publisher = StructurePreviewPublisher(
        tmp_path, disciplines=["architecture", "structure"], emission_order=["structure", "architecture"]
    )
    descriptor = publisher.publish(preview("structure"))
    index = read_structure_preview_index(tmp_path)
    assert index["complete"] is False
    assert index["documents"] == [descriptor]
    assert (tmp_path / descriptor["path"]).exists()
    assert not (tmp_path / preview_filename("architecture")).exists()

    publisher.publish(preview("architecture"))
    closed = read_structure_preview_index(tmp_path)
    assert closed["complete"] is True
    assert [item["discipline"] for item in closed["documents"]] == [
        "structure",
        "architecture",
    ]


def test_a_published_tree_verifies_against_the_index(tmp_path: Path) -> None:
    publisher = StructurePreviewPublisher(
        tmp_path, disciplines=["architecture"], emission_order=["architecture"]
    )
    descriptor = publisher.publish(preview())
    stored = (tmp_path / descriptor["path"]).read_bytes()
    assert descriptor["byteLength"] == len(stored)
    assert descriptor["sha256"] == hashlib.sha256(stored).hexdigest()
    assert descriptor["nodeCount"] == 3
    assert descriptor["rootCount"] == 1
    assert read_structure_preview(tmp_path, descriptor)["nodes"][2]["name"] == "Wall A"


def test_a_tampered_tree_is_refused_before_it_is_parsed(tmp_path: Path) -> None:
    publisher = StructurePreviewPublisher(
        tmp_path, disciplines=["architecture"], emission_order=["architecture"]
    )
    descriptor = publisher.publish(preview())
    target = tmp_path / descriptor["path"]
    stored = target.read_bytes()
    target.write_bytes(stored.replace(b"Wall A", b"Wall B"))
    with pytest.raises(ValueError, match="failed digest verification"):
        read_structure_preview(tmp_path, descriptor)

    target.write_bytes(stored + b" ")
    with pytest.raises(ValueError, match="not the"):
        read_structure_preview(tmp_path, descriptor)


def test_publishing_leaves_no_temporary_files_behind(tmp_path: Path) -> None:
    publisher = StructurePreviewPublisher(
        tmp_path, disciplines=["architecture"], emission_order=["architecture"]
    )
    publisher.publish(preview())
    assert sorted(item.name for item in tmp_path.iterdir()) == [
        INDEX_FILENAME,
        preview_filename("architecture"),
    ]


def test_unexpected_and_repeated_disciplines_are_refused(tmp_path: Path) -> None:
    publisher = StructurePreviewPublisher(
        tmp_path, disciplines=["architecture"], emission_order=["architecture"]
    )
    with pytest.raises(ValueError, match="unexpected discipline"):
        publisher.publish(preview("plumbing"))
    publisher.publish(preview())
    with pytest.raises(ValueError, match="already published"):
        publisher.publish(preview())


def test_an_emission_order_that_misses_a_discipline_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="cover every discipline"):
        StructurePreviewPublisher(
            tmp_path, disciplines=["architecture", "structure"], emission_order=["architecture"]
        )


def test_a_foreign_index_schema_is_refused(tmp_path: Path) -> None:
    StructurePreviewPublisher(tmp_path, disciplines=[], emission_order=[])
    index = json.loads((tmp_path / INDEX_FILENAME).read_text(encoding="utf-8"))
    index["schemaVersion"] = "naru.ifc-structure-preview-index.99"
    (tmp_path / INDEX_FILENAME).write_text(json.dumps(index), encoding="utf-8")
    with pytest.raises(ValueError, match="not a naru.ifc-structure-preview-index.1"):
        read_structure_preview_index(tmp_path)
