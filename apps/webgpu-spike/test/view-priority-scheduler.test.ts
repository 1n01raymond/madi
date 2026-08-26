import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type {
  CompiledHierarchy,
  CompiledTargetChunk,
  DecodedCompiledScene,
  GpuOccurrenceInstance,
} from "@naru3d/runtime-webgpu";
import { decodeCompiledGltf, inspectCompiledHierarchy } from "@naru3d/runtime-webgpu";
import { decodeSpatialDemandIndex } from "@naru3d/runtime-webgpu";
import { encodeSpatialDemandIndex } from "../../../packages/compiler/src/spatial-demand.js";

import { aggregateCoarseScene } from "../src/coarse-aggregation.js";
import { OrthographicOrbitCamera } from "../src/view.js";
import {
  CameraTargetScheduler,
  SpatialTargetChunkViewIndex,
  TargetChunkViewIndex,
} from "../src/view-priority-scheduler.js";

const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function instance(x: number): GpuOccurrenceInstance {
  const transform = new Float64Array(identity);
  transform[12] = x;
  return { transform, objectId: x + 11 };
}

function chunk(id: string, meshIndex: number, priority: number): CompiledTargetChunk {
  return {
    id,
    buffer: 0,
    byteOffset: meshIndex * 4,
    byteLength: 4,
    meshIndexes: [meshIndex],
    prototypeIds: [`prototype:${id}`],
    prototypeId: `prototype:${id}`,
    occurrenceCount: 1,
    priority,
  };
}

function coarse(chunks: readonly CompiledTargetChunk[]): DecodedCompiledScene {
  return {
    gpuScene: {
      batches: chunks.map((_, index) => ({
        surfaceVertices: new Float32Array([-0.5, -0.5, 0, 0, 0, 1, 0.5, 0.5, 0, 0, 0, 1]),
        surfaceIndices: new Uint32Array(),
        edgeVertices: new Float32Array(),
        instances: [instance(index * 10)],
      })),
    },
    bounds: { min: [0, 0, 0], max: [10, 0, 0] },
    hierarchy: { targetChunks: chunks } as CompiledHierarchy,
    objectEvidence: [],
    batchEvidence: chunks.map((entry, batchIndex) => ({
      batchIndex,
      meshIndex: entry.meshIndexes[0] ?? 0,
      targetMeshIndex: entry.meshIndexes[0] ?? 0,
      surfacePrimitiveIndex: 0,
      prototypeId: entry.prototypeId,
    })),
    summary: {
      prototypeBatches: chunks.length,
      partOccurrences: chunks.length,
      triangles: 0,
      edgeSegments: 0,
      binaryBytes: chunks.length * 4,
      representation: "coarse",
    },
  };
}

