from __future__ import annotations

import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

from explicit_edges import BOUNDARY_EDGE_CLASS, explicit_edge_geometry  # noqa: E402


def test_preserves_segments_and_maps_sorted_source_items() -> None:
    positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0]
    edges, source_items = explicit_edge_geometry(
        positions,
        [0, 1, 1, 2, 2, 0],
        [42, 7, 42],
    )

    assert edges is not None
    assert edges["positions"] is positions
    assert edges["segments"] == [0, 1, 1, 2, 2, 0]
    assert edges["classes"] == [BOUNDARY_EDGE_CLASS] * 3
    assert source_items == [7, 42]
    assert edges["sourceIds"] == [2, 1, 2]


def test_empty_edges_have_no_geometry_or_sources() -> None:
    assert explicit_edge_geometry([0.0, 0.0, 0.0], [], []) == (None, [])


@pytest.mark.parametrize(
    ("positions", "segments", "item_ids", "message"),
    [
        ([0.0, 0.0], [], [], "xyz triplets"),
        ([0.0, 0.0, 0.0], [0], [], "indices.*pairs"),
        ([0.0, 0.0, 0.0], [0, 0], [], "one representation-item id"),
        ([0.0, 0.0, 0.0], [0, 1], [7], "exceeds the shared vertex"),
        ([0.0, 0.0, 0.0], [0, 0], [0], "positive STEP ids"),
    ],
)
def test_rejects_malformed_ifcopenshell_output(
    positions: list[float],
    segments: list[int],
    item_ids: list[int],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        explicit_edge_geometry(positions, segments, item_ids)
