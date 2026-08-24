"""Unit tests for `native/adapter-ifc/tools/property_columns.py`.

Deliberately independent of IfcOpenShell: `property_columns` has no adapter
dependency, so these run with only `requirements-dev.txt` installed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from property_columns import (  # noqa: E402
    decode_property_row,
    encode_property_value,
    encode_property_value_columns,
)

BAG_ROWS = [
    ["first", 2233332, None],
    [],
    ["first", True, 1.5],
    [{"type": "array", "values": [1, "x"]}, "Dëck famïly"],
]


def test_columns_round_trip_every_row():
    columns = encode_property_value_columns(BAG_ROWS)
    decoded = [decode_property_row(columns, row) for row in range(len(BAG_ROWS))]
    assert decoded == BAG_ROWS


def test_totals_count_references_not_distinct_values():
    columns = encode_property_value_columns(BAG_ROWS)
    assert columns["value_count"] == 8
    assert columns["row_count"] == 4
    # "first" repeats across bags but is stored once.
    assert columns["distinct_value_count"] == 7


def test_distinct_values_are_deduplicated_and_byte_sorted():
    columns = encode_property_value_columns([["b", "a"], ["a"]])
    offsets = columns["value_offsets"]
    heap = columns["value_heap"]
    encoded = [heap[offsets[i] : offsets[i + 1]] for i in range(len(offsets) - 1)]
    assert encoded == [b'"a"', b'"b"']
    assert encoded == sorted(encoded)


def test_row_offsets_bracket_each_bag():
    columns = encode_property_value_columns(BAG_ROWS)
    assert columns["row_offsets"] == [0, 3, 3, 6, 8]
    assert columns["row_offsets"][-1] == columns["value_count"]


def test_distinct_table_is_independent_of_bag_order():
    forward = encode_property_value_columns(BAG_ROWS)
    backward = encode_property_value_columns(list(reversed(BAG_ROWS)))
    assert forward["value_heap"] == backward["value_heap"]
    assert forward["value_offsets"] == backward["value_offsets"]


def test_compound_values_encode_canonically():
    # Key order inside compound values must not leak into the encoding.
    left = encode_property_value({"type": "quantity", "value": 1.5, "unit": "m"})
    right = encode_property_value({"unit": "m", "value": 1.5, "type": "quantity"})
    assert left == right
    assert left == b'{"type":"quantity","unit":"m","value":1.5}'


def test_non_ascii_values_stay_literal_utf8():
    assert encode_property_value("Dëck") == '"Dëck"'.encode("utf-8")


def test_non_finite_numbers_are_rejected():
    with pytest.raises(ValueError):
        encode_property_value(float("nan"))
