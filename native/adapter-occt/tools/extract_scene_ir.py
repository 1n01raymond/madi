"""Extract deterministic Phase 0 Scene IR evidence from a STEP assembly.

This harness uses CadQuery's OCP binding to exercise OCCT STEPCAF/XDE on hosts
that do not yet have a native C++ toolchain. It is evidence for the adapter
boundary, not a stable serialized MADI format or the production adapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from importlib.metadata import version
from pathlib import Path
from typing import Any, Iterable, Sequence

import OCP
import cadquery as cq


IDENTITY_MATRIX = [
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
]
EMPTY_PROPERTIES = {"entries": {}}
ROOT_FRAME = {
    "origin": [0.0, 0.0, 0.0],
    "basis": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
    "handedness": "right",
    "upAxis": "Z",
}


def rounded(value: float) -> float:
    result = round(float(value), 9)
    return 0.0 if result == 0 else result


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "unnamed"


def vector_values(vector: cq.Vector) -> list[float]:
    return [rounded(vector.x), rounded(vector.y), rounded(vector.z)]


def location_matrix(location: cq.Location | None) -> list[float]:
    if location is None:
        return list(IDENTITY_MATRIX)

    transform = location.wrapped.Transformation()
    # Scene IR and WebGPU use column-major matrices. gp_Trsf exposes row/column
    # coefficients, with translation in column 4.
    return [
        rounded(transform.Value(1, 1)),
        rounded(transform.Value(2, 1)),
        rounded(transform.Value(3, 1)),
        0.0,
        rounded(transform.Value(1, 2)),
        rounded(transform.Value(2, 2)),
        rounded(transform.Value(3, 2)),
        0.0,
        rounded(transform.Value(1, 3)),
        rounded(transform.Value(2, 3)),
        rounded(transform.Value(3, 3)),
        0.0,
        rounded(transform.Value(1, 4)),
        rounded(transform.Value(2, 4)),
        rounded(transform.Value(3, 4)),
        1.0,
    ]


def transform_point(matrix: Sequence[float], point: Sequence[float]) -> list[float]:
    x, y, z = point
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ]


def bounds_corners(bounds: dict[str, list[float]]) -> Iterable[list[float]]:
    for x in (bounds["min"][0], bounds["max"][0]):
        for y in (bounds["min"][1], bounds["max"][1]):
            for z in (bounds["min"][2], bounds["max"][2]):
                yield [x, y, z]


def merge_bounds(points: Iterable[Sequence[float]]) -> dict[str, list[float]]:
    values = list(points)
    if not values:
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {
        "min": [rounded(min(point[axis] for point in values)) for axis in range(3)],
        "max": [rounded(max(point[axis] for point in values)) for axis in range(3)],
    }


def shape_bounds(shape: cq.Shape) -> dict[str, list[float]]:
    bounds = shape.BoundingBox()
    return {
        "min": [rounded(bounds.xmin), rounded(bounds.ymin), rounded(bounds.zmin)],
        "max": [rounded(bounds.xmax), rounded(bounds.ymax), rounded(bounds.zmax)],
    }


def node_bounds(node: cq.Assembly) -> dict[str, list[float]]:
    if node.obj is not None:
        return shape_bounds(node.obj)

    points: list[list[float]] = []
    for child in node.children:
        child_bounds = node_bounds(child)
        matrix = location_matrix(child.loc)
        points.extend(transform_point(matrix, corner) for corner in bounds_corners(child_bounds))
    return merge_bounds(points)


def triangle_normal(a: cq.Vector, b: cq.Vector, c: cq.Vector) -> list[float]:
    ab = (b.x - a.x, b.y - a.y, b.z - a.z)
    ac = (c.x - a.x, c.y - a.y, c.z - a.z)
    cross = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    length = math.sqrt(sum(component * component for component in cross))
    if length <= 1e-15:
        return [0.0, 0.0, 1.0]
    return [rounded(component / length) for component in cross]


def edge_kind(edge: cq.Edge) -> str:
    value = str(edge.geomType()).split(".")[-1].lower()
    if "line" in value:
        return "line"
    if "circle" in value:
        return "circle"
    if "ellipse" in value:
        return "ellipse"
    if "spline" in value or "bezier" in value:
        return "bspline"
    return "other"


def tessellate_shape(
    shape: cq.Shape,
    prototype_id: str,
    document_id: str,
    neutral_material_id: str,
    linear_tolerance: float,
    angular_tolerance: float,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, int]]:
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    face_source_ids: list[int] = []
    edge_positions: list[float] = []
    edge_segments: list[int] = []
    edge_classes: list[int] = []
    edge_source_ids: list[int] = []
    curve_hints: list[dict[str, Any]] = []
    source_refs: list[dict[str, Any]] = []
    source_ref_ids: list[str] = []

    faces = shape.Faces()
    for face_index, face in enumerate(faces):
        source_ref_id = f"source:{prototype_id}:face:{face_index:03d}"
        source_refs.append(
            {
                "id": source_ref_id,
                "documentId": document_id,
                "namespace": "occt-xde",
                "value": f"{prototype_id}:face:{face_index}",
                "kind": "face",
                "stability": "revision-local",
            }
        )
        source_ref_ids.append(source_ref_id)
        vertices, triangles = face.tessellate(linear_tolerance, angular_tolerance)
        for triangle in triangles:
            a, b, c = (vertices[index] for index in triangle)
            normal = triangle_normal(a, b, c)
            first_index = len(positions) // 3
            for vertex in (a, b, c):
                positions.extend(vector_values(vertex))
                normals.extend(normal)
            indices.extend([first_index, first_index + 1, first_index + 2])
            face_source_ids.append(face_index)

    edges = shape.Edges()
    for edge_index, edge in enumerate(edges):
        source_ref_id = f"source:{prototype_id}:edge:{edge_index:03d}"
        source_refs.append(
            {
                "id": source_ref_id,
                "documentId": document_id,
                "namespace": "occt-xde",
                "value": f"{prototype_id}:edge:{edge_index}",
                "kind": "edge",
                "stability": "revision-local",
            }
        )
        source_ref_ids.append(source_ref_id)
        curve_hints.append({"kind": edge_kind(edge), "sourceRef": source_ref_id})
        vertices, _ = edge.sample(float(linear_tolerance))
        base_index = len(edge_positions) // 3
        for vertex in vertices:
            edge_positions.extend(vector_values(vertex))
        source_map_index = len(faces) + edge_index
        for segment_index in range(max(0, len(vertices) - 1)):
            edge_segments.extend([base_index + segment_index, base_index + segment_index + 1])
            edge_classes.append(0)
            edge_source_ids.append(source_map_index)

    bounds = shape_bounds(shape)
    representation = {
        "id": f"representation:{prototype_id}:display",
        "prototypeId": prototype_id,
        "purpose": "display",
        "accuracy": {
            "kind": "tessellated",
            "linearTolerance": linear_tolerance,
            "angularTolerance": angular_tolerance,
            "unit": "mm",
            "notes": ["Generated from OCCT B-rep by the Phase 0 XDE evidence harness."],
        },
        "localFrame": ROOT_FRAME,
        "surface": {
            "primitive": "triangles",
            "positions": positions,
            "indices": indices,
            "normals": normals,
            "faceSourceIds": face_source_ids,
            "materialGroups": [
                {
                    "firstIndex": 0,
                    "indexCount": len(indices),
                    "materialId": neutral_material_id,
                }
            ],
        },
        "edges": {
            "positions": edge_positions,
            "segments": edge_segments,
            "classes": edge_classes,
            "sourceIds": edge_source_ids,
            "curveHints": curve_hints,
        },
        "bounds": bounds,
        "sourceMap": {
            "sourceRefs": source_ref_ids,
            "faceSourceIndices": face_source_ids,
            "edgeSourceIndices": edge_source_ids,
        },
    }
    metrics = {
        "faces": len(faces),
        "edges": len(edges),
        "triangles": len(indices) // 3,
        "edgeSegments": len(edge_segments) // 2,
    }
    return representation, source_refs, metrics


def source_timestamp(source_text: str) -> str:
    match = re.search(r"FILE_NAME\('[^']*','([^']+)'", source_text)
    if not match:
        return "1970-01-01T00:00:00.000Z"
    timestamp = match.group(1)
    return f"{timestamp}.000Z" if not timestamp.endswith("Z") else timestamp


def material_id_for(color: Sequence[float]) -> str:
    channels = [max(0, min(255, round(channel * 255))) for channel in color[:3]]
    return "material:rgb-" + "".join(f"{channel:02x}" for channel in channels)


def extract(
    source: Path,
    linear_tolerance: float,
    angular_tolerance: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    source_bytes = source.read_bytes()
    source_text = source_bytes.decode("utf-8")
    source_digest = hashlib.sha256(source_bytes).hexdigest()
    options_text = (
        f"linearTolerance={linear_tolerance:.9g};"
        f"angularTolerance={angular_tolerance:.9g};units=mm"
    )
    options_digest = hashlib.sha256(options_text.encode("utf-8")).hexdigest()
    document_id = f"document:sha256:{source_digest[:16]}"
    document_ref_id = f"source:{document_id}:document"
    neutral_material_id = "material:neutral"

    assembly = cq.Assembly.importStep(str(source))
    source_refs: list[dict[str, Any]] = [
        {
            "id": document_ref_id,
            "documentId": document_id,
            "namespace": "sha256",
            "value": source_digest,
            "kind": "document",
            "stability": "persistent",
        }
    ]
    prototypes: list[dict[str, Any]] = []
    occurrences: list[dict[str, Any]] = []
    semantics: list[dict[str, Any]] = []
    representations: list[dict[str, Any]] = []
    materials: dict[str, dict[str, Any]] = {
        neutral_material_id: {
            "id": neutral_material_id,
            "name": "MADI neutral",
            "baseColor": [0.55, 0.62, 0.68, 1.0],
            "metallic": 0.05,
            "roughness": 0.72,
            "edgeStyle": {"color": [0.025, 0.045, 0.06, 1.0], "width": 1.0},
        }
    }
    part_prototype_ids: dict[int, str] = {}
    prototype_records: dict[str, dict[str, Any]] = {}
    prototype_metrics: dict[str, dict[str, int]] = {}
    prototype_occurrences: dict[str, list[str]] = {}

    def register_material(color: cq.Color | None) -> str | None:
        if color is None:
            return None
        values = [rounded(channel) for channel in color.toTuple()]
        material_id = material_id_for(values)
        materials.setdefault(
            material_id,
            {
                "id": material_id,
                "name": material_id.removeprefix("material:"),
                "baseColor": values,
                "metallic": 0.08,
                "roughness": 0.62,
                "edgeStyle": {"color": [0.025, 0.045, 0.06, 1.0], "width": 1.0},
            },
        )
        return material_id

    def walk(
        node: cq.Assembly,
        path: tuple[str, ...],
        parent_occurrence_id: str | None,
        parent_prototype_id: str | None,
        depth: int,
    ) -> None:
        node_name = node.name or "unnamed"
        node_path = (*path, node_name)
        path_value = "/".join(slug(part) for part in node_path)
        occurrence_id = f"occurrence:{path_value}"

        if node.obj is None:
            prototype_id = f"prototype:assembly:{path_value}"
        else:
            shape_key = node.obj.hashCode()
            prototype_id = part_prototype_ids.get(shape_key, "")
            if not prototype_id:
                prototype_id = f"prototype:part:{slug(node_name)}"
                suffix = 2
                original_id = prototype_id
                while prototype_id in prototype_records:
                    prototype_id = f"{original_id}-{suffix}"
                    suffix += 1
                part_prototype_ids[shape_key] = prototype_id

        semantic_id = f"semantic:{prototype_id}"
        prototype_source_ref = f"source:{prototype_id}"
        occurrence_source_ref = f"source:{occurrence_id}"
        source_refs.append(
            {
                "id": occurrence_source_ref,
                "documentId": document_id,
                "namespace": "occt-xde:name-path",
                "value": path_value,
                "kind": "assembly-node",
                "stability": "revision-local",
            }
        )

        if prototype_id not in prototype_records:
            kind = "assembly" if node.obj is None else "part"
            source_refs.append(
                {
                    "id": prototype_source_ref,
                    "documentId": document_id,
                    "namespace": "occt-xde:prototype",
                    "value": prototype_id,
                    "kind": "assembly-node" if kind == "assembly" else "part",
                    "stability": "revision-local",
                }
            )
            representation_ids: list[str] = []
            metadata_entries: dict[str, Any] = {"sourceKind": kind}
            if node.obj is not None:
                representation, representation_refs, metrics = tessellate_shape(
                    node.obj,
                    prototype_id,
                    document_id,
                    neutral_material_id,
                    linear_tolerance,
                    angular_tolerance,
                )
                representations.append(representation)
                source_refs.extend(representation_refs)
                representation_ids.append(representation["id"])
                prototype_metrics[prototype_id] = metrics
                metadata_entries.update(
                    {
                        "faceCount": metrics["faces"],
                        "edgeCount": metrics["edges"],
                        "triangleCount": metrics["triangles"],
                    }
                )

            record = {
                "id": prototype_id,
                "name": node_name,
                "semanticId": semantic_id,
                "sourceRef": prototype_source_ref,
                "representationIds": representation_ids,
                "localBounds": node_bounds(node),
                "metadata": {"schema": "madi.phase0.occt", "entries": metadata_entries},
            }
            if node.obj is not None:
                record["defaultMaterialId"] = neutral_material_id
            prototype_records[prototype_id] = record
            prototypes.append(record)
            semantics.append(
                {
                    "id": semantic_id,
                    "documentId": document_id,
                    "type": kind,
                    "name": node_name,
                    "sourceRef": prototype_source_ref,
                    "parentIds": (
                        [f"semantic:{parent_prototype_id}"] if parent_prototype_id else []
                    ),
                    "relationIds": [],
                    "properties": {
                        "schema": "madi.phase0.occt",
                        "entries": {"prototypeId": prototype_id},
                    },
                }
            )

        occurrence = {
            "id": occurrence_id,
            "prototypeId": prototype_id,
            "name": node_name,
            "semanticId": semantic_id,
            "sourceRef": occurrence_source_ref,
            "localTransform": location_matrix(node.loc),
            "initialVisibility": True,
            "tags": ["phase-0", "occt-xde", "assembly" if node.obj is None else "part"],
            "metadata": {
                "schema": "madi.phase0.occt",
                "entries": {"depth": depth, "sourcePath": path_value},
            },
        }
        if parent_occurrence_id:
            occurrence["parentId"] = parent_occurrence_id
        material_override = register_material(node.color)
        if material_override:
            occurrence["materialOverrideId"] = material_override
        occurrences.append(occurrence)
        prototype_occurrences.setdefault(prototype_id, []).append(occurrence_id)

        for child in node.children:
            walk(child, node_path, occurrence_id, prototype_id, depth + 1)

    walk(assembly, tuple(), None, None, 0)

    scene = {
        "schemaVersion": "0.1",
        "sceneId": f"scene:occt:{source_digest[:16]}",
        "revision": {
            "id": f"revision:occt:{source_digest[:16]}:{options_digest[:8]}",
            "sourceDigest": f"sha256:{source_digest}",
            "adapter": {
                "name": "madi-occt-xde-evidence",
                "version": "0.1.0",
                "build": f"CadQuery {cq.__version__} / OCP {OCP.__version__}",
            },
            "createdAt": source_timestamp(source_text),
            "optionsDigest": f"sha256:{options_digest}",
        },
        "units": {"length": "mm", "angle": "rad", "scaleToMeters": 0.001},
        "rootFrame": ROOT_FRAME,
        "documents": [
            {
                "id": document_id,
                "uriHint": source.as_posix(),
                "displayName": source.name,
                "mediaType": "model/step",
                "format": "STEP",
                "formatVersion": "AP214",
                "sourceDigest": f"sha256:{source_digest}",
                "units": {"length": "mm", "angle": "rad", "scaleToMeters": 0.001},
                "sourceFrame": ROOT_FRAME,
                "adapterCapabilities": {
                    "assemblyHierarchy": True,
                    "brepTopology": True,
                    "exactEvaluation": True,
                    "pmi": False,
                    "persistentIds": False,
                    "sourceTessellation": False,
                    "incrementalRevisions": False,
                },
                "sourceRefs": source_refs,
                "metadata": {
                    "schema": "madi.phase0.occt",
                    "entries": {
                        "reader": "CadQuery Assembly.importStep using OCCT STEPCAF/XDE",
                        "cadqueryVersion": cq.__version__,
                        "ocpVersion": OCP.__version__,
                        "cadqueryOcpPackageVersion": version("cadquery-ocp"),
                        "linearTolerance": {
                            "type": "quantity",
                            "value": linear_tolerance,
                            "unit": "mm",
                        },
                        "angularTolerance": {
                            "type": "quantity",
                            "value": angular_tolerance,
                            "unit": "rad",
                        },
                    },
                },
            }
        ],
        "prototypes": prototypes,
        "occurrences": occurrences,
        "semantics": semantics,
        "representations": representations,
        "materials": list(materials.values()),
        "diagnostics": [
            {
                "severity": "info",
                "code": "PHASE0_OCCT_PYTHON_BINDING",
                "message": (
                    "Evidence was extracted with the OCP Python binding; the production "
                    "native C++ adapter remains a separate build target."
                ),
                "documentId": document_id,
                "sourceRef": document_ref_id,
            }
        ],
    }

    part_occurrences = [occurrence for occurrence in occurrences if "part" in occurrence["tags"]]
    depths = [int(occurrence["metadata"]["entries"]["depth"]) for occurrence in occurrences]
    repeated = [
        {"prototypeId": prototype_id, "occurrenceIds": ids, "occurrenceCount": len(ids)}
        for prototype_id, ids in prototype_occurrences.items()
        if len(ids) > 1
    ]
    report = {
        "schemaVersion": "phase-0-occt-evidence.1",
        "source": {
            "path": source.as_posix(),
            "sha256": source_digest,
            "format": "STEP AP214",
            "units": "mm",
        },
        "toolchain": {
            "cadquery": cq.__version__,
            "ocp": OCP.__version__,
            "cadqueryOcpPackage": version("cadquery-ocp"),
        },
        "options": {
            "linearTolerance": linear_tolerance,
            "angularTolerance": angular_tolerance,
        },
        "counts": {
            "hierarchyDepthBelowRoot": max(depths, default=0),
            "prototypeCount": len(prototypes),
            "partPrototypeCount": len(prototype_metrics),
            "occurrenceNodeCount": len(occurrences),
            "partOccurrenceCount": len(part_occurrences),
            "representationCount": len(representations),
            "materialCount": len(materials),
            "faceSourceCount": sum(value["faces"] for value in prototype_metrics.values()),
            "edgeSourceCount": sum(value["edges"] for value in prototype_metrics.values()),
            "triangleCount": sum(value["triangles"] for value in prototype_metrics.values()),
            "edgeSegmentCount": sum(
                value["edgeSegments"] for value in prototype_metrics.values()
            ),
        },
        "prototypeReuse": repeated,
        "reader": {"status": "done", "transfer": True, "warnings": []},
        "unsupportedEntityInspection": {
            "status": "not-exercised",
            "reason": "The selected fixture is intentionally within the supported AP214 subset.",
        },
        "validation": {
            "sceneIr": "enforced by apps/webgpu-spike/test/evidence.test.ts",
            "visual": "recorded in artifacts/occt/README.md",
        },
    }
    return scene, report


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--scene", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--linear-tolerance", type=float, default=0.15)
    parser.add_argument("--angular-tolerance", type=float, default=0.15)
    arguments = parser.parse_args()

    scene, report = extract(
        arguments.source,
        arguments.linear_tolerance,
        arguments.angular_tolerance,
    )
    write_json(arguments.scene, scene)
    write_json(arguments.report, report)
    print(
        "[occt] extracted "
        f"{report['counts']['partPrototypeCount']} part prototypes, "
        f"{report['counts']['partOccurrenceCount']} part occurrences, "
        f"{report['counts']['triangleCount']} triangles"
    )
    print(f"[occt] scene: {arguments.scene}")
    print(f"[occt] report: {arguments.report}")


if __name__ == "__main__":
    main()
