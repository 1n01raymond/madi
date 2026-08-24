"""Unit tests for `native/adapter-ifc/tools/placement_math.py`.

Deliberately independent of IfcOpenShell: `placement_math` has no adapter
dependency, so these run with only `requirements-dev.txt` installed.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from placement_math import (  # noqa: E402
    IDENTITY_MATRIX,
    column_major_values,
    is_finite_matrix,
    matrix_from_column_major,
    rounded,
    sanitized_matrix,
)


def test_rounded_truncates_to_nine_decimal_places():
    assert rounded(0.1234567891234) == 0.123456789


def test_rounded_normalizes_negative_zero():
    assert rounded(-0.0) == 0.0
    assert math.copysign(1.0, rounded(-0.0)) == 1.0


def test_rounded_passes_nan_through():
    # Regression guard: `round(nan, 9)` is `nan`, and `nan == 0` is `False`,
    # so `rounded()` alone never catches non-finite input. This is exactly
    # why `sanitized_matrix()` exists as a separate, mandatory guard before
    # any value reaches `column_major_values()`.
    assert math.isnan(rounded(float("nan")))


def test_matrix_from_column_major_round_trips():
    values = [float(i) for i in range(16)]
    matrix = matrix_from_column_major(values)
    assert column_major_values(matrix) == values


def test_matrix_from_column_major_rejects_wrong_length():
    with pytest.raises(ValueError):
        matrix_from_column_major([0.0] * 15)


def test_is_finite_matrix_true_for_identity():
    assert is_finite_matrix(IDENTITY_MATRIX) is True


def test_is_finite_matrix_false_for_nan():
    matrix = np.eye(4, dtype=np.float64)
    matrix[2, 3] = float("nan")
    assert is_finite_matrix(matrix) is False


def test_is_finite_matrix_false_for_infinity():
    matrix = np.eye(4, dtype=np.float64)
    matrix[0, 0] = float("inf")
    assert is_finite_matrix(matrix) is False


def test_sanitized_matrix_returns_original_when_finite():
    matrix = matrix_from_column_major([float(i) for i in range(16)])
    result, replaced = sanitized_matrix(matrix)
    assert replaced is False
    assert np.array_equal(result, matrix)


def test_sanitized_matrix_replaces_nan_with_identity():
    matrix = np.full((4, 4), float("nan"), dtype=np.float64)
    result, replaced = sanitized_matrix(matrix)
    assert replaced is True
    assert np.array_equal(result, IDENTITY_MATRIX)


def test_sanitized_matrix_replaces_infinity_with_identity():
    matrix = np.eye(4, dtype=np.float64)
    matrix[1, 3] = float("-inf")
    result, replaced = sanitized_matrix(matrix)
    assert replaced is True
    assert np.array_equal(result, IDENTITY_MATRIX)


def test_sanitized_matrix_does_not_mutate_the_shared_identity_constant():
    matrix = np.full((4, 4), float("nan"), dtype=np.float64)
    result, _ = sanitized_matrix(matrix)
    result[0, 0] = 99.0
    assert IDENTITY_MATRIX[0, 0] == 1.0
