import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  openPropertyValueColumns,
  packagePropertiesSchema,
  parsePackageProperties,
  resolvePropertyEntries,
} from "@madi/scene-ir";
import type {
  EngineeringScene,
  PropertyBag,
  PropertyValue,
  PropertyValueColumns,
} from "@madi/scene-ir";
import { describe, expect, it } from "vitest";

import {
  compileSceneToGltf,
  experimentalGltfProfile,
  validateCompiledGltf,
} from "../src/index.js";
import { hydratePhase0Evidence } from "../src/evidence-input.js";

const evidenceUrl = new URL(
  "../../../artifacts/occt/repeated-fasteners.scene.json",
  import.meta.url,
);
const compiledArtifactUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners/",
  import.meta.url,
);

async function compileEvidence(options: Parameters<typeof compileSceneToGltf>[1] = {}) {
  const serialized = JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown;
  return compileSceneToGltf(hydratePhase0Evidence(serialized), options);
}

function madiExtras(value: { readonly extras?: Readonly<Record<string, unknown>> }) {
  return value.extras?.madi as Record<string, unknown> | undefined;
}

describe("Phase 1 glTF compiler slice", () => {
  it("compiles OCCT evidence into a validator-clean standards-first package", async () => {
    const compiled = await compileEvidence();
    const validation = validateCompiledGltf(compiled.document, compiled.binary);

    expect(validation).toEqual({ ok: true, issues: [] });
    expect(compiled.document.asset.version).toBe("2.0");
    expect((compiled.document.extras.madi as Record<string, unknown>).profile).toBe(
      experimentalGltfProfile,
    );
    expect(compiled.document.buffers).toEqual([
      { uri: "scene.bin", byteLength: compiled.binary.byteLength },
    ]);
    expect(compiled.report.counts).toMatchObject({
      compiledPrototypeCount: 3,
      occurrenceCount: 12,
      renderableOccurrenceCount: 10,
      gltfNodeCount: 13,
      gltfMeshCount: 3,
      triangleCount: 2076,
      edgeSegmentCount: 181,
    });
  });

  it("preserves authored hierarchy, explicit edges, and fastener mesh reuse", async () => {
    const compiled = await compileEvidence();
    const fasteners = compiled.document.nodes.filter(
      (node) => madiExtras(node)?.prototypeId === "prototype:part:fastener-01",
    );

    expect(compiled.document.scenes[0].nodes).toEqual([0]);
    expect(compiled.document.nodes[0]?.children).toHaveLength(1);
    expect(fasteners).toHaveLength(8);
    expect(new Set(fasteners.map(({ mesh }) => mesh))).toHaveLength(1);
    const fastenerMesh = compiled.document.meshes[fasteners[0]?.mesh ?? -1];
    expect(fastenerMesh?.primitives.map(({ mode }) => mode)).toEqual([4, 1]);
    expect(madiExtras(fastenerMesh ?? { primitives: [] })).toMatchObject({
      prototypeId: "prototype:part:fastener-01",
    });
    expect(madiExtras(fastenerMesh?.primitives[1] ?? { attributes: {}, mode: 1 })).toMatchObject({
      kind: "explicit-cad-edges",
    });
  });

  it("produces byte-identical output for identical inputs and options", async () => {
    const first = await compileEvidence();
    const second = await compileEvidence();

    expect(second.json).toBe(first.json);
    expect(second.binary).toEqual(first.binary);
    expect(second.report).toEqual(first.report);
  });

  it("emits deterministic prototype bounds in a separate standard glTF buffer", async () => {
    const serialized = JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown;
    const compiled = compileSceneToGltf(hydratePhase0Evidence(serialized), {
      coarseBounds: true,
    });
    expect(compiled.coarseBinary).toBeDefined();
    const validation = validateCompiledGltf(compiled.document, [
      compiled.binary,
      compiled.coarseBinary ?? new Uint8Array(),
    ]);

    expect(validation).toEqual({ ok: true, issues: [] });
    expect(compiled.document.buffers).toEqual([
      { uri: "scene.bin", byteLength: compiled.binary.byteLength },
      { uri: "coarse.bin", byteLength: compiled.coarseBinary?.byteLength },
    ]);
    expect(compiled.document.bufferViews.some(({ buffer }) => buffer === 0)).toBe(true);
    expect(compiled.document.bufferViews.some(({ buffer }) => buffer === 1)).toBe(true);
    expect(compiled.document.nodes.filter((node) => madiExtras(node)?.coarseMesh !== undefined))
      .toHaveLength(10);
    expect(compiled.report.options).toMatchObject({
      coarseBinaryUri: "coarse.bin",
      progressiveRepresentation: "prototype-aabb-v1",
      targetChunking: "prototype-range-v1",
    });
    const progressive = (compiled.document.extras.madi as {
      progressive: { targetChunks: readonly { byteOffset: number; byteLength: number }[] };
    }).progressive;
    expect(progressive.targetChunks).toHaveLength(3);
    expect(
      progressive.targetChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    ).toBe(compiled.binary.byteLength);
    expect(compiled.report.counts.targetChunkCount).toBe(3);
  });

  it("coalesces adjacent target prototype ranges when a request budget is declared", async () => {
    const compiled = await compileEvidence({
      coarseBounds: true,
      targetChunkByteBudget: 100_000,
    });
    const progressive = (compiled.document.extras.madi as {
      progressive: {
        targetChunks: readonly {
          byteOffset: number;
          byteLength: number;
          prototypeId: string;
          prototypeIds: readonly string[];
        }[];
      };
    }).progressive;

    expect(compiled.report.options).toMatchObject({
      targetChunking: "coalesced-prototype-range-v1",
      targetChunkByteBudget: 100_000,
    });
    expect(progressive.targetChunks).toHaveLength(2);
    expect(progressive.targetChunks[0]).toMatchObject({
      prototypeId: "prototype:part:center-rail",
      prototypeIds: ["prototype:part:center-rail", "prototype:part:fastener-01"],
    });
    expect(
      progressive.targetChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    ).toBe(compiled.binary.byteLength);
    expect(compiled.report.counts.targetChunkCount).toBe(2);
  });

  it("reproduces the committed compiler artifact byte for byte", async () => {
    const compiled = await compileEvidence();
    const [json, binary, report] = await Promise.all([
      readFile(new URL("scene.gltf", compiledArtifactUrl), "utf8"),
      readFile(new URL("scene.bin", compiledArtifactUrl)),
      readFile(new URL("build-report.json", compiledArtifactUrl), "utf8").then(JSON.parse),
    ]);

    expect(compiled.json).toBe(json);
    expect(Buffer.from(compiled.binary)).toEqual(binary);
    expect(compiled.report).toEqual(report);
  });

  it("rejects a binary resource whose size differs from the glTF declaration", async () => {
    const compiled = await compileEvidence();
    const validation = validateCompiledGltf(
      compiled.document,
      compiled.binary.subarray(0, compiled.binary.byteLength - 4),
    );

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: "BUFFER_LENGTH", path: "buffers[0]" }),
    );
  });
});

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
          `${JSON.stringify(key)}:${canonical(
            (value as Record<string, PropertyValue>)[key] as PropertyValue,
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Rewrites the evidence scene's inline property bags into split.3 column
 * form: keys and key sets interned into the scene `propertyIndex`, semantics
 * keeping `{set, row}`, and every value moved into an adapter-layout column
 * file (8-aligned streams, byte-sorted distinct heap).
 */
function toColumnScene(base: EngineeringScene): {
  readonly scene: EngineeringScene;
  readonly columns: Uint8Array;
} {
  const inline = base.semantics.map((semantic) => semantic.properties as PropertyBag);
  const keys = [...new Set(inline.flatMap((bag) => Object.keys(bag.entries)))].sort();
  const keyIndexes = new Map(keys.map((key, index) => [key, index]));
  const sets: (readonly number[])[] = [];
  const setIndexes = new Map<string, number>();
  const valueRows: PropertyValue[][] = [];
  const semantics = base.semantics.map((semantic, row) => {
    const bag = semantic.properties as PropertyBag;
    const sorted = Object.keys(bag.entries).sort();
    const tuple = sorted.map((key) => keyIndexes.get(key) as number);
    const token = tuple.join(",");
    if (!setIndexes.has(token)) {
      setIndexes.set(token, sets.length);
      sets.push(tuple);
    }
    valueRows.push(sorted.map((key) => bag.entries[key] as PropertyValue));
    return {
      ...semantic,
      properties: {
        ...(bag.schema === undefined ? {} : { schema: bag.schema }),
        set: setIndexes.get(token) as number,
        row,
      },
    };
  });

  const encoder = new TextEncoder();
  const encodedRows = valueRows.map((row) => row.map((value) => encoder.encode(canonical(value))));
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
  const heap = new Uint8Array(valueOffsets.at(-1) as number);
  distinct.forEach((encoded, index) => heap.set(encoded, valueOffsets[index] as number));

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
  const header: PropertyValueColumns = {
    encoding: "madi.property-columns.1",
    valueCount: rowRefs.length,
    rowCount: valueRows.length,
    distinctValueCount: distinct.length,
    rows: append(new Uint8Array(Uint32Array.from(rowRefs).buffer), "u32le"),
    rowOffsets: append(new Uint8Array(Uint32Array.from(rowOffsets).buffer), "u32le"),
    valueOffsets: append(new Uint8Array(Uint32Array.from(valueOffsets).buffer), "u32le"),
    valueHeap: append(heap, "utf8-json"),
  };
  const columns = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    columns.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return {
    scene: {
      ...base,
      semantics,
      propertyIndex: { keys, sets },
      propertyValues: header,
    } as EngineeringScene,
    columns,
  };
}

describe("compiled-package property sidecar", () => {
  async function columnEvidence(): Promise<{
    readonly base: EngineeringScene;
    readonly scene: EngineeringScene;
    readonly columns: Uint8Array;
  }> {
    const serialized = JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown;
    const base = hydratePhase0Evidence(serialized);
    return { base, ...toColumnScene(base) };
  }

  it("emits both sidecar resources with a verifiable pointer and report", async () => {
    const { base, scene, columns } = await columnEvidence();
    const compiled = compileSceneToGltf(scene, { propertyColumns: columns });

    expect(compiled.propertiesBinary).toEqual(columns);
    expect(compiled.report.options).toMatchObject({
      propertiesUri: "properties.json",
      propertiesBinaryUri: "properties.bin",
    });
    const jsonBytes = new TextEncoder().encode(compiled.propertiesJson as string);
    const pointer = (compiled.document.extras.madi as {
      properties: Record<string, unknown>;
    }).properties;
    expect(pointer).toEqual({
      schemaVersion: packagePropertiesSchema,
      uri: "properties.json",
      byteLength: jsonBytes.byteLength,
      sha256: createHash("sha256").update(jsonBytes).digest("hex"),
    });
    expect(compiled.report.output.resources).toContainEqual({
      path: "properties.json",
      mediaType: "application/json",
      bytes: jsonBytes.byteLength,
      sha256: createHash("sha256").update(jsonBytes).digest("hex"),
    });
    expect(compiled.report.output.resources).toContainEqual({
      path: "properties.bin",
      mediaType: "application/octet-stream",
      bytes: columns.byteLength,
      sha256: createHash("sha256").update(columns).digest("hex"),
    });

    const document = parsePackageProperties(JSON.parse(compiled.propertiesJson as string));
    expect(document.columns).toEqual({
      uri: "properties.bin",
      byteLength: columns.byteLength,
      sha256: createHash("sha256").update(columns).digest("hex"),
    });
    const reader = openPropertyValueColumns(document.propertyValues, columns);
    for (const semantic of base.semantics) {
      const index = document.semanticIds.indexOf(semantic.id);
      expect(index).toBeGreaterThanOrEqual(0);
      const resolved = resolvePropertyEntries(
        {
          set: document.semanticSets[index] as number,
          row: document.semanticRows[index] as number,
        },
        document.propertyIndex,
        reader,
      );
      expect(resolved).toEqual((semantic.properties as PropertyBag).entries);
    }
  });

  it("covers the sidecar in the package digest and stays deterministic", async () => {
    const { base, scene, columns } = await columnEvidence();
    const first = compileSceneToGltf(scene, { propertyColumns: columns });
    const second = compileSceneToGltf(scene, { propertyColumns: columns });
    const withoutProperties = compileSceneToGltf(base, {});

    expect(second.propertiesJson).toBe(first.propertiesJson);
    expect(second.propertiesBinary).toEqual(first.propertiesBinary);
    expect(second.report).toEqual(first.report);
    expect(first.report.output.packageDigest).toBe(
      createHash("sha256")
        .update(first.json)
        .update(first.binary)
        .update(new TextEncoder().encode(first.propertiesJson as string))
        .update(columns)
        .digest("hex"),
    );
    expect(first.report.output.packageDigest).not.toBe(
      withoutProperties.report.output.packageDigest,
    );
  });

  it("requires the column file for scenes with property value columns", async () => {
    const { scene } = await columnEvidence();
    expect(() => compileSceneToGltf(scene, {})).toThrow(
      /requires options\.propertyColumns/u,
    );
  });

  it("rejects a column file without scene property tables", async () => {
    const serialized = JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown;
    const base = hydratePhase0Evidence(serialized);
    expect(() =>
      compileSceneToGltf(base, { propertyColumns: new Uint8Array(8) }),
    ).toThrow(/property value columns|propertyIndex/u);
  });

  it("rejects sidecar URIs that collide with package resources", async () => {
    const { scene, columns } = await columnEvidence();
    expect(() =>
      compileSceneToGltf(scene, { propertyColumns: columns, propertiesUri: "scene.bin" }),
    ).toThrow(/distinct URIs/u);
    expect(() =>
      compileSceneToGltf(scene, {
        propertyColumns: columns,
        propertiesBinaryUri: "properties.json",
      }),
    ).toThrow(/distinct URIs/u);
  });
});
