"""Normalize IfcOpenShell's tessellated topological-edge output.

Pure Python so the adapter unit-test job can verify the boundary/source mapping
without installing IfcOpenShell. The OpenCascade triangulation backend emits
face-boundary segments in ``geometry.edges`` and one originating IFC
representation-item STEP id per segment in ``geometry.edges_item_ids``.
"""

from __future__ import annotations

from typing import Any, Sequence


BOUNDARY_EDGE_CLASS = 0


def explicit_edge_geometry(
    positions: list[float],
    segments: Sequence[int],
    item_ids: Sequence[int],
    *,
    source_index_offset: int = 1,
) -> tuple[dict[str, Any] | None, list[int]]:
    """Build an EdgeGeometry record and its sorted source-item table.

    ``source_index_offset`` reserves earlier entries in the representation's
    source map (the IFC adapter keeps its geometry-body reference at index 0).
    Segment order is preserved exactly; only the compact source table is
    sorted so extraction remains deterministic across iterator scheduling.
    """

    if len(positions) % 3 != 0:
        raise ValueError("IFC edge positions must contain xyz triplets.")
    if len(segments) % 2 != 0:
        raise ValueError("IfcOpenShell edge indices must contain pairs.")

    segment_count = len(segments) // 2
    if segment_count == 0:
        if item_ids:
            raise ValueError("IfcOpenShell returned edge item ids without edge segments.")
        return None, []
    if len(item_ids) != segment_count:
        raise ValueError(
            "IfcOpenShell must return one representation-item id per edge segment."
        )
    if source_index_offset < 0:
        raise ValueError("Edge source-map offsets cannot be negative.")

    vertex_count = len(positions) // 3
    normalized_segments = [int(index) for index in segments]
    if any(index < 0 or index >= vertex_count for index in normalized_segments):
        raise ValueError("IfcOpenShell edge index exceeds the shared vertex stream.")

    normalized_item_ids = [int(item_id) for item_id in item_ids]
    if any(item_id <= 0 for item_id in normalized_item_ids):
        raise ValueError("IfcOpenShell edge source ids must be positive STEP ids.")
    source_items = sorted(set(normalized_item_ids))
    source_indices = {
        item_id: source_index_offset + index
        for index, item_id in enumerate(source_items)
    }

    return (
        {
            "positions": positions,
            "segments": normalized_segments,
            "classes": [BOUNDARY_EDGE_CLASS] * segment_count,
            "sourceIds": [source_indices[item_id] for item_id in normalized_item_ids],
        },
        source_items,
    )
