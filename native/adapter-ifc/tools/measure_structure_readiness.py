"""Measure how early an IFC federation's assembly tree could be published.

The staged-preview design in ADR-0021 rests on one number: how long a document
takes to reach a hierarchy payload that a viewer could open, without tessellating
anything. This tool measures that path end to end for each document -- raw byte
scan, IfcOpenShell parse, spatial-structure walk, and JSON serialization of the
resulting tree -- and reports the durations and counts as JSON.

It is a measurement tool, not part of an import. It never writes into a package,
a cache, or a report, and it reads each document in its own pass so peak memory
stays near a single document.
"""

from __future__ import annotations

import argparse
import gc
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ifcopenshell

SCHEMA_VERSION = "naru.ifc-structure-readiness.1"
DISCIPLINE_PATTERN = re.compile(r"[a-z][a-z0-9-]{0,31}")
SCAN_BLOCK_BYTES = 8 << 20

# The entity keywords a streaming pre-scan would have to find. Counting them is
# not the design -- it bounds how fast the bytes themselves can be traversed, so
# the record can separate parsing cost from I/O cost.
SCAN_KEYS = (
    b"IFCRELAGGREGATES",
    b"IFCRELCONTAINEDINSPATIALSTRUCTURE",
    b"IFCBUILDINGSTOREY",
)


@dataclass(frozen=True)
class DocumentInput:
    discipline: str
    path: Path


def parse_inputs(values: list[str]) -> list[DocumentInput]:
    documents: list[DocumentInput] = []
    disciplines: set[str] = set()
    for value in values:
        discipline, separator, path_value = value.partition("=")
        if not separator or not DISCIPLINE_PATTERN.fullmatch(discipline) or not path_value:
            raise ValueError(f"Invalid --document value {value!r}; expected discipline=path.ifc.")
        if discipline in disciplines:
            raise ValueError(f"Duplicate discipline {discipline}.")
        path = Path(path_value).resolve(strict=True)
        if path.suffix.lower() != ".ifc" or not path.is_file():
            raise ValueError(f"IFC document must be a regular .ifc file: {path}")
        documents.append(DocumentInput(discipline=discipline, path=path))
        disciplines.add(discipline)
    return sorted(documents, key=lambda item: item.discipline)


def scan_bytes(path: Path) -> tuple[float, int, list[int]]:
    """Read the whole file and count the spatial keywords, parsing nothing."""
    started = time.perf_counter()
    counts = [0] * len(SCAN_KEYS)
    total = 0
    with path.open("rb") as handle:
        while True:
            block = handle.read(SCAN_BLOCK_BYTES)
            if not block:
                break
            total += len(block)
            for index, key in enumerate(SCAN_KEYS):
                counts[index] += block.count(key)
    return (time.perf_counter() - started) * 1000.0, total, counts


def walk_structure(model: Any) -> tuple[float, list[dict[str, Any]], int, int]:
    """Build the assembly tree from attributes and relationships only.

    This is the same containment IFC exposes to any viewer: `IfcRelAggregates`
    for decomposition and `IfcRelContainedInSpatialStructure` for the elements a
    storey holds. No representation is evaluated, so nothing here tessellates.
    """
    started = time.perf_counter()
    parents: dict[int, int] = {}
    subjects: dict[int, Any] = {}
    spatial_relations = 0
    containment_relations = 0

    for relation in model.by_type("IfcRelAggregates"):
        parent = relation.RelatingObject
        if parent is None:
            continue
        spatial_relations += 1
        subjects[parent.id()] = parent
        for child in relation.RelatedObjects or ():
            subjects[child.id()] = child
            parents[child.id()] = parent.id()
    for relation in model.by_type("IfcRelContainedInSpatialStructure"):
        parent = relation.RelatingStructure
        if parent is None:
            continue
        containment_relations += 1
        subjects[parent.id()] = parent
        for child in relation.RelatedElements or ():
            subjects[child.id()] = child
            parents[child.id()] = parent.id()

    entries: list[dict[str, Any]] = []
    index_of: dict[int, int] = {}
    for identifier in sorted(subjects):
        entity = subjects[identifier]
        index_of[identifier] = len(entries)
        entries.append(
            {
                "globalId": getattr(entity, "GlobalId", None),
                "type": entity.is_a(),
                "name": getattr(entity, "Name", None),
                "parent": None,
            }
        )
    for identifier, parent_identifier in parents.items():
        entries[index_of[identifier]]["parent"] = index_of.get(parent_identifier)
    return (
        (time.perf_counter() - started) * 1000.0,
        entries,
        spatial_relations,
        containment_relations,
    )


