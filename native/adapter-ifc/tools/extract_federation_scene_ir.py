"""Extract deterministic Engineering Scene IR from an IFC federation.

IfcOpenShell remains behind this process boundary. The JSON output is an
inspection/intermediate representation, not a stable MADI storage format.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.unit
import numpy as np


ROOT_FRAME = {
    "origin": [0.0, 0.0, 0.0],
    "basis": [
        1.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ],
    "handedness": "right",
    "upAxis": "Z",
}
DISCIPLINE_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True)
class DocumentInput:
    discipline: str
    path: Path
    uri_hint: str


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256_bytes(encoded)


def rounded(value: float) -> float:
    result = round(float(value), 9)
    return 0.0 if result == 0 else result


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "unnamed"


def entity_id(entity: Any) -> int:
    return int(entity.id())


def entity_name(entity: Any) -> str | None:
    for attribute in ("Name", "LongName", "ObjectType", "Tag"):
        value = getattr(entity, attribute, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def global_id(entity: Any) -> str | None:
    value = getattr(entity, "GlobalId", None)
    return value if isinstance(value, str) and value else None


def semantic_id(document_token: str, entity: Any) -> str:
    guid = global_id(entity)
    token = f"guid:{guid}" if guid else f"step:{entity_id(entity)}"
    return f"semantic:ifc:{document_token}:{token}"


def entity_source_ref_id(document_token: str, entity: Any) -> str:
    guid = global_id(entity)
    token = f"guid:{guid}" if guid else f"step:{entity_id(entity)}"
    return f"source:ifc:{document_token}:{token}"


def normalize_property_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        number = float(value)
        return rounded(number) if math.isfinite(number) else str(number)
    if isinstance(value, (list, tuple, set)):
        return {
            "type": "array",
            "values": [normalize_property_value(item) for item in value],
        }
    if hasattr(value, "is_a") and hasattr(value, "id"):
        label = entity_name(value)
        return f"{value.is_a()}#{value.id()}{f' {label}' if label else ''}"
    return str(value)


def flatten_properties(value: Any, prefix: str, output: dict[str, Any]) -> None:
    if isinstance(value, dict):
        for key in sorted(value, key=str):
            if str(key).lower() == "id":
                continue
            path = f"{prefix}.{key}" if prefix else str(key)
            flatten_properties(value[key], path, output)
        return
    output[prefix] = normalize_property_value(value)


def properties_for(entity: Any) -> dict[str, Any]:
    try:
        raw = ifcopenshell.util.element.get_psets(entity)
    except (AttributeError, RuntimeError, TypeError):
        return {}
    result: dict[str, Any] = {}
    flatten_properties(raw, "", result)
    return result


def classification_for(entity: Any) -> list[dict[str, str]]:
    classifications: list[dict[str, str]] = []
    for relation in getattr(entity, "HasAssociations", ()) or ():
        if not relation.is_a("IfcRelAssociatesClassification"):
            continue
        reference = relation.RelatingClassification
        source = getattr(reference, "ReferencedSource", None)
        system = (
            getattr(source, "Name", None)
            or getattr(reference, "Name", None)
            or reference.is_a()
        )
        code = (
            getattr(reference, "Identification", None)
            or getattr(reference, "ItemReference", None)
            or str(reference.id())
        )
        label = getattr(reference, "Name", None)
        record = {"system": str(system), "code": str(code)}
        if isinstance(label, str) and label:
            record["label"] = label
        classifications.append(record)
    return sorted(
        classifications,
        key=lambda item: (item["system"], item["code"], item.get("label", "")),
    )


def direct_parent(entity: Any) -> Any | None:
    for inverse_name, target_name in (
        ("Nests", "RelatingObject"),
        ("Decomposes", "RelatingObject"),
        ("ContainedInStructure", "RelatingStructure"),
    ):
        relations = getattr(entity, inverse_name, ()) or ()
        if relations:
            return getattr(relations[0], target_name, None)
    return None


def semantic_relations(entity: Any, semantic_ids: dict[int, str]) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    targets: set[tuple[str, int]] = set()

    for relation in getattr(entity, "IsTypedBy", ()) or ():
        target = getattr(relation, "RelatingType", None)
        if target is not None:
            targets.add(("typed-by", entity_id(target)))
    for relation in getattr(entity, "IsDefinedBy", ()) or ():
        if relation.is_a("IfcRelDefinesByType"):
            target = getattr(relation, "RelatingType", None)
            if target is not None:
                targets.add(("typed-by", entity_id(target)))
    for relation in getattr(entity, "HasAssignments", ()) or ():
        if relation.is_a("IfcRelAssignsToGroup"):
            target = getattr(relation, "RelatingGroup", None)
            if target is not None:
                targets.add(("member-of", entity_id(target)))

    for relation_type, target_id in sorted(targets):
        target_semantic_id = semantic_ids.get(target_id)
        if target_semantic_id:
            relations.append({"type": relation_type, "targetId": target_semantic_id})
    return relations


def matrix_from_column_major(values: Sequence[float]) -> np.ndarray[Any, Any]:
    if len(values) != 16:
        raise ValueError("IFC shape transformation must contain 16 values.")
    return np.asarray(values, dtype=np.float64).reshape((4, 4), order="F")


def project_placement_matrix(entity: Any, unit_scale: float) -> np.ndarray[Any, Any]:
    placement = getattr(entity, "ObjectPlacement", None)
    if placement is None:
        return np.eye(4, dtype=np.float64)
    matrix = np.asarray(
        ifcopenshell.util.placement.get_local_placement(placement),
        dtype=np.float64,
    )
    matrix[:3, 3] *= unit_scale
    return matrix


def column_major_values(matrix: np.ndarray[Any, Any]) -> list[float]:
    return [rounded(value) for value in matrix.flatten(order="F")]


def computed_normals(vertices: np.ndarray[Any, Any], faces: np.ndarray[Any, Any]) -> list[float]:
    normals = np.zeros_like(vertices)
    a = vertices[faces[:, 0]]
    b = vertices[faces[:, 1]]
    c = vertices[faces[:, 2]]
    face_normals = np.cross(b - a, c - a)
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    lengths = np.linalg.norm(normals, axis=1)
    valid = lengths > 1e-15
    normals[valid] /= lengths[valid, np.newaxis]
    normals[~valid] = [0.0, 0.0, 1.0]
    return [rounded(value) for value in normals.reshape(-1)]


def material_record(style: Any | None) -> tuple[str, dict[str, Any]]:
    if style is None:
        name = "IFC default material"
        color = [0.62, 0.68, 0.72, 1.0]
    else:
        diffuse = getattr(style, "diffuse", None)
        rgb = [
            rounded(getattr(diffuse, component)()) if diffuse is not None else 0.7
            for component in ("r", "g", "b")
        ]
        transparency = getattr(style, "transparency", 0.0)
        transparency = float(transparency) if transparency is not None else 0.0
        if not math.isfinite(transparency):
            transparency = 0.0
        color = [*rgb, rounded(max(0.0, min(1.0, 1.0 - transparency)))]
        raw_name = getattr(style, "name", None)
        name = raw_name if isinstance(raw_name, str) and raw_name else "IFC material"

    identity = sha256_json({"name": name, "baseColor": color})[:16]
    material_id = f"material:ifc:{identity}"
    return material_id, {
        "id": material_id,
        "name": name,
        "baseColor": color,
        "metallic": 0.0,
        "roughness": 0.8,
        "doubleSided": True,
        "alphaMode": "blend" if color[3] < 0.999 else "opaque",
        "edgeStyle": {"color": [0.03, 0.05, 0.07, 1.0], "width": 1.0},
    }


def material_groups(
    geometry: Any,
    triangle_count: int,
    materials: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], str]:
    fallback_id, fallback = material_record(None)
    materials.setdefault(fallback_id, fallback)
    styles = list(getattr(geometry, "materials", ()) or ())
    local_ids = list(getattr(geometry, "material_ids", ()) or ())
    if len(local_ids) != triangle_count:
        local_ids = [-1] * triangle_count

    resolved: list[str] = []
    for local_id in local_ids:
        style = styles[int(local_id)] if 0 <= int(local_id) < len(styles) else None
        material_id, record = material_record(style)
        materials.setdefault(material_id, record)
        resolved.append(material_id)

    if not resolved:
        return [], fallback_id

    groups: list[dict[str, Any]] = []
    first_triangle = 0
    current = resolved[0]
    for triangle_index, material_id in enumerate(resolved[1:], start=1):
        if material_id == current:
            continue
        groups.append(
            {
                "firstIndex": first_triangle * 3,
                "indexCount": (triangle_index - first_triangle) * 3,
                "materialId": current,
            }
        )
        first_triangle = triangle_index
        current = material_id
    groups.append(
        {
            "firstIndex": first_triangle * 3,
            "indexCount": (len(resolved) - first_triangle) * 3,
            "materialId": current,
        }
    )
    return groups, groups[0]["materialId"]


def transformed_bounds(vertices: np.ndarray[Any, Any]) -> dict[str, list[float]]:
    if len(vertices) == 0:
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {
        "min": [rounded(value) for value in np.min(vertices, axis=0)],
        "max": [rounded(value) for value in np.max(vertices, axis=0)],
    }


def safe_header_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, Iterable):
        return [str(item) for item in value if str(item)]
    return []


def property_array(values: Sequence[str]) -> dict[str, Any]:
    return {"type": "array", "values": list(values)}


def parse_inputs(document_values: Sequence[str], uri_values: Sequence[str]) -> list[DocumentInput]:
    uri_hints: dict[str, str] = {}
    for value in uri_values:
        discipline, separator, uri_hint = value.partition("=")
        if not separator or not DISCIPLINE_PATTERN.fullmatch(discipline) or not uri_hint:
            raise ValueError(f"Invalid --uri-hint value {value!r}; expected discipline=value.")
        if discipline in uri_hints:
            raise ValueError(f"Duplicate --uri-hint discipline {discipline}.")
        uri_hints[discipline] = uri_hint

    documents: list[DocumentInput] = []
    disciplines: set[str] = set()
    for value in document_values:
        discipline, separator, path_value = value.partition("=")
        if not separator or not DISCIPLINE_PATTERN.fullmatch(discipline) or not path_value:
            raise ValueError(f"Invalid --document value {value!r}; expected discipline=path.ifc.")
        if discipline in disciplines:
            raise ValueError(f"Duplicate discipline {discipline}.")
        path = Path(path_value).resolve(strict=True)
        if path.suffix.lower() != ".ifc" or not path.is_file():
            raise ValueError(f"IFC document must be a regular .ifc file: {path}")
        documents.append(
            DocumentInput(
                discipline=discipline,
                path=path,
                uri_hint=uri_hints.get(discipline, path.name),
            )
        )
        disciplines.add(discipline)
    unknown_hints = set(uri_hints) - disciplines
    if unknown_hints:
        raise ValueError(f"URI hints have no matching document: {sorted(unknown_hints)}")
    return sorted(documents, key=lambda item: item.discipline)


def inspect_document(
    document: DocumentInput,
    threads: int,
) -> dict[str, Any]:
    source_bytes = document.path.read_bytes()
    source_digest = sha256_bytes(source_bytes)
    document_token = f"{document.discipline}-{source_digest[:12]}"
    document_id = f"document:ifc:{document_token}"
    document_ref_id = f"source:ifc:{document_token}:document"
    model = ifcopenshell.open(document.path)
    part21_entity_count = sum(1 for _ in model)
    unit_scale = float(ifcopenshell.util.unit.calculate_unit_scale(model))
    if not math.isfinite(unit_scale) or unit_scale <= 0:
        raise ValueError(f"{document.uri_hint} has an invalid length unit scale.")

    diagnostics: list[dict[str, Any]] = []
    source_refs: dict[str, dict[str, Any]] = {
        document_ref_id: {
            "id": document_ref_id,
            "documentId": document_id,
            "namespace": "ifc-document",
            "value": document.uri_hint,
            "kind": "document",
            "stability": "revision-local",
        }
    }
    semantics: list[dict[str, Any]] = []
    prototypes: dict[str, dict[str, Any]] = {}
    representations: dict[str, dict[str, Any]] = {}
    materials: dict[str, dict[str, Any]] = {}
    shape_by_entity: dict[int, dict[str, Any]] = {}
    world_by_entity: dict[int, np.ndarray[Any, Any]] = {}
    geometry_occurrences: Counter[str] = Counter()
    geometry_metrics: dict[str, dict[str, int]] = {}

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", False)
    settings.set("weld-vertices", True)
    for shape in ifcopenshell.geom.iterate(settings, model, num_threads=threads):
        product = model.by_id(shape.id)
        product_id = entity_id(product)
        geometry = shape.geometry
        geometry_key = f"{document_token}:{geometry.id}"
        prototype_id = f"prototype:ifc:{geometry_key}"
        representation_id = f"representation:ifc:{geometry_key}:display"
        body_ref_id = f"source:ifc:{geometry_key}:geometry"
        world_by_entity[product_id] = matrix_from_column_major(shape.transformation.matrix)

        vertices = np.asarray(geometry.verts, dtype=np.float64).reshape((-1, 3))
        faces = np.asarray(geometry.faces, dtype=np.uint32).reshape((-1, 3))
        if len(vertices) == 0 or len(faces) == 0:
            continue
        shape_by_entity[product_id] = {
            "prototypeId": prototype_id,
            "geometryKey": geometry_key,
        }
        geometry_occurrences[prototype_id] += 1
        if prototype_id in prototypes:
            continue
        raw_normals = list(getattr(geometry, "normals", ()) or ())
        normals = (
            [rounded(value) for value in raw_normals]
            if len(raw_normals) == vertices.size
            else computed_normals(vertices, faces)
        )
        groups, default_material_id = material_groups(
            geometry,
            len(faces),
            materials,
        )
        source_refs[body_ref_id] = {
            "id": body_ref_id,
            "documentId": document_id,
            "namespace": "ifcopenshell:geometry",
            "value": str(geometry.id),
            "kind": "body",
            "stability": "revision-local",
        }
        bounds = transformed_bounds(vertices)
        representation = {
            "id": representation_id,
            "prototypeId": prototype_id,
            "purpose": "display",
            "accuracy": {
                "kind": "tessellated",
                "unit": "m",
                "notes": [
                    "IfcOpenShell triangulation in local product coordinates.",
                    "IFC curve/edge semantics are deferred in this adapter slice.",
                ],
            },
            "localFrame": ROOT_FRAME,
            "surface": {
                "primitive": "triangles",
                "positions": [rounded(value) for value in vertices.reshape(-1)],
                "indices": [int(value) for value in faces.reshape(-1)],
                "normals": normals,
                "materialGroups": groups,
            },
            "bounds": bounds,
            "sourceMap": {"sourceRefs": [body_ref_id]},
        }
        representations[representation_id] = representation
        prototypes[prototype_id] = {
            "id": prototype_id,
            "name": f"{product.is_a()} geometry {geometry.id}",
            "sourceRef": body_ref_id,
            "representationIds": [representation_id],
            "localBounds": bounds,
            "defaultMaterialId": default_material_id,
            "metadata": {
                "schema": "IFC",
                "entries": {
                    "discipline": document.discipline,
                    "geometryId": str(geometry.id),
                },
            },
        }
        geometry_metrics[prototype_id] = {
            "vertices": len(vertices),
            "triangles": len(faces),
            "materialGroups": len(groups),
        }

    object_definitions = sorted(model.by_type("IfcObjectDefinition"), key=entity_id)
    semantic_ids = {
        entity_id(entity): semantic_id(document_token, entity)
        for entity in object_definitions
    }
    property_value_count = 0
    duplicate_global_ids = Counter(
        guid for entity in object_definitions if (guid := global_id(entity))
    )
    duplicate_global_ids = Counter(
        {guid: count for guid, count in duplicate_global_ids.items() if count > 1}
    )

    for entity in object_definitions:
        source_ref_id = entity_source_ref_id(document_token, entity)
        guid = global_id(entity)
        source_refs[source_ref_id] = {
            "id": source_ref_id,
            "documentId": document_id,
            "namespace": "ifc-global-id" if guid else "ifc-step-id",
            "value": guid or str(entity_id(entity)),
            "kind": "assembly-node" if entity.is_a("IfcProduct") else "external",
            "stability": "persistent" if guid else "revision-local",
        }
        parent = direct_parent(entity)
        parent_semantic = semantic_ids.get(entity_id(parent)) if parent is not None else None
        properties = properties_for(entity)
        property_value_count += len(properties)
        metadata = {
            "ifc.entityId": entity_id(entity),
            "ifc.discipline": document.discipline,
        }
        if guid:
            metadata["ifc.globalId"] = guid
        for attribute in ("PredefinedType", "ObjectType", "Tag"):
            value = getattr(entity, attribute, None)
            if value is not None:
                metadata[f"ifc.{attribute}"] = normalize_property_value(value)
        semantic = {
            "id": semantic_ids[entity_id(entity)],
            "documentId": document_id,
            "type": entity.is_a(),
            "sourceRef": source_ref_id,
            "parentIds": [parent_semantic] if parent_semantic else [],
            "relationIds": semantic_relations(entity, semantic_ids),
            "properties": {
                "schema": model.schema,
                "entries": {**metadata, **properties},
            },
        }
        name = entity_name(entity)
        description = getattr(entity, "Description", None)
        classifications = classification_for(entity)
        if name:
            semantic["name"] = name
        if isinstance(description, str) and description:
            semantic["description"] = description
        if classifications:
            semantic["classification"] = classifications
        semantics.append(semantic)

    occurrence_entities = sorted(
        {
            entity_id(entity): entity
            for entity in [*model.by_type("IfcProduct"), *model.by_type("IfcProject")]
        }.values(),
        key=entity_id,
    )
    occurrence_entity_ids = {entity_id(entity) for entity in occurrence_entities}
    occurrences: list[dict[str, Any]] = []
    parent_occurrence_by_id: dict[str, str | None] = {}

    for entity in occurrence_entities:
        step_id = entity_id(entity)
        if step_id not in world_by_entity:
            try:
                world_by_entity[step_id] = project_placement_matrix(entity, unit_scale)
            except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                world_by_entity[step_id] = np.eye(4, dtype=np.float64)
                diagnostics.append(
                    {
                        "severity": "warning",
                        "code": "IFC_PLACEMENT_FALLBACK",
                        "message": f"Used identity placement for {entity.is_a()}#{step_id}: {error}",
                        "documentId": document_id,
                        "sourceRef": entity_source_ref_id(document_token, entity),
                    }
                )

        shape = shape_by_entity.get(step_id)
        if shape:
            prototype_id = shape["prototypeId"]
            tags = ["ifc", "geometry", document.discipline, entity.is_a().lower()]
        else:
            class_slug = slug(entity.is_a())
            prototype_id = f"prototype:ifc:{document_token}:non-geometric:{class_slug}"
            tags = ["ifc", "non-geometric", document.discipline, entity.is_a().lower()]
            prototypes.setdefault(
                prototype_id,
                {
                    "id": prototype_id,
                    "name": f"{entity.is_a()} semantic node",
                    "representationIds": [],
                    "localBounds": {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]},
                    "metadata": {
                        "schema": "IFC",
                        "entries": {
                            "discipline": document.discipline,
                            "ifcClass": entity.is_a(),
                            "geometryStatus": "not-present",
                        },
                    },
                },
            )

        occurrence_id = f"occurrence:ifc:{document_token}:{step_id}"
        parent = direct_parent(entity)
        parent_step_id = entity_id(parent) if parent is not None else None
        parent_occurrence_id = (
            f"occurrence:ifc:{document_token}:{parent_step_id}"
            if parent_step_id in occurrence_entity_ids
            else None
        )
        world = world_by_entity[step_id]
        local = world
        if parent_occurrence_id and parent_step_id is not None:
            parent_world = world_by_entity.get(parent_step_id)
            if parent_world is None:
                try:
                    parent_world = project_placement_matrix(parent, unit_scale)
                except (AttributeError, RuntimeError, TypeError, ValueError):
                    parent_world = np.eye(4, dtype=np.float64)
                world_by_entity[parent_step_id] = parent_world
            try:
                local = np.linalg.inv(parent_world) @ world
            except np.linalg.LinAlgError:
                diagnostics.append(
                    {
                        "severity": "warning",
                        "code": "IFC_PARENT_PLACEMENT_SINGULAR",
                        "message": f"Could not derive a local transform for {entity.is_a()}#{step_id}.",
                        "documentId": document_id,
                        "sourceRef": entity_source_ref_id(document_token, entity),
                    }
                )
        occurrence = {
            "id": occurrence_id,
            "prototypeId": prototype_id,
            "semanticId": semantic_ids[step_id],
            "sourceRef": entity_source_ref_id(document_token, entity),
            "localTransform": column_major_values(local),
            "initialVisibility": True,
            "tags": tags,
            "metadata": {
                "schema": "IFC",
                "entries": {
                    "discipline": document.discipline,
                    "ifcClass": entity.is_a(),
                    "ifcEntityId": step_id,
                },
            },
        }
        name = entity_name(entity)
        if name:
            occurrence["name"] = name
        if parent_occurrence_id:
            occurrence["parentId"] = parent_occurrence_id
        occurrences.append(occurrence)
        parent_occurrence_by_id[occurrence_id] = parent_occurrence_id

    for prototype_id, count in geometry_occurrences.items():
        prototypes[prototype_id]["metadata"]["entries"]["occurrenceCount"] = count

    depth_cache: dict[str, int] = {}

    def occurrence_depth(occurrence_id: str) -> int:
        if occurrence_id in depth_cache:
            return depth_cache[occurrence_id]
        visited: set[str] = set()
        cursor: str | None = occurrence_id
        depth = 0
        while cursor and (parent := parent_occurrence_by_id.get(cursor)):
            if cursor in visited:
                return depth
            visited.add(cursor)
            depth += 1
            cursor = parent
        depth_cache[occurrence_id] = depth
        return depth

    timestamp = str(getattr(model.header.file_name, "time_stamp", ""))
    authors = safe_header_values(getattr(model.header.file_name, "author", ()))
    organizations = safe_header_values(getattr(model.header.file_name, "organization", ()))
    crs_entities = model.by_type("IfcProjectedCRS")
    source_frame = dict(ROOT_FRAME)
    if crs_entities:
        crs_name = getattr(crs_entities[0], "Name", None)
        if isinstance(crs_name, str) and crs_name:
            source_frame["crs"] = crs_name

    length_label = "m" if math.isclose(unit_scale, 1.0) else (
        "mm" if math.isclose(unit_scale, 0.001) else "source-length-unit"
    )
    source_document = {
        "id": document_id,
        "uriHint": document.uri_hint,
        "displayName": document.path.name,
        "mediaType": "model/ifc",
        "format": "IFC",
        "formatVersion": model.schema,
        "sourceDigest": f"sha256:{source_digest}",
        "revisionLabel": timestamp or source_digest[:12],
        "units": {
            "length": length_label,
            "angle": "rad",
            "scaleToMeters": unit_scale,
        },
        "sourceFrame": source_frame,
        "adapterCapabilities": {
            "assemblyHierarchy": True,
            "brepTopology": False,
            "exactEvaluation": False,
            "pmi": False,
            "persistentIds": True,
            "sourceTessellation": True,
            "incrementalRevisions": False,
        },
        "sourceRefs": sorted(source_refs.values(), key=lambda item: item["id"]),
        "metadata": {
            "schema": model.schema,
            "entries": {
                "discipline": document.discipline,
                "authors": property_array(authors),
                "organizations": property_array(organizations),
                "part21EntityCount": part21_entity_count,
            },
        },
    }
    counts = {
        "part21EntityCount": part21_entity_count,
        "semanticEntityCount": len(semantics),
        "productCount": len(model.by_type("IfcProduct")),
        "occurrenceCount": len(occurrences),
        "geometricOccurrenceCount": len(shape_by_entity),
        "prototypeCount": len(prototypes),
        "geometricPrototypeCount": len(geometry_metrics),
        "representationCount": len(representations),
        "vertexCount": sum(value["vertices"] for value in geometry_metrics.values()),
        "triangleCount": sum(value["triangles"] for value in geometry_metrics.values()),
        "submittedTriangleCount": sum(
            geometry_metrics[prototype_id]["triangles"] * occurrence_count
            for prototype_id, occurrence_count in geometry_occurrences.items()
        ),
        "propertyValueCount": property_value_count,
        "mappedItemCount": len(model.by_type("IfcMappedItem")),
        "representationMapCount": len(model.by_type("IfcRepresentationMap")),
        "maxHierarchyDepth": max(
            (occurrence_depth(occurrence["id"]) for occurrence in occurrences),
            default=0,
        ),
        "duplicateGlobalIdCount": sum(duplicate_global_ids.values()),
    }
    return {
        "input": document,
        "sourceDigest": source_digest,
        "timestamp": timestamp,
        "document": source_document,
        "semantics": semantics,
        "prototypes": sorted(prototypes.values(), key=lambda item: item["id"]),
        "occurrences": occurrences,
        "representations": sorted(representations.values(), key=lambda item: item["id"]),
        "materials": sorted(materials.values(), key=lambda item: item["id"]),
        "diagnostics": diagnostics,
        "counts": counts,
        "prototypeReuse": sorted(
            (
                {
                    "prototypeId": prototype_id,
                    "occurrenceCount": occurrence_count,
                    **geometry_metrics[prototype_id],
                }
                for prototype_id, occurrence_count in geometry_occurrences.items()
                if occurrence_count > 1
            ),
            key=lambda item: (-item["occurrenceCount"], item["prototypeId"]),
        ),
    }


def extract_federation(documents: Sequence[DocumentInput], threads: int) -> tuple[dict[str, Any], dict[str, Any]]:
    extracted = [inspect_document(document, threads) for document in documents]
    digest_input = [
        {"discipline": item["input"].discipline, "sha256": item["sourceDigest"]}
        for item in extracted
    ]
    federation_digest = sha256_json(digest_input)
    options = {
        "geometryLibrary": "opencascade",
        "useWorldCoordinates": False,
        "weldVertices": True,
        "includeSurfaces": True,
        "includeEdges": False,
        "normalizeSceneToMeters": True,
        "propertyMode": "flattened-inherited-psets",
    }
    created_at_candidates = sorted(
        item["timestamp"] for item in extracted if item["timestamp"]
    )
    scene = {
        "schemaVersion": "0.1",
        "sceneId": f"scene:ifc-federation:{federation_digest[:16]}",
        "revision": {
            "id": f"revision:ifc-federation:{federation_digest[:16]}",
            "sourceDigest": f"sha256:{federation_digest}",
            "adapter": {"name": "IfcOpenShell", "version": ifcopenshell.version},
            "createdAt": (
                created_at_candidates[-1]
                if created_at_candidates
                else "1970-01-01T00:00:00.000Z"
            ),
            "optionsDigest": f"sha256:{sha256_json(options)}",
        },
        "units": {"length": "m", "angle": "rad", "scaleToMeters": 1.0},
        "rootFrame": ROOT_FRAME,
        "documents": [item["document"] for item in extracted],
        "prototypes": sorted(
            [record for item in extracted for record in item["prototypes"]],
            key=lambda record: record["id"],
        ),
        "occurrences": sorted(
            [record for item in extracted for record in item["occurrences"]],
            key=lambda record: record["id"],
        ),
        "semantics": sorted(
            [record for item in extracted for record in item["semantics"]],
            key=lambda record: record["id"],
        ),
        "representations": sorted(
            [record for item in extracted for record in item["representations"]],
            key=lambda record: record["id"],
        ),
        "materials": sorted(
            {
                record["id"]: record
                for item in extracted
                for record in item["materials"]
            }.values(),
            key=lambda record: record["id"],
        ),
        "diagnostics": [
            *[record for item in extracted for record in item["diagnostics"]],
            {
                "severity": "info",
                "code": "IFC_EDGE_EXTRACTION_DEFERRED",
                "message": (
                    "The first IFC adapter slice emits tessellated surfaces but does not "
                    "classify IFC curve or boundary edges."
                ),
                "data": {
                    "schema": "madi.ifc-adapter.1",
                    "entries": {"handling": "surface-only"},
                },
            },
        ],
    }
    totals: dict[str, int] = defaultdict(int)
    for item in extracted:
        for key, value in item["counts"].items():
            if key != "maxHierarchyDepth":
                totals[key] += int(value)
    totals["documentCount"] = len(extracted)
    totals["maxHierarchyDepth"] = max(
        (item["counts"]["maxHierarchyDepth"] for item in extracted),
        default=0,
    )
    totals["reusedGeometryOccurrenceCount"] = sum(
        max(0, record["occurrenceCount"] - 1)
        for item in extracted
        for record in item["prototypeReuse"]
    )
    report = {
        "schemaVersion": "madi.ifc-adapter-report.1",
        "adapter": {
            "name": "IfcOpenShell",
            "version": ifcopenshell.version,
            "geometryLibrary": "opencascade",
        },
        "federation": {
            "sourceDigest": federation_digest,
            "documentOrder": [item["input"].discipline for item in extracted],
            "options": options,
        },
        "sources": [
            {
                "discipline": item["input"].discipline,
                "path": item["input"].uri_hint,
                "byteLength": item["input"].path.stat().st_size,
                "sha256": item["sourceDigest"],
                "schema": item["document"]["formatVersion"],
                "unitScaleToMeters": item["document"]["units"]["scaleToMeters"],
                "counts": item["counts"],
            }
            for item in extracted
        ],
        "counts": dict(sorted(totals.items())),
        "prototypeReuse": [
            record
            for item in extracted
            for record in item["prototypeReuse"][:20]
        ],
        "diagnostics": {
            "counts": dict(
                Counter(
                    diagnostic["severity"]
                    for diagnostic in scene["diagnostics"]
                )
            ),
            "codes": sorted({diagnostic["code"] for diagnostic in scene["diagnostics"]}),
        },
        "limitations": [
            "IFC curve and boundary-edge classification is deferred.",
            "Properties are flattened for the first queryable semantic slice.",
            "Cross-document object reconciliation is document-scoped and not inferred from names.",
        ],
    }
    return scene, report


def write_scene(path: Path, scene: dict[str, Any]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(scene, output, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        output.write("\n")
    digest = hashlib.sha256()
    byte_length = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            byte_length += len(chunk)
    return {"byteLength": byte_length, "sha256": digest.hexdigest()}


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(report, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--document",
        action="append",
        default=[],
        required=True,
        help="Federation input in discipline=path.ifc form; repeat for each document.",
    )
    parser.add_argument(
        "--uri-hint",
        action="append",
        default=[],
        help="Non-sensitive source label in discipline=value form.",
    )
    parser.add_argument("--scene", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument(
        "--threads",
        type=int,
        default=max(1, min(8, os.cpu_count() or 1)),
    )
    arguments = parser.parse_args()
    if arguments.threads < 1:
        parser.error("--threads must be a positive integer.")

    documents = parse_inputs(arguments.document, arguments.uri_hint)
    scene, report = extract_federation(documents, arguments.threads)
    report["scene"] = write_scene(arguments.scene, scene)
    write_report(arguments.report, report)
    counts = report["counts"]
    print(
        "[ifc] "
        f"{counts['documentCount']} documents, "
        f"{counts['geometricPrototypeCount']} geometric prototypes, "
        f"{counts['geometricOccurrenceCount']} geometric occurrences, "
        f"{counts['triangleCount']} triangles"
    )
    print(f"[ifc] scene: {arguments.scene}")
    print(f"[ifc] report: {arguments.report}")


if __name__ == "__main__":
    main()
