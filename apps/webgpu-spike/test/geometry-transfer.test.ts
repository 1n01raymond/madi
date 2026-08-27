import { describe, expect, it } from "vitest";

import type { DecodedCompiledScene } from "@naru3d/runtime-webgpu";

import { adoptTransitScene, transitSceneForResponse } from "../src/geometry-transfer.js";

function decodedScene(): DecodedCompiledScene {
  return {
    gpuScene: {
      batches: [
        {
          surfaceVertices: new Float32Array(),
          surfaceIndices: new Uint32Array(),
          edgeVertices: new Float32Array(),
          instances: [],
        },
      ],
    },
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    hierarchy: {
      profile: "madi.experimental.gltf.1",
      sceneId: "test",
      sourceFormat: "test",
      binaryUri: "scene.bin",
      binaryByteLength: 0,
      targetChunks: [],
      entries: [],
      renderableOccurrences: 0,
      sharedMeshes: 0,
    },
    objectEvidence: [],
    batchEvidence: [],
    summary: {
      prototypeBatches: 1,
      partOccurrences: 0,
      triangles: 0,
      edgeSegments: 0,
      binaryBytes: 0,
      representation: "target",
    },
  };
}

describe("geometry transfer protocol", () => {
  it("keeps the hierarchy in transit for full-document decodes", () => {
    const scene = decodedScene();
    const transit = transitSceneForResponse(scene, false);

    expect(transit).toBe(scene);
    expect(transit.hierarchy).toBe(scene.hierarchy);
  });

  it("omits the hierarchy for chunk decodes without copying payload fields", () => {
    const scene = decodedScene();
    const transit = transitSceneForResponse(scene, true);

    expect("hierarchy" in transit).toBe(false);
    expect(transit.gpuScene).toBe(scene.gpuScene);
    expect(transit.batchEvidence).toBe(scene.batchEvidence);
    expect(transit.summary).toBe(scene.summary);
  });

  it("caches the hierarchy from a bearing response and reattaches it to chunks", () => {
    const scene = decodedScene();

    const first = adoptTransitScene(transitSceneForResponse(scene, false), undefined);
    expect(first.scene).toBe(scene);
    expect(first.hierarchy).toBe(scene.hierarchy);

    const chunk = adoptTransitScene(transitSceneForResponse(scene, true), first.hierarchy);
    expect(chunk.scene.hierarchy).toBe(scene.hierarchy);
    expect(chunk.hierarchy).toBe(scene.hierarchy);
    expect(chunk.scene.gpuScene).toBe(scene.gpuScene);
  });

  it("rejects a chunk response that arrives before the hierarchy is cached", () => {
    const transit = transitSceneForResponse(decodedScene(), true);

    expect(() => adoptTransitScene(transit, undefined)).toThrow(
      /omitted the scene hierarchy before it was cached/u,
    );
  });
});
