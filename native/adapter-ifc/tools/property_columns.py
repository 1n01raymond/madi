"""Deterministic binary column encoding for semantic property values.

Pure Python (no ifcopenshell import) so `pnpm adapter:ifc:test` can cover it
without a native toolchain. The columns move the property values themselves
out of the structure JSON: every distinct value is encoded once as canonical
compact JSON in a shared UTF-8 heap, and each bag keeps only a run of u32
references. All tables depend only on the multiset of values (the distinct
table) and the bag order (the rows), never on Python dict iteration order.

The encoded layout matches the Scene IR `propertyValues` transport contract
(`madi.property-columns.1`):

- ``value_heap``    — every distinct value as canonical JSON, concatenated
                      UTF-8 bytes, sorted by encoded byte sequence;
- ``value_offsets`` — ``distinct_count + 1`` byte offsets into ``value_heap``
                      (offset ``i`` to ``i + 1`` brackets distinct value ``i``);
- ``row_refs``      — one u32 distinct-value index per (bag, position), in
                      bag order, positions aligned with the bag's key set;
- ``row_offsets``   — ``row_count + 1`` offsets into ``row_refs`` (in value
                      counts, not bytes); row ``r`` spans
                      ``row_refs[row_offsets[r]:row_offsets[r + 1]]``.
"""

from __future__ import annotations

import json
from typing import Any, Sequence

U32_LIMIT = 2**32


def encode_property_value(value: Any) -> bytes:
    """Canonical compact JSON encoding of one property value, as UTF-8.

    Matches the structure document's serialization settings so a value round
    trips bit-for-bit through either path (``sort_keys`` for compound values,
    no whitespace, non-ASCII kept literal, NaN rejected).
    """
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def encode_property_value_columns(
    rows: Sequence[Sequence[Any]],
) -> dict[str, Any]:
    """Builds the property value columns for ``rows[i]`` = bag ``i``'s values.

    Returns a dict with ``value_heap`` (bytes), ``value_offsets``,
    ``row_refs``, ``row_offsets`` (lists of ints) plus the ``value_count``,
    ``row_count``, and ``distinct_value_count`` totals.
    """
    encoded_rows = [[encode_property_value(value) for value in row] for row in rows]
    distinct = sorted({encoded for row in encoded_rows for encoded in row})
    positions = {encoded: index for index, encoded in enumerate(distinct)}

    row_refs: list[int] = []
    row_offsets: list[int] = [0]
    for row in encoded_rows:
        row_refs.extend(positions[encoded] for encoded in row)
        row_offsets.append(len(row_refs))

    value_offsets: list[int] = [0]
    for encoded in distinct:
        value_offsets.append(value_offsets[-1] + len(encoded))
    value_heap = b"".join(distinct)

    for limit_name, exceeded in (
        ("value heap bytes", len(value_heap) >= U32_LIMIT),
        ("value count", len(row_refs) >= U32_LIMIT),
        ("row count", len(encoded_rows) >= U32_LIMIT),
    ):
        if exceeded:
            raise ValueError(f"Property value columns exceed the u32 {limit_name} limit.")

    return {
        "value_heap": value_heap,
        "value_offsets": value_offsets,
        "row_refs": row_refs,
        "row_offsets": row_offsets,
        "value_count": len(row_refs),
        "row_count": len(encoded_rows),
        "distinct_value_count": len(distinct),
    }


def decode_property_row(columns: dict[str, Any], row: int) -> list[Any]:
    """Decodes one bag's values back from the columns (test/verification aid)."""
    start = columns["row_offsets"][row]
    end = columns["row_offsets"][row + 1]
    heap = columns["value_heap"]
    offsets = columns["value_offsets"]
    return [
        json.loads(heap[offsets[ref] : offsets[ref + 1]].decode("utf-8"))
        for ref in columns["row_refs"][start:end]
    ]