def measure_document(document: DocumentInput) -> dict[str, Any]:
    gc.collect()
    scan_milliseconds, source_bytes, scan_counts = scan_bytes(document.path)
    opened = time.perf_counter()
    model = ifcopenshell.open(str(document.path))
    open_milliseconds = (time.perf_counter() - opened) * 1000.0
    walk_milliseconds, entries, aggregates, containments = walk_structure(model)
    serialized = time.perf_counter()
    payload = json.dumps(entries, separators=(",", ":")).encode("utf8")
    serialize_milliseconds = (time.perf_counter() - serialized) * 1000.0
    schema = model.schema
    del model
    roots = sum(1 for entry in entries if entry["parent"] is None)
    return {
        "discipline": document.discipline,
        "schema": schema,
        "sourceBytes": source_bytes,
        "scanMilliseconds": round(scan_milliseconds, 1),
        "openMilliseconds": round(open_milliseconds, 1),
        "walkMilliseconds": round(walk_milliseconds, 1),
        "serializeMilliseconds": round(serialize_milliseconds, 1),
        "readyMilliseconds": round(
            open_milliseconds + walk_milliseconds + serialize_milliseconds, 1
        ),
        "structureEntries": len(entries),
        "structureRoots": roots,
        "aggregateRelations": aggregates,
        "containmentRelations": containments,
        "structurePayloadBytes": len(payload),
        "scanKeywordCounts": dict(
            zip((key.decode("ascii") for key in SCAN_KEYS), scan_counts, strict=True)
        ),
    }


def schedule_makespan(durations: list[float], threads: int) -> float:
    """Longest-processing-time-first makespan over already measured durations.

    This is arithmetic on measurements, not a measurement: it says what a pool of
    `threads` workers would finish in if each document cost exactly what it cost
    here and nothing contended. The record labels it as an estimate.
    """
    lanes = [0.0] * max(1, threads)
    for duration in sorted(durations, reverse=True):
        lanes.sort()
        lanes[0] += duration
    return max(lanes)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document", action="append", default=[], required=True)
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    documents = parse_inputs(arguments.document)
    if arguments.threads < 1:
        parser.error("--threads must be at least one.")

    measured = [measure_document(document) for document in documents]
    ready = [float(row["readyMilliseconds"]) for row in measured]
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "ifcopenshellVersion": ifcopenshell.version,
        "pythonVersion": sys.version.split()[0],
        "threads": arguments.threads,
        "documents": measured,
        "federation": {
            "documentCount": len(measured),
            "sourceBytes": sum(int(row["sourceBytes"]) for row in measured),
            "structureEntries": sum(int(row["structureEntries"]) for row in measured),
            "structurePayloadBytes": sum(int(row["structurePayloadBytes"]) for row in measured),
            "scanMilliseconds": round(sum(float(row["scanMilliseconds"]) for row in measured), 1),
            "sequentialReadyMilliseconds": round(sum(ready), 1),
            "firstDocumentReadyMilliseconds": round(min(ready), 1),
            "slowestDocumentReadyMilliseconds": round(max(ready), 1),
            "estimatedThreadedMakespanMilliseconds": round(
                schedule_makespan(ready, arguments.threads), 1
            ),
            "makespanMethod": "longest-processing-time-first-schedule-of-measured-durations",
        },
    }
    text = json.dumps(result, indent=2, sort_keys=False) + "\n"
    if arguments.output is None:
        sys.stdout.write(text)
    else:
        arguments.output.write_bytes(text.encode("utf8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
