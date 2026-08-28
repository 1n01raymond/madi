import type { PropertyColumnStreamRef, PropertyValue } from "./types.js";

/**
 * Reader over the external property value column file
 * (`madi.property-columns.1`). Browser-safe: only typed arrays,
 * `TextDecoder`, and `JSON.parse`, with each distinct value decoded lazily on
 * first use and cached — opening the columns never materializes the value
 * table.
 */

export const propertyColumnsEncoding = "madi.property-columns.1";

export interface PropertyValueColumnReader {
  readonly valueCount: number;
  readonly rowCount: number;
  readonly distinctValueCount: number;
  /** Number of values in row `row` without decoding any of them. */
  rowLength(row: number): number;
  /** Decodes row `row` into concrete property values (cached per distinct value). */
  rowValues(row: number): readonly PropertyValue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStreamRef(value: unknown): value is PropertyColumnStreamRef {
  return (
    isRecord(value) &&
    (value.encoding === "u32le" || value.encoding === "utf8-json") &&
    Number.isSafeInteger(value.byteOffset) &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteOffset as number) >= 0 &&
    (value.byteLength as number) >= 0
  );
}

function streamRef(
  header: Record<string, unknown>,
  name: string,
  encoding: PropertyColumnStreamRef["encoding"],
  byteLength: number,
): PropertyColumnStreamRef {
  const ref = header[name];
  if (!isStreamRef(ref) || ref.encoding !== encoding) {
    throw new TypeError(`Property column stream ${name} must be a ${encoding} reference.`);
  }
  if (ref.byteOffset + ref.byteLength > byteLength) {
    throw new RangeError(`Property column stream ${name} exceeds the column file.`);
  }
  return ref;
}

function u32View(bytes: Uint8Array, ref: PropertyColumnStreamRef, name: string): Uint32Array {
  if (ref.byteLength % 4 !== 0) {
    throw new TypeError(`Property column stream ${name} must align to 4 bytes.`);
  }
  const start = bytes.byteOffset + ref.byteOffset;
  if (start % 4 !== 0) {
    // The file aligns every stream; an unaligned start can only come from the
    // caller's backing buffer. Copy the slice once into its own allocation.
    const owned = new Uint8Array(ref.byteLength);
    owned.set(bytes.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength));
    return new Uint32Array(owned.buffer);
  }
  return new Uint32Array(bytes.buffer as ArrayBuffer, start, ref.byteLength / 4);
}

function nonNegativeCount(header: Record<string, unknown>, name: string): number {
  const value = header[name];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Property column count ${name} must be a non-negative integer.`);
  }
  return value as number;
}

/**
 * Validates the column header and the structural integrity of the column file
 * (offset tables monotone and bracketing, references in range) and returns a
 * lazy reader. Throws on any inconsistency; run this before trusting either.
 */
export function openPropertyValueColumns(
  header: unknown,
  file: Uint8Array,
): PropertyValueColumnReader {
  if (!isRecord(header) || header.encoding !== propertyColumnsEncoding) {
    throw new TypeError(
      `Property value columns must declare encoding ${propertyColumnsEncoding}.`,
    );
  }
  const valueCount = nonNegativeCount(header, "valueCount");
  const rowCount = nonNegativeCount(header, "rowCount");
  const distinctValueCount = nonNegativeCount(header, "distinctValueCount");

  const rows = u32View(file, streamRef(header, "rows", "u32le", file.byteLength), "rows");
  const rowOffsets = u32View(
    file,
    streamRef(header, "rowOffsets", "u32le", file.byteLength),
    "rowOffsets",
  );
  const valueOffsets = u32View(
    file,
    streamRef(header, "valueOffsets", "u32le", file.byteLength),
    "valueOffsets",
  );
  const heapRef = streamRef(header, "valueHeap", "utf8-json", file.byteLength);
  const heap = file.subarray(heapRef.byteOffset, heapRef.byteOffset + heapRef.byteLength);

  if (rows.length !== valueCount) {
    throw new RangeError("Property column rows stream does not match valueCount.");
  }
  if (rowOffsets.length !== rowCount + 1) {
    throw new RangeError("Property column rowOffsets stream does not match rowCount.");
  }
  if (valueOffsets.length !== distinctValueCount + 1) {
    throw new RangeError("Property column valueOffsets stream does not match distinctValueCount.");
  }
  if (rowOffsets.length > 0 && rowOffsets[0] !== 0) {
    throw new RangeError("Property column rowOffsets must start at zero.");
  }
  for (let index = 1; index < rowOffsets.length; index += 1) {
    if ((rowOffsets[index] as number) < (rowOffsets[index - 1] as number)) {
      throw new RangeError("Property column rowOffsets must be monotone.");
    }
  }
  if ((rowOffsets[rowCount] ?? 0) !== valueCount) {
    throw new RangeError("Property column rowOffsets must end at valueCount.");
  }
  if (valueOffsets.length > 0 && valueOffsets[0] !== 0) {
    throw new RangeError("Property column valueOffsets must start at zero.");
  }
  for (let index = 1; index < valueOffsets.length; index += 1) {
    if ((valueOffsets[index] as number) < (valueOffsets[index - 1] as number)) {
      throw new RangeError("Property column valueOffsets must be monotone.");
    }
  }
  if ((valueOffsets[distinctValueCount] ?? 0) !== heap.byteLength) {
    throw new RangeError("Property column valueOffsets must end at the heap length.");
  }
  for (let index = 0; index < rows.length; index += 1) {
    if ((rows[index] as number) >= distinctValueCount) {
      throw new RangeError("Property column row reference exceeds the distinct value table.");
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decoded: (PropertyValue | undefined)[] = new Array<PropertyValue | undefined>(
    distinctValueCount,
  );
  const distinctValue = (reference: number): PropertyValue => {
    const cached = decoded[reference];
    if (cached !== undefined) return cached;
    const text = decoder.decode(
      heap.subarray(valueOffsets[reference], valueOffsets[reference + 1]),
    );
    const value = JSON.parse(text) as PropertyValue;
    // `null` is a valid property value; re-parsing it on every use is cheap
    // and keeps the cache sentinel unambiguous.
    if (value !== null) decoded[reference] = value;
    return value;
  };
  const checkRow = (row: number): void => {
    if (!Number.isSafeInteger(row) || row < 0 || row >= rowCount) {
      throw new RangeError(`Unknown property value row ${String(row)}.`);
    }
  };

  return {
    valueCount,
    rowCount,
    distinctValueCount,
    rowLength(row) {
      checkRow(row);
      return (rowOffsets[row + 1] as number) - (rowOffsets[row] as number);
    },
    rowValues(row) {
      checkRow(row);
      const values: PropertyValue[] = [];
      for (
        let index = rowOffsets[row] as number;
        index < (rowOffsets[row + 1] as number);
        index += 1
      ) {
        values.push(distinctValue(rows[index] as number));
      }
      return values;
    },
  };
}
