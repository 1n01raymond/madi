"""Pure placement-matrix math shared by the IFC federation adapter.

Deliberately free of an IfcOpenShell import so it can be unit-tested without
the pinned adapter environment (`native/adapter-ifc/tests/`).
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

IDENTITY_MATRIX = np.eye(4, dtype=np.float64)


def rounded(value: float) -> float:
    result = round(float(value), 9)
    return 0.0 if result == 0 else result


def matrix_from_column_major(values: Sequence[float]) -> np.ndarray[Any, Any]:
    if len(values) != 16:
        raise ValueError("IFC shape transformation must contain 16 values.")
    return np.asarray(values, dtype=np.float64).reshape((4, 4), order="F")


def column_major_values(matrix: np.ndarray[Any, Any]) -> list[float]:
    return [rounded(value) for value in matrix.flatten(order="F")]


def is_finite_matrix(matrix: np.ndarray[Any, Any]) -> bool:
    return bool(np.isfinite(matrix).all())


def sanitized_matrix(matrix: np.ndarray[Any, Any]) -> tuple[np.ndarray[Any, Any], bool]:
    """Returns (matrix, replaced). Replaces a non-finite matrix with identity.

    `np.linalg.inv` returns NaN silently on many degenerate inputs rather than
    raising `LinAlgError`, and IFC placements can carry degenerate axes
    (zero-length or parallel `IfcAxis2Placement` vectors) that propagate NaN
    through `ifcopenshell.util.placement.get_local_placement` without
    raising. This is the single choke point both call sites use to keep a
    degenerate placement from reaching the serialized Scene IR.
    """
    if is_finite_matrix(matrix):
        return matrix, False
    return IDENTITY_MATRIX.copy(), True
