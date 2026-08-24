import { describe, expect, it } from "vitest";

import { packagePropertiesSchema, parsePackageProperties } from "../src/index.js";

function streamRef(
  byteOffset: number,
  byteLength: number,
  encoding: "u32le" | "utf8-json" = "u32le",
): Record<string, unknown> {
  return { encoding, byteOffset, byteLength };
}

function validDocument(): Record<string, unknown> {
  return {
    schemaVersion: packagePropertiesSchema,
    status: "experimental-not-interchange",
    sceneId: "scene:demo",
    revisionId: "revision:1",
    sourceDigest: "d".repeat(64),
    propertyIndex: { keys: ["alpha", "beta"], sets: [[0], [0, 1]] },
    schemas: ["demo.pset"],
    semanticIds: ["semantic:a", "semantic:b"],
    semanticSchemas: [0, null],
    semanticSets: [0, 1],
    semanticRows: [0, 1],
    columns: { uri: "properties.bin", byteLength: 64, sha256: "0".repeat(64) },
    propertyValues: {
      encoding: "madi.property-columns.1",
      valueCount: 3,
      rowCount: 2,
      distinctValueCount: 2,
      rows: streamRef(0, 12),
      rowOffsets: streamRef(16, 12),
      valueOffsets: streamRef(32, 12),
      valueHeap: streamRef(48, 10, "utf8-json"),
    },
  };
}

describe("parsePackageProperties", () => {
  it("accepts a structurally valid sidecar document", () => {
    const document = validDocument();
    const parsed = parsePackageProperties(document);
    expect(parsed.semanticIds).toEqual(["semantic:a", "semantic:b"]);
    expect(parsed.columns.uri).toBe("properties.bin");
    expect(parsed.propertyValues.rowCount).toBe(2);
  });

  it("rejects an unsupported schema version", () => {
    expect(() =>
      parsePackageProperties({ ...validDocument(), schemaVersion: "madi.package-properties.2" }),
    ).toThrow(/unsupported schema version/u);
  });

  it("rejects a missing experimental status", () => {
    expect(() =>
      parsePackageProperties({ ...validDocument(), status: "stable" }),
    ).toThrow(/experimental status/u);
  });

  it("rejects semantic ids out of code-unit order or duplicated", () => {
    expect(() =>
      parsePackageProperties({
        ...validDocument(),
        semanticIds: ["semantic:b", "semantic:a"],
      }),
    ).toThrow(/sorted and unique/u);
    expect(() =>
      parsePackageProperties({
        ...validDocument(),
        semanticIds: ["semantic:a", "semantic:a"],
      }),
    ).toThrow(/sorted and unique/u);
  });

  it("rejects semantic columns of unequal length", () => {
    expect(() =>
      parsePackageProperties({ ...validDocument(), semanticRows: [0] }),
    ).toThrow(/equal lengths/u);
  });

  it("rejects out-of-range key set, row, and schema references", () => {
    expect(() =>
      parsePackageProperties({ ...validDocument(), semanticSets: [0, 2] }),
    ).toThrow(/unknown key set/u);
    expect(() =>
      parsePackageProperties({ ...validDocument(), semanticRows: [0, 2] }),
    ).toThrow(/unknown column row/u);
    expect(() =>
      parsePackageProperties({ ...validDocument(), semanticSchemas: [1, null] }),
    ).toThrow(/unknown schema/u);
  });

  it("rejects a malformed column file reference", () => {
    const document = validDocument();
    expect(() =>
      parsePackageProperties({
        ...document,
        columns: { ...(document.columns as object), sha256: "not-a-digest" },
      }),
    ).toThrow(/column file reference/u);
  });

  it("rejects a column header with the wrong encoding", () => {
    const document = validDocument();
    expect(() =>
      parsePackageProperties({
        ...document,
        propertyValues: {
          ...(document.propertyValues as object),
          encoding: "madi.property-columns.2",
        },
      }),
    ).toThrow(/column header/u);
  });
});
