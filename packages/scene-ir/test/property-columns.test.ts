import { describe, expect, it } from "vitest";

import {
  openPropertyValueColumns,
  resolvePropertyEntries,
  validateScene,
} from "../src/index.js";
import { createRepeatedTriangleScene } from "../src/fixture.js";
import type {
  EngineeringScene,
  PropertyValue,
  PropertyValueColumns,
} from "../src/types.js";

/** Canonical compact JSON with sorted keys, matching the adapter encoder. */
function canonical(value: PropertyValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonical(entry as PropertyValue)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, PropertyValue>)[key] as PropertyValue)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface BuiltColumns {
  readonly header: PropertyValueColumns;
  readonly file: Uint8Array;
}

/** Builds a column file the way the adapter does: 8-aligned streams, byte-sorted heap. */
function buildColumns(rows: readonly (readonly PropertyValue[])[]): BuiltColumns {
  const encoder = new TextEncoder();
  const encodedRows = rows.map((row) => row.map((value) => encoder.encode(canonical(value))));
  const byBytes = new Map<string, Uint8Array>();
  for (const encoded of encodedRows.flat()) {
    byBytes.set(String.fromCharCode(...encoded), encoded);
  }
  const distinct = [...byBytes.keys()].sort().map((token) => byBytes.get(token) as Uint8Array);
  const positions = new Map(
    distinct.map((encoded, index) => [String.fromCharCode(...encoded), index]),
  );
  const rowRefs: number[] = [];
  const rowOffsets: number[] = [0];
  for (const row of encodedRows) {
    for (const encoded of row) {
      rowRefs.push(positions.get(String.fromCharCode(...encoded)) as number);
    }
    rowOffsets.push(rowRefs.length);
  }
  const valueOffsets: number[] = [0];
  for (const encoded of distinct) {
    valueOffsets.push((valueOffsets.at(-1) as number) + encoded.byteLength);
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  const append = (payload: Uint8Array, encoding: "u32le" | "utf8-json") => {
    const padding = (8 - (length % 8)) % 8;
    if (padding) {
      chunks.push(new Uint8Array(padding));
      length += padding;
    }
    const ref = { encoding, byteOffset: length, byteLength: payload.byteLength };
    chunks.push(payload);
    length += payload.byteLength;
    return ref;
  };
  const heap = new Uint8Array(valueOffsets.at(-1) as number);
  distinct.forEach((encoded, index) => heap.set(encoded, valueOffsets[index]));
  const header: PropertyValueColumns = {
    encoding: "madi.property-columns.1",
    valueCount: rowRefs.length,
    rowCount: rows.length,
    distinctValueCount: distinct.length,
    rows: append(new Uint8Array(Uint32Array.from(rowRefs).buffer), "u32le"),
    rowOffsets: append(new Uint8Array(Uint32Array.from(rowOffsets).buffer), "u32le"),
    valueOffsets: append(new Uint8Array(Uint32Array.from(valueOffsets).buffer), "u32le"),
    valueHeap: append(heap, "utf8-json"),
  };
  const file = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    file.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return { header, file };
}

const sampleRows: readonly (readonly PropertyValue[])[] = [
  ["first", 2, null],
  [],
  ["first", { type: "quantity", value: 1.5, unit: "m" }, "Dëck famïly"],
];

describe("property value column reader", () => {
  it("round trips every row lazily", () => {
    const { header, file } = buildColumns(sampleRows);
    const reader = openPropertyValueColumns(header, file);
    expect(reader.valueCount).toBe(6);
    expect(reader.rowCount).toBe(3);
    expect(reader.distinctValueCount).toBe(5);
    expect(sampleRows.map((_, row) => reader.rowValues(row))).toEqual(sampleRows);
    expect(reader.rowLength(1)).toBe(0);
  });

  it("reads an unaligned backing buffer through the copy fallback", () => {
    const { header, file } = buildColumns(sampleRows);
    const shifted = new Uint8Array(file.byteLength + 1);
    shifted.set(file, 1);
    const reader = openPropertyValueColumns(header, shifted.subarray(1));
    expect(reader.rowValues(0)).toEqual(sampleRows[0]);
  });

  it("rejects rowOffsets that do not end at valueCount", () => {
    const { header, file } = buildColumns(sampleRows);
    expect(() =>
      openPropertyValueColumns({ ...header, valueCount: header.valueCount + 1 }, file),
    ).toThrow(/rows stream does not match valueCount/u);
  });

  it("rejects references outside the distinct value table", () => {
    const { header, file } = buildColumns(sampleRows);
    const corrupted = file.slice();
    new Uint32Array(corrupted.buffer, header.rows.byteOffset, 1)[0] = 999;
    expect(() => openPropertyValueColumns(header, corrupted)).toThrow(
      /exceeds the distinct value table/u,
    );
  });

  it("rejects a heap the offsets do not bracket", () => {
    const { header, file } = buildColumns(sampleRows);
    const truncatedHeap = {
      ...header,
      valueHeap: { ...header.valueHeap, byteLength: header.valueHeap.byteLength - 1 },
    };
    expect(() => openPropertyValueColumns(truncatedHeap, file)).toThrow(
      /must end at the heap length/u,
    );
  });

  it("rejects a stream that leaves the file", () => {
    const { header, file } = buildColumns(sampleRows);
    expect(() => openPropertyValueColumns(header, file.subarray(0, 8))).toThrow(
      /exceeds the column file/u,
    );
  });
});

describe("column property bag resolution", () => {
  const propertyIndex = {
    keys: ["alpha", "beta", "gamma"],
    sets: [[0, 1, 2], [], [0, 1, 2]],
  };

  it("joins keys from the propertyIndex with values from the columns", () => {
    const { header, file } = buildColumns(sampleRows);
    const reader = openPropertyValueColumns(header, file);
    expect(
      resolvePropertyEntries({ set: 2, row: 2 }, propertyIndex, reader),
    ).toEqual({
      alpha: "first",
      beta: { type: "quantity", value: 1.5, unit: "m" },
      gamma: "Dëck famïly",
    });
    expect(resolvePropertyEntries({ set: 1, row: 1 }, propertyIndex, reader)).toEqual({});
  });

  it("requires a reader for column bags", () => {
    expect(() => resolvePropertyEntries({ set: 0, row: 0 }, propertyIndex)).toThrow(
      /require a property value column reader/u,
    );
  });

  it("rejects a row whose length does not match its key set", () => {
    const { header, file } = buildColumns(sampleRows);
    const reader = openPropertyValueColumns(header, file);
    expect(() => resolvePropertyEntries({ set: 0, row: 1 }, propertyIndex, reader)).toThrow(
      /expects 3 values/u,
    );
  });
});

describe("validateScene with column properties", () => {
  function columnScene(row: number, withTables = true): EngineeringScene {
    const base = createRepeatedTriangleScene();
    const scene = {
      ...base,
      semantics: base.semantics.map((semantic) => ({
        ...semantic,
        properties: { set: 0, row },
      })),
    } as EngineeringScene;
    if (!withTables) return scene;
    const { header } = buildColumns(
      base.semantics.map(() => ["value"]),
    );
    return {
      ...scene,
      propertyIndex: { keys: ["alpha"], sets: [[0]] },
      propertyValues: header,
    };
  }

  it("accepts in-range column bags", () => {
    const result = validateScene(columnScene(0));
    expect(result.issues.filter(({ code }) => code.startsWith("PROPERTY"))).toEqual([]);
    expect(
      result.issues.filter(({ code }) => code === "MISSING_PROPERTY_COLUMNS"),
    ).toEqual([]);
  });

  it("flags a row outside the declared row count", () => {
    const result = validateScene(columnScene(99));
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "PROPERTY_ROW_OUT_OF_RANGE")).toBe(true);
  });

  it("flags column bags without the scene tables", () => {
    const result = validateScene(columnScene(0, false));
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "MISSING_PROPERTY_COLUMNS")).toBe(true);
  });
});
