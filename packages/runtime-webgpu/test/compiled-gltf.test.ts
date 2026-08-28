import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  addResidencyCost,
  batchResidencyCost,
  compiledSceneTransferables,
  decodeCompiledGltf,
  defaultCompiledPackageLimits,
  inspectCompiledHierarchy,
  instanceStride,
  prepareCompiledGltfDecoder,
  resolveCompiledPackageLimits,
  validateGpuScene,
} from "../src/index.js";
import type {
  CompiledGltfError,
  GpuPrototypeBatch,
  ResidencyCost,
} from "../src/index.js";

const gltfUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners/scene.gltf",
  import.meta.url,
);
const binaryUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners/scene.bin",
  import.meta.url,
);
const progressiveUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners-ap242/",
  import.meta.url,
);

/**
 * Charges decoded batches the way a residency set does: a vertex pool shared
 * by the material groups of one prototype is one array and one GPU buffer, so
 * it is charged to the first batch that holds it and to no other.
 */
function residencyCostOfBatches(batches: readonly GpuPrototypeBatch[]): ResidencyCost {
  const charged = new Set<Float32Array>();
  return batches.reduce((total, batch) => {
    const sharesSurfaceVertices = charged.has(batch.surfaceVertices);
    charged.add(batch.surfaceVertices);
    return addResidencyCost(
      total,
      batchResidencyCost({
        surfaceVertexBytes: batch.surfaceVertices.byteLength,
        surfaceIndexBytes: batch.surfaceIndices.byteLength,
        edgeVertexBytes: batch.edgeVertices.byteLength,
        instanceCount: batch.instances.length,
        sharesSurfaceVertices,
      }),
    );
  }, { decodedBytes: 0, gpuBytes: 0 });
}

async function loadPackage(): Promise<{ json: unknown; binary: ArrayBuffer }> {
  const [json, bytes] = await Promise.all([
    readFile(gltfUrl, "utf8").then(JSON.parse),
    readFile(binaryUrl),
  ]);
  return {
    json,
    binary: Uint8Array.from(bytes).buffer,
  };
}

