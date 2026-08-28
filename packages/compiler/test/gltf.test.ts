import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  createRepeatedTriangleScene,
  ids,
  openPropertyValueColumns,
  packagePropertiesSchema,
  parsePackageProperties,
  resolvePropertyEntries,
} from "@naru3d/scene-ir";
import type {
  EngineeringScene,
  PropertyBag,
  PropertyValue,
  PropertyValueColumns,
} from "@naru3d/scene-ir";
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

function createSpatialPackingScene(): EngineeringScene {
  const base = createRepeatedTriangleScene();
  const prototype = base.prototypes[0];
  const representation = base.representations[0];
  if (!prototype || !representation) throw new TypeError("Triangle fixture is incomplete.");
  const entries = [
    { suffix: "a", x: -10 },
    { suffix: "b", x: 10 },
    { suffix: "c", x: -9 },
    { suffix: "d", x: 9 },
  ] as const;
  return {
    ...base,
    sceneId: "scene:spatial-payload-packing",
    prototypes: entries.map(({ suffix }) => {
      const prototypeId = ids.prototype(`prototype:spatial:${suffix}`);
      return {
        ...prototype,
        id: prototypeId,
        name: `Spatial ${suffix}`,
        representationIds: [ids.representation(`representation:spatial:${suffix}`)],
      };
    }),
    occurrences: entries.map(({ suffix, x }) => ({
      ...base.occurrences[0]!,
      id: ids.occurrence(`occurrence:spatial:${suffix}`),
      prototypeId: ids.prototype(`prototype:spatial:${suffix}`),
      name: `Spatial ${suffix}`,
      localTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1],
    })),
    representations: entries.map(({ suffix }) => ({
      ...representation,
      id: ids.representation(`representation:spatial:${suffix}`),
      prototypeId: ids.prototype(`prototype:spatial:${suffix}`),
    })),
  };
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

  it("retains sub-millimetre node translations at a large world offset", () => {
    const base = createRepeatedTriangleScene();
    const translation = 10_000_000.000_25;
    const scene: EngineeringScene = {
      ...base,
      occurrences: base.occurrences.map((occurrence, index) => ({
        ...occurrence,
        localTransform: index === 0
          ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation, -7_000_000, 3_000_000, 1]
          : occurrence.localTransform,
      })),
    };
    const compiled = compileSceneToGltf(scene);
    const node = compiled.document.nodes.find(
      (candidate) => madiExtras(candidate)?.occurrenceId === "occurrence:triangle:left",
    );

    expect(node?.matrix?.[12]).toBe(translation);
    expect(Math.fround(node?.matrix?.[12] ?? 0)).not.toBe(translation);
    expect(validateCompiledGltf(compiled.document, compiled.binary)).toEqual({
      ok: true,
      issues: [],
    });
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

  it("can compact scene.gltf without changing its document", async () => {
    const pretty = await compileEvidence({ coarseBounds: true });
    const compact = await compileEvidence({ coarseBounds: true, compactJson: true });

    expect(JSON.parse(compact.json)).toEqual(JSON.parse(pretty.json));
    expect(compact.json.length).toBeLessThan(pretty.json.length);
    expect(compact.json).not.toContain("\n  \"");
    expect(compact.report.options.jsonFormatting).toBe("compact");
    expect(pretty.report.options.jsonFormatting).toBeUndefined();
  });

  it("can omit only non-semantic glTF resource names", async () => {
    const named = await compileEvidence({ coarseBounds: true });
    const unnamed = await compileEvidence({ coarseBounds: true, omitResourceNames: true });
    const expectedDocument = JSON.parse(named.json) as {
      meshes: { name?: string }[];
      bufferViews: { name?: string }[];
      accessors: { name?: string }[];
    };

    for (const resource of [
      ...expectedDocument.meshes,
      ...expectedDocument.bufferViews,
      ...expectedDocument.accessors,
    ]) {
      delete resource.name;
    }

    expect(named.document.meshes.every(({ name }) => name !== undefined)).toBe(true);
    expect(named.document.bufferViews.every(({ name }) => name !== undefined)).toBe(true);
    expect(named.document.accessors.every(({ name }) => name !== undefined)).toBe(true);
    expect(unnamed.document.meshes.every(({ name }) => name === undefined)).toBe(true);
    expect(unnamed.document.bufferViews.every(({ name }) => name === undefined)).toBe(true);
    expect(unnamed.document.accessors.every(({ name }) => name === undefined)).toBe(true);
    expect(unnamed.document).toEqual(expectedDocument);
    expect(unnamed.binary).toEqual(named.binary);
    expect(unnamed.coarseBinary).toEqual(named.coarseBinary);
    expect(unnamed.report.options.resourceNames).toBe("omitted");
    expect(named.report.options.resourceNames).toBeUndefined();
    expect(validateCompiledGltf(unnamed.document, [
      unnamed.binary,
      unnamed.coarseBinary as Uint8Array,
    ])).toEqual({ ok: true, issues: [] });
  });

  it("validates unnamed POSITION accessor bounds from primitive references", async () => {
    const unnamed = await compileEvidence({ omitResourceNames: true });
    const corrupted = JSON.parse(unnamed.json) as typeof unnamed.document;
    const positionAccessorIndex = corrupted.meshes[0]?.primitives[0]?.attributes.POSITION;
    if (positionAccessorIndex === undefined) {
      throw new TypeError("Compiler fixture is missing a POSITION accessor.");
    }
    const positionAccessor = corrupted.accessors[positionAccessorIndex] as {
      min?: readonly number[];
      max?: readonly number[];
    };
    delete positionAccessor.min;
    delete positionAccessor.max;

    const validation = validateCompiledGltf(corrupted, unnamed.binary);

    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "POSITION_BOUNDS",
      path: `accessors[${positionAccessorIndex}]`,
    }));
  });

  it("adds a deterministic spatial sidecar without changing target or coarse geometry", async () => {
    const baseline = await compileEvidence({ coarseBounds: true });
    const first = await compileEvidence({
      coarseBounds: true,
      spatialIndex: true,
      spatialLeafCapacity: 2,
    });
    const second = await compileEvidence({
      coarseBounds: true,
      spatialIndex: true,
      spatialLeafCapacity: 2,
    });
    const progressive = (first.document.extras.madi as {
      progressive: { spatialIndex: Record<string, unknown> };
    }).progressive;
    const spatial = first.spatialBinary as Uint8Array;

    expect(first.binary).toEqual(baseline.binary);
    expect(first.coarseBinary).toEqual(baseline.coarseBinary);
    expect(first.spatialBinaryUri).toBe("spatial.bin");
    expect(second.spatialBinary).toEqual(spatial);
    expect(second.report).toEqual(first.report);
    expect(progressive.spatialIndex).toEqual({
      schemaVersion: "naru.spatial-demand-index.1",
      uri: "spatial.bin",
      byteLength: spatial.byteLength,
      sha256: createHash("sha256").update(spatial).digest("hex"),
    });
    expect(first.report.output.resources).toContainEqual({
      path: "spatial.bin",
      mediaType: "application/octet-stream",
      bytes: spatial.byteLength,
      sha256: createHash("sha256").update(spatial).digest("hex"),
    });
    expect(first.report.output.packageDigest).toBe(
      createHash("sha256")
        .update(first.json)
        .update(first.binary)
        .update(first.coarseBinary as Uint8Array)
        .update(spatial)
        .digest("hex"),
    );
    expect(first.report.output.packageDigest).not.toBe(baseline.report.output.packageDigest);
  });

  it("requires coarse bounds and distinct package URIs for a spatial sidecar", async () => {
    await expect(compileEvidence({ spatialIndex: true })).rejects.toThrow(
      /requires coarse bounds/u,
    );
    await expect(
      compileEvidence({
        coarseBounds: true,
        spatialIndex: true,
        spatialBinaryUri: "scene.bin",
      }),
    ).rejects.toThrow(/must be distinct/u);
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

  it("orders opt-in payload ranges by dominant spatial leaf before coalescing", () => {
    const scene = createSpatialPackingScene();
    const prototypeRanges = compileSceneToGltf(scene, { coarseBounds: true });
    const singlePrototypeBytes = ((prototypeRanges.document.extras.madi as {
      progressive: { targetChunks: readonly { byteLength: number }[] };
    }).progressive.targetChunks[0]?.byteLength) ?? 0;
    const options = {
      coarseBounds: true,
      targetChunkByteBudget: singlePrototypeBytes * 2,
      spatialIndex: true,
      spatialLeafCapacity: 2,
    } as const;
    const baseline = compileSceneToGltf(scene, options);
    const packed = compileSceneToGltf(scene, { ...options, spatialPayloadOrder: true });
    const repeated = compileSceneToGltf(scene, { ...options, spatialPayloadOrder: true });
    const permuted = compileSceneToGltf({
      ...scene,
      prototypes: [...scene.prototypes].reverse(),
      occurrences: [...scene.occurrences].reverse(),
      representations: [...scene.representations].reverse(),
    }, { ...options, spatialPayloadOrder: true });
    const chunksFor = (compiled: typeof packed) => ((compiled.document.extras.madi as {
      progressive: {
        targetPayloadOrder?: string;
        targetChunks: readonly { prototypeIds: readonly string[] }[];
      };
    }).progressive);
    const baselineChunks = chunksFor(baseline).targetChunks;
    const packedProgressive = chunksFor(packed);
    const chunksDemandedBy = (
      chunks: readonly { prototypeIds: readonly string[] }[],
      prototypes: readonly string[],
    ): number => new Set(
      prototypes.flatMap((prototypeId) =>
        chunks.flatMap((chunk, index) => chunk.prototypeIds.includes(prototypeId) ? [index] : []),
      ),
    ).size;

    expect(baselineChunks.map(({ prototypeIds }) => prototypeIds)).toEqual([
      ["prototype:spatial:a", "prototype:spatial:b"],
      ["prototype:spatial:c", "prototype:spatial:d"],
    ]);
    expect(packedProgressive.targetChunks.map(({ prototypeIds }) => prototypeIds)).toEqual([
      ["prototype:spatial:a", "prototype:spatial:c"],
      ["prototype:spatial:b", "prototype:spatial:d"],
    ]);
    expect(chunksDemandedBy(baselineChunks, ["prototype:spatial:a", "prototype:spatial:c"]))
      .toBe(2);
    expect(chunksDemandedBy(packedProgressive.targetChunks, [
      "prototype:spatial:a",
      "prototype:spatial:c",
    ])).toBe(1);
    expect(packedProgressive.targetPayloadOrder).toBe("spatial-leaf-anchor-v1");
    expect(packed.report.options.targetPayloadOrder).toBe("spatial-leaf-anchor-v1");
    // The synthetic prototypes intentionally share byte-identical geometry;
    // chunk ownership changes even though permuting equal byte blocks does not.
    expect(packed.binary.byteLength).toBe(baseline.binary.byteLength);
    expect(packed.json).not.toBe(baseline.json);
    expect(packed.coarseBinary).toEqual(baseline.coarseBinary);
    expect(repeated.json).toBe(packed.json);
    expect(repeated.binary).toEqual(packed.binary);
    expect(repeated.spatialBinary).toEqual(packed.spatialBinary);
    expect(permuted.json).toBe(packed.json);
    expect(permuted.binary).toEqual(packed.binary);
    expect(permuted.spatialBinary).toEqual(packed.spatialBinary);
    expect(validateCompiledGltf(packed.document, [
      packed.binary,
      packed.coarseBinary as Uint8Array,
    ])).toEqual({ ok: true, issues: [] });
  });

  it("requires spatial indexing and byte-budget coalescing for spatial payload order", async () => {
    await expect(compileEvidence({ spatialPayloadOrder: true })).rejects.toThrow(
      /requires spatialIndex and targetChunkByteBudget/u,
    );
    await expect(compileEvidence({
      coarseBounds: true,
      spatialIndex: true,
      spatialPayloadOrder: true,
    })).rejects.toThrow(/requires spatialIndex and targetChunkByteBudget/u);
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
