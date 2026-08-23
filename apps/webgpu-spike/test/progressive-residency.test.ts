import { describe, expect, it } from "vitest";

import type {
  CompiledBatchEvidence,
  DecodedCompiledScene,
  GpuPrototypeBatch,
} from "@madi/runtime-webgpu";

import {
  estimateBatchDecodedBytes,
  estimateBatchGpuBytes,
  ProgressiveResidency,
} from "../src/progressive-residency.js";

function batch(objectId: number, triangles = 1): GpuPrototypeBatch {
  const indices = new Uint32Array(triangles * 3);
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    indices.set([0, 1, 2], triangle * 3);
  }
  return {
    surfaceVertices: new Float32Array([
      0, 0, 0, 0, 1, 0,
      1, 0, 0, 0, 1, 0,
      0, 1, 0, 0, 1, 0,
    ]),
    surfaceIndices: indices,
    edgeVertices: new Float32Array(),
    instances: [{ objectId, transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }],
  };
}

function decoded(
  batches: readonly GpuPrototypeBatch[],
  targetMeshIndexes: readonly number[],
): DecodedCompiledScene {
  const batchEvidence: CompiledBatchEvidence[] = batches.map((_, batchIndex) => ({
    batchIndex,
    meshIndex: targetMeshIndexes[batchIndex] ?? 0,
    targetMeshIndex: targetMeshIndexes[batchIndex] ?? 0,
    surfacePrimitiveIndex: 0,
    prototypeId: `prototype:${String(targetMeshIndexes[batchIndex] ?? 0)}`,
  }));
  return {
    gpuScene: { batches },
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    hierarchy: {
      profile: "madi.experimental.gltf.1",
      sceneId: "test",
      sourceFormat: "test",
      binaryUri: "scene.bin",
      binaryByteLength: 0,
      targetChunks: [],
      entries: [],
      renderableOccurrences: batches.length,
      sharedMeshes: batches.length,
    },
    objectEvidence: [],
    batchEvidence,
    summary: {
      prototypeBatches: batches.length,
      partOccurrences: batches.length,
      triangles: batches.reduce((total, value) => total + value.surfaceIndices.length / 3, 0),
      edgeSegments: 0,
      binaryBytes: 0,
      representation: "target",
    },
  };
}

describe("progressive residency", () => {
  it("replaces coarse batches atomically and keeps both tiers below budget", () => {
    const coarse = decoded([batch(1), batch(2)], [0, 1]);
    const targetMeshZero = decoded([batch(1, 20)], [0]);
    const targetMeshOneTooLarge = decoded([batch(2, 30)], [1]);
    const residency = new ProgressiveResidency(coarse, { decodedBytes: 600, gpuBytes: 600 });

    const promoted = residency.promote(targetMeshZero);
    expect(promoted.admitted).toBe(true);
    expect(promoted.entries.map(({ key }) => key)).toEqual(["0:0", "1:0"]);
    expect(promoted.triangles).toBe(21);
    expect(promoted.decodedBytes).toBeLessThanOrEqual(600);
    expect(promoted.gpuBytes).toBeLessThanOrEqual(600);

    const rejected = residency.promote(targetMeshOneTooLarge);
    expect(rejected.admitted).toBe(false);
    expect(rejected.entries.map(({ key }) => key)).toEqual(["0:0", "1:0"]);
    expect(rejected.triangles).toBe(21);
  });

  it("accounts for decoder payload and aligned GPU buffers separately", () => {
    const value = batch(1);
    expect(estimateBatchDecodedBytes(value)).toBe(180);
    expect(estimateBatchGpuBytes(value)).toBe(184);
  });
});