const viewProjection = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe("view-prioritized target scheduling", () => {
  it("reorders the committed progressive package after a fixed pan", async () => {
    const directory = new URL("../../../artifacts/phase1/repeated-fasteners-ap242/", import.meta.url);
    const [json, bytes] = await Promise.all([
      readFile(new URL("scene.gltf", directory), "utf8").then(JSON.parse),
      readFile(new URL("coarse.bin", directory)),
    ]);
    const { hierarchy } = inspectCompiledHierarchy(json);
    const aggregate = aggregateCoarseScene(
      decodeCompiledGltf(json, Uint8Array.from(bytes).buffer, { representation: "coarse" }),
    );
    const index = new TargetChunkViewIndex(
      hierarchy.targetChunks,
      aggregate,
      aggregate.coarseInstanceTargetMeshIndexes,
    );
    const order = (camera: OrthographicOrbitCamera, aspect = 1_178 / 520) =>
      index.rank(camera.frame(aspect)).map(({ chunk }) => chunk.id).join("|");
    const camera = new OrthographicOrbitCamera(aggregate.bounds);
    const initialOrder = order(camera);
    camera.pan(100, -50, 1_178, 520, 1_178 / 520);
    const navigatedOrder = order(camera);

    expect(initialOrder).toBe(
      "target:0000:prototype:part:fastener-01|" +
        "target:0002:prototype:part:center-rail|" +
        "target:0001:prototype:part:mounting-plate",
    );
    expect(navigatedOrder).toBe(
      "target:0001:prototype:part:mounting-plate|" +
        "target:0002:prototype:part:center-rail|" +
        "target:0000:prototype:part:fastener-01",
    );
  });

  it("ranks visible chunk bounds nearest the current camera origin first", () => {
    const chunks = [chunk("near", 0, 1), chunk("far", 1, 0)];
    const index = new TargetChunkViewIndex(chunks, coarse(chunks));

    expect(index.rank({ viewProjection, origin: [0, 0, 0] }).map(({ chunk }) => chunk.id)).toEqual([
      "near",
      "far",
    ]);
    expect(index.rank({ viewProjection, origin: [10, 0, 0] }).map(({ chunk }) => chunk.id)).toEqual([
      "far",
      "near",
    ]);
  });

  it("aborts obsolete work and admits the new view's hottest chunk", async () => {
    const chunks = [chunk("near", 0, 0), chunk("far", 1, 1)];
    const index = new TargetChunkViewIndex(chunks, coarse(chunks));
    const requested: string[] = [];
    const cancelled: string[] = [];
    const admitted = new Set<string>();
    let nearStarted: (() => void) | undefined;
    const nearRequest = new Promise<void>((resolve) => {
      nearStarted = resolve;
    });

    const scheduler = new CameraTargetScheduler(index, {
      isResident: (entry) => admitted.has(entry.id),
      load: (entry, signal) => {
        requested.push(entry.id);
        if (entry.id === "far") return Promise.resolve(entry.id);
        nearStarted?.();
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Obsolete target request.", "AbortError")),
            { once: true },
          );
        });
      },
      admit: (entry) => {
        admitted.add(entry.id);
        if (entry.id === "far") scheduler.stop();
        return true;
      },
      onEvent: (event) => {
        if (event.type === "cancel") cancelled.push(event.chunkId);
      },
      onError: (error) => {
        throw error;
      },
    });

    scheduler.update({ viewProjection, origin: [0, 0, 0] });
    await nearRequest;
    scheduler.update({ viewProjection, origin: [10, 0, 0] });
    scheduler.update({ viewProjection, origin: [10, 0, 0] });
    await scheduler.whenIdle();

    expect(requested).toEqual(["near", "far"]);
    expect(cancelled).toEqual(["near"]);
    expect([...admitted]).toEqual(["far"]);
  });

  it("requests only spatially demanded chunks and keeps cold chunks for eviction order", async () => {
    const chunks = [chunk("near", 0, 0), chunk("far", 1, 1)];
    const spatial = decodeSpatialDemandIndex(
      encodeSpatialDemandIndex(
        [
          {
            id: "near",
            nodeIndex: 3,
            targetChunkIndex: 0,
            minimum: [-0.5, -0.5, 0],
            maximum: [0.5, 0.5, 1],
          },
          {
            id: "far",
            nodeIndex: 7,
            targetChunkIndex: 1,
            minimum: [9.5, -0.5, 0],
            maximum: [10.5, 0.5, 1],
          },
        ],
        { leafCapacity: 1 },
      ).bytes,
      { gltfNodeCount: 8, targetChunkCount: 2 },
    );
    const index = new SpatialTargetChunkViewIndex(chunks, spatial);
    const initial = index.rank({ viewProjection, origin: [0, 0, 0] });

    expect(initial.map(({ chunk, demanded }) => [chunk.id, demanded])).toEqual([
      ["near", true],
      ["far", false],
    ]);
    expect(index.queryStats()).toEqual({
      visitedNodeCount: 3,
      visibleLeafCount: 1,
      testedOccurrenceCount: 1,
      candidateChunkCount: 1,
      queryMilliseconds: expect.any(Number),
    });

    const requested: string[] = [];
    const resident = new Set<string>();
    const scheduler = new CameraTargetScheduler(index, {
      isResident: (entry) => resident.has(entry.id),
      load: async (entry) => {
        requested.push(entry.id);
        return entry.id;
      },
      admit: (entry) => {
        resident.add(entry.id);
        return true;
      },
      onError: (error) => {
        throw error;
      },
    });
    scheduler.update({ viewProjection, origin: [0, 0, 0] });
    await scheduler.whenIdle();
    scheduler.stop();

    expect(requested).toEqual(["near"]);
  });
});