describe("compiled glTF runtime boundary", () => {
  it("opens hierarchy and source identity before binary geometry is available", async () => {
    const { json } = await loadPackage();
    const { hierarchy } = inspectCompiledHierarchy(json);

    expect(hierarchy.profile).toBe("madi.experimental.gltf.1");
    expect(hierarchy.sourceFormat).toBe("AP214");
    expect(hierarchy.binaryUri).toBe("scene.bin");
    expect(hierarchy.binaryByteLength).toBe(188_044);
    expect(hierarchy.entries).toHaveLength(12);
    expect(hierarchy.renderableOccurrences).toBe(10);
    expect(hierarchy.sharedMeshes).toBe(3);
    expect(hierarchy.entries.find(({ name }) => name === "fastener-03")).toMatchObject({
      depth: 2,
      renderable: true,
      occurrenceId: "occurrence:madi-repeated-fasteners/fastener-bank/fastener-03",
      prototypeId: "prototype:part:fastener-01",
    });
  });

  it("decodes shared meshes, explicit CAD edges, transforms, and pick evidence", async () => {
    const { json, binary } = await loadPackage();
    const decoded = decodeCompiledGltf(json, binary);

    expect(decoded.gpuScene.batches).toHaveLength(3);
    expect(decoded.summary).toEqual({
      prototypeBatches: 3,
      partOccurrences: 10,
      triangles: 2076,
      edgeSegments: 181,
      binaryBytes: 188_044,
      representation: "target",
    });
    expect(
      Math.max(...decoded.gpuScene.batches.map(({ instances }) => instances.length)),
    ).toBe(8);
    expect(decoded.bounds.min).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(decoded.bounds.min[0]).toBeCloseTo(-0.048, 5);
    expect(decoded.bounds.min[1]).toBeCloseTo(0, 5);
    expect(decoded.bounds.min[2]).toBeCloseTo(-0.028, 5);
    expect(decoded.bounds.max[0]).toBeCloseTo(0.048, 5);
    expect(decoded.bounds.max[1]).toBeCloseTo(0.022, 5);
    expect(decoded.bounds.max[2]).toBeCloseTo(0.028, 5);
    expect(decoded.objectEvidence.find(({ label }) => label === "center-rail")).toMatchObject({
      objectId: 3,
      nodeIndex: 2,
      prototypeId: "prototype:part:center-rail",
    });
    expect(
      decoded.objectEvidence.find(({ label }) => label === "center-rail")?.edgeSourceRefs,
    ).toHaveLength(12);
  });

  it("composes large node translations without reducing them to f32", async () => {
    const { json, binary } = await loadPackage();
    const copy = structuredClone(json) as {
      nodes: { matrix?: number[] }[];
    };
    const translation = 10_000_000.000_25;
    copy.nodes[0]!.matrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      translation, -7_000_000, 3_000_000, 1,
    ];
    const decoded = decodeCompiledGltf(copy, binary);
    const first = decoded.gpuScene.batches[0]?.instances[0];

    expect(first?.transform).toBeInstanceOf(Float64Array);
    expect(first?.transform[12]).toBe(translation);
    expect(decoded.bounds.min[0]).toBeCloseTo(translation - 0.048, 6);
    expect(decoded.bounds.max[0]).toBeCloseTo(translation + 0.048, 6);
  });

  it("decodes material-separated surface primitives as one pickable object", async () => {
    const { json, binary } = await loadPackage();
    const copy = structuredClone(json) as {
      meshes: { primitives: Record<string, unknown>[] }[];
      materials: unknown[];
    };
    const mesh = copy.meshes[0];
    const surface = mesh?.primitives[0];
    if (!mesh || !surface) throw new TypeError("Fixture mesh is incomplete.");
    const material = copy.materials.push({
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.2, 0.1, 1] },
    }) - 1;
    mesh.primitives.splice(1, 0, { ...surface, material });

    const decoded = decodeCompiledGltf(copy, binary);
    const splitBatches = decoded.batchEvidence.filter(({ meshIndex }) => meshIndex === 0);

    expect(splitBatches.map(({ surfacePrimitiveIndex }) => surfacePrimitiveIndex)).toEqual([0, 1]);
    expect(decoded.gpuScene.sharedObjectIdsAcrossBatches).toBe(true);
    expect(decoded.gpuScene.batches).toHaveLength(4);
    expect(decoded.objectEvidence).toHaveLength(10);
    expect(decoded.summary.triangles).toBeGreaterThan(2076);
    expect(
      decoded.gpuScene.batches[1]?.instances[0]?.baseColor,
    ).toEqual([0.9, 0.2, 0.1, 1]);
    expect(() => validateGpuScene(decoded.gpuScene)).not.toThrow();
  });

  it("rejects a truncated binary before exposing GPU buffers", async () => {
    const { json, binary } = await loadPackage();

    expect(() => decodeCompiledGltf(json, binary.slice(0, binary.byteLength - 4))).toThrowError(
      expect.objectContaining<Partial<CompiledGltfError>>({ code: "INVALID_BINARY" }),
    );
  });

  it("decodes coarse bounds before target geometry without changing object identity", async () => {
    const [json, targetBytes, coarseBytes] = await Promise.all([
      readFile(new URL("scene.gltf", progressiveUrl), "utf8").then(JSON.parse),
      readFile(new URL("scene.bin", progressiveUrl)),
      readFile(new URL("coarse.bin", progressiveUrl)),
    ]);
    const { hierarchy } = inspectCompiledHierarchy(json);
    const coarse = decodeCompiledGltf(json, Uint8Array.from(coarseBytes).buffer, {
      representation: "coarse",
    });
    const target = decodeCompiledGltf(json, Uint8Array.from(targetBytes).buffer);

    expect(hierarchy).toMatchObject({
      binaryUri: "scene.bin",
      binaryByteLength: 188_044,
      coarseBinaryUri: "coarse.bin",
      coarseBinaryByteLength: 2_736,
    });
    expect(hierarchy.targetChunks).toHaveLength(3);
    expect(coarse.summary).toEqual({
      prototypeBatches: 3,
      partOccurrences: 10,
      triangles: 36,
      edgeSegments: 36,
      binaryBytes: 2_736,
      representation: "coarse",
    });
    expect(target.summary.representation).toBe("target");
    expect(coarse.objectEvidence.map(({ objectId }) => objectId)).toEqual(
      target.objectEvidence.map(({ objectId }) => objectId),
    );
    expect(coarse.objectEvidence.map(({ occurrenceId }) => occurrenceId)).toEqual(
      target.objectEvidence.map(({ occurrenceId }) => occurrenceId),
    );
    expect(coarse.bounds).toEqual(target.bounds);
    expect(coarse.batchEvidence.map(({ targetMeshIndex }) => targetMeshIndex)).toEqual(
      target.batchEvidence.map(({ targetMeshIndex }) => targetMeshIndex),
    );

    const chunkScenes = hierarchy.targetChunks.map((chunk) =>
      decodeCompiledGltf(
        json,
        Uint8Array.from(
          targetBytes.subarray(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
        ).buffer,
        { targetChunkId: chunk.id },
      ),
    );
    expect(chunkScenes.map(({ summary }) => summary.partOccurrences)).toEqual([8, 1, 1]);
    expect(chunkScenes.reduce((total, value) => total + value.summary.triangles, 0)).toBe(
      target.summary.triangles,
    );
    expect(chunkScenes.reduce((total, value) => total + value.summary.edgeSegments, 0)).toBe(
      target.summary.edgeSegments,
    );
    expect(
      chunkScenes.flatMap(({ objectEvidence }) => objectEvidence.map(({ objectId }) => objectId))
        .sort((left, right) => left - right),
    ).toEqual(target.objectEvidence.map(({ objectId }) => objectId));
  });

  it("prepares active transforms once and decodes repeated target ranges chunk-locally", async () => {
    const [json, targetBytes, coarseBytes] = await Promise.all([
      readFile(new URL("scene.gltf", progressiveUrl), "utf8").then(JSON.parse) as Promise<{
        nodes: unknown[];
      }>,
      readFile(new URL("scene.bin", progressiveUrl)),
      readFile(new URL("coarse.bin", progressiveUrl)),
    ]);
    let nodeReads = 0;
    json.nodes = new Proxy(json.nodes, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) nodeReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const prepared = prepareCompiledGltfDecoder(json);
    const readsAfterPrepare = nodeReads;
    const chunk = prepared.hierarchy.targetChunks.find(({ occurrenceCount }) =>
      occurrenceCount === 1
    );
    if (!chunk) throw new TypeError("Progressive fixture has no single-occurrence chunk.");
    const range = (): ArrayBuffer => Uint8Array.from(
      targetBytes.subarray(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
    ).buffer;

    const coarse = prepared.decode(Uint8Array.from(coarseBytes).buffer, {
      representation: "coarse",
    });
    expect(coarse.summary.partOccurrences).toBe(10);
    structuredClone(coarse, { transfer: compiledSceneTransferables(coarse) });

    const first = prepared.decode(range(), { targetChunkId: chunk.id });
    expect(prepared.activeNodeCount).toBe(prepared.hierarchy.nodeCount);
    expect(prepared.renderableNodeCount).toBe(10);
    expect(first.summary.partOccurrences).toBe(1);
    expect(nodeReads).toBe(readsAfterPrepare);

    structuredClone(first, { transfer: compiledSceneTransferables(first) });
    const second = prepared.decode(range(), { targetChunkId: chunk.id });
    expect(second.objectEvidence).toEqual(first.objectEvidence);
    expect(second.gpuScene.batches[0]?.instances[0]?.transform.byteLength).toBe(128);
    expect(nodeReads).toBe(readsAfterPrepare);
  });

  it("measures each target chunk's residency cost before its range is fetched", async () => {
    const [json, targetBytes] = await Promise.all([
      readFile(new URL("scene.gltf", progressiveUrl), "utf8").then(JSON.parse),
      readFile(new URL("scene.bin", progressiveUrl)),
    ]);
    const prepared = prepareCompiledGltfDecoder(json);

    expect([...prepared.targetChunkResidencyCosts.keys()]).toEqual(
      prepared.hierarchy.targetChunks.map(({ id }) => id),
    );
    for (const chunk of prepared.hierarchy.targetChunks) {
      const scene = prepared.decode(
        Uint8Array.from(
          targetBytes.subarray(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
        ).buffer,
        { targetChunkId: chunk.id },
      );
      const decoded = residencyCostOfBatches(scene.gpuScene.batches);

      // The gate refuses chunks on this prediction alone, so an underestimate
      // would drop geometry the budget could have held.
      expect(prepared.targetChunkResidencyCosts.get(chunk.id)).toEqual(decoded);
      expect(scene.summary.edgeSegments).toBeGreaterThan(0);
      expect(decoded.decodedBytes).toBeGreaterThan(0);
    }
  });

  it("shares one vertex pool across the material groups of a prototype", async () => {
    const [json, targetBytes] = await Promise.all([
      readFile(new URL("scene.gltf", progressiveUrl), "utf8").then(JSON.parse),
      readFile(new URL("scene.bin", progressiveUrl)),
    ]);
    // The committed STEP packages carry one material per prototype. IFC
    // federations split a prototype into a surface primitive per material,
    // all reading the accessors the package stores once, so a second group is
    // added here over the same POSITION/NORMAL/index accessors.
    const split = structuredClone(json) as {
      meshes: { primitives: unknown[] }[];
    };
    for (const mesh of split.meshes) {
      mesh.primitives.splice(1, 0, structuredClone(mesh.primitives[0]));
    }

    const single = prepareCompiledGltfDecoder(json);
    const grouped = prepareCompiledGltfDecoder(split);
    const chunk = grouped.hierarchy.targetChunks[0];
    if (!chunk) throw new Error("The progressive package has no target chunk.");
    const range = (): ArrayBuffer =>
      Uint8Array.from(
        targetBytes.subarray(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
      ).buffer;
    const scene = grouped.decode(range(), { targetChunkId: chunk.id });

    const [first, second] = scene.gpuScene.batches;
    expect(scene.gpuScene.batches).toHaveLength(2);
    expect(first?.surfaceVertices.length).toBeGreaterThan(0);
    // Identity, not equality: the residency set and the renderer both charge
    // and release the pool by the array they were handed.
    expect(second?.surfaceVertices).toBe(first?.surfaceVertices);
    expect(compiledSceneTransferables(scene)).toContain(first?.surfaceVertices.buffer);

    // Splitting one prototype into two material groups adds that group's
    // indices and instances -- and none of the vertices it re-reads.
    const singleCost = single.targetChunkResidencyCosts.get(chunk.id);
    const groupedCost = grouped.targetChunkResidencyCosts.get(chunk.id);
    expect(groupedCost).toEqual(residencyCostOfBatches(scene.gpuScene.batches));
    expect((groupedCost?.decodedBytes ?? 0) - (singleCost?.decodedBytes ?? 0)).toBe(
      (first?.surfaceIndices.byteLength ?? 0) + (first?.instances.length ?? 0) * instanceStride,
    );
  });

  it("surfaces semantic references on hierarchy entries and pick evidence", async () => {
    const { json, binary } = await loadPackage();
    const { hierarchy } = inspectCompiledHierarchy(json);
    const decoded = decodeCompiledGltf(json, binary);

    expect(hierarchy.entries.find(({ name }) => name === "fastener-03")?.semanticId).toBe(
      "semantic:prototype:part:fastener-01",
    );
    expect(
      decoded.objectEvidence.find(({ label }) => label === "center-rail")?.semanticId,
    ).toBe("semantic:prototype:part:center-rail");
    // The committed Phase 1 STEP package carries no property sidecar.
    expect(hierarchy.properties).toBeUndefined();
  });

  it("validates and exposes an optional spatial demand sidecar pointer", async () => {
    const json = JSON.parse(await readFile(new URL("scene.gltf", progressiveUrl), "utf8")) as unknown;
    const copy = structuredClone(json) as {
      extras: { madi: { progressive?: Record<string, unknown> } };
    };
    copy.extras.madi.progressive = {
      ...copy.extras.madi.progressive,
      spatialIndex: {
        schemaVersion: "naru.spatial-demand-index.1",
        uri: "spatial.bin",
        byteLength: 512,
        sha256: "a".repeat(64),
      },
    };

    expect(inspectCompiledHierarchy(copy).hierarchy.spatialIndex).toEqual({
      schemaVersion: "naru.spatial-demand-index.1",
      uri: "spatial.bin",
      byteLength: 512,
      sha256: "a".repeat(64),
    });

    const invalid = structuredClone(copy);
    const progressive = invalid.extras.madi.progressive as {
      spatialIndex: { schemaVersion: string };
    };
    progressive.spatialIndex.schemaVersion = "naru.spatial-demand-index.2";
    expect(() => inspectCompiledHierarchy(invalid)).toThrowError(
      expect.objectContaining<Partial<CompiledGltfError>>({ code: "INVALID_GLTF" }),
    );
  });

  it("surfaces a property sidecar pointer from extras.madi.properties", async () => {
    const { json } = await loadPackage();
    const copy = structuredClone(json) as {
      extras: { madi: Record<string, unknown> };
    };
    const pointer = {
      schemaVersion: "madi.package-properties.1",
      uri: "properties.json",
      byteLength: 2_260_991,
      sha256: "a".repeat(64),
    };
    copy.extras.madi.properties = pointer;

    expect(inspectCompiledHierarchy(copy).hierarchy.properties).toEqual(pointer);
  });

  it("rejects a malformed property sidecar pointer", async () => {
    const { json } = await loadPackage();
    const copy = structuredClone(json) as {
      extras: { madi: Record<string, unknown> };
    };
    copy.extras.madi.properties = {
      schemaVersion: "madi.package-properties.1",
      uri: "properties.json",
      byteLength: 2_260_991,
    };

    expect(() => inspectCompiledHierarchy(copy)).toThrowError(
      expect.objectContaining<Partial<CompiledGltfError>>({ code: "INVALID_GLTF" }),
    );
  });

  it("rejects unrecognized MADI extras profiles", async () => {
    const { json } = await loadPackage();
    const copy = structuredClone(json) as {
      extras: { madi: { profile: string } };
    };
    copy.extras.madi.profile = "madi.future.unknown";

    expect(() => inspectCompiledHierarchy(copy)).toThrowError(
      expect.objectContaining<Partial<CompiledGltfError>>({ code: "UNSUPPORTED_PROFILE" }),
    );
  });
});

describe("compiled package structural limits", () => {
  /**
   * The smallest document the boundary accepts: one chain of `depth` nodes,
   * every one an occurrence, so limit behavior can be tested without a fixture.
   */
  function chainedPackage(depth: number): unknown {
    const nodes = Array.from({ length: depth }, (_, index) => ({
      name: `node-${String(index)}`,
      extras: { madi: { occurrenceId: `occurrence-${String(index)}` } },
      ...(index + 1 < depth ? { children: [index + 1] } : {}),
    }));
    return {
      asset: { version: "2.0" },
      extras: { madi: { profile: "madi.experimental.gltf.1", sceneId: "chain" } },
      scene: 0,
      scenes: [{ name: "chain", nodes: [0] }],
      nodes,
      meshes: [],
      materials: [],
      bufferViews: [],
      accessors: [],
      buffers: [{ uri: "scene.bin", byteLength: 64 }],
    };
  }

  it("rejects a package that declares more nodes than the limit", async () => {
    const { json } = await loadPackage();

    expect(() => inspectCompiledHierarchy(json, { limits: { nodes: 4 } })).toThrowError(
      /declares 13 nodes; the limit is 4/u,
    );
    expect(() => inspectCompiledHierarchy(json, { limits: { accessors: 8 } })).toThrowError(
      /declares 24 accessors; the limit is 8/u,
    );
    expect(inspectCompiledHierarchy(json).hierarchy.nodeCount).toBe(13);
  });

  it("rejects a scene nested deeper than the traversal limit", () => {
    expect(() => inspectCompiledHierarchy(chainedPackage(6), { limits: { traversalDepth: 4 } }))
      .toThrowError(/nests deeper than 4 nodes at nodes\[4\]/u);
    expect(
      inspectCompiledHierarchy(chainedPackage(4), { limits: { traversalDepth: 4 } })
        .hierarchy.entries,
    ).toHaveLength(4);
  });

  it("walks a chain far deeper than the JavaScript stack without exhausting it", () => {
    const depth = 200_000;

    const { hierarchy } = inspectCompiledHierarchy(chainedPackage(depth), {
      limits: { nodes: depth, traversalDepth: depth },
    });

    expect(hierarchy.entries).toHaveLength(depth);
    expect(hierarchy.entries[depth - 1]?.depth).toBe(depth - 1);
  });

  it("still separates a cycle from a second parent after the stack rewrite", () => {
    const cyclic = chainedPackage(3) as { nodes: { children?: number[] }[] };
    cyclic.nodes[2] = { ...cyclic.nodes[2], children: [1] };
    const shared = chainedPackage(3) as { nodes: { children?: number[] }[] };
    shared.nodes[0] = { ...shared.nodes[0], children: [1, 2] };

    expect(() => inspectCompiledHierarchy(cyclic)).toThrowError(/Cycle detected at nodes\[1\]/u);
    expect(() => inspectCompiledHierarchy(shared)).toThrowError(
      /nodes\[2\] has more than one active-scene parent/u,
    );
  });

  it("resolves limit overrides over reviewed defaults and rejects unusable ones", () => {
    expect(resolveCompiledPackageLimits()).toEqual(defaultCompiledPackageLimits);
    expect(resolveCompiledPackageLimits({ targetChunks: 8 })).toEqual({
      ...defaultCompiledPackageLimits,
      targetChunks: 8,
    });
    expect(() => resolveCompiledPackageLimits({ nodes: 0 })).toThrowError(
      /nodes limit must be a positive safe integer/u,
    );
    expect(() => resolveCompiledPackageLimits({ meshes: 1.5 })).toThrowError(
      /meshes limit must be a positive safe integer/u,
    );
  });
});
