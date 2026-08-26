import type {
  CompiledBatchEvidence,
  DecodedCompiledScene,
  GpuOccurrenceInstance,
  GpuPrototypeBatch,
} from "@naru3d/runtime-webgpu";

export interface AggregatedCoarseScene extends DecodedCompiledScene {
  /** Target mesh for each instance in the single aggregated coarse batch. */
  readonly coarseInstanceTargetMeshIndexes: Uint32Array;
}

const canonicalSurfaceVertices = [
  // -X
  -0.5, -0.5, -0.5, -1, 0, 0,
  -0.5, -0.5, 0.5, -1, 0, 0,
  -0.5, 0.5, 0.5, -1, 0, 0,
  -0.5, 0.5, -0.5, -1, 0, 0,
  // +X
  0.5, -0.5, 0.5, 1, 0, 0,
  0.5, -0.5, -0.5, 1, 0, 0,
  0.5, 0.5, -0.5, 1, 0, 0,
  0.5, 0.5, 0.5, 1, 0, 0,
  // -Y
  -0.5, -0.5, 0.5, 0, -1, 0,
  -0.5, -0.5, -0.5, 0, -1, 0,
  0.5, -0.5, -0.5, 0, -1, 0,
  0.5, -0.5, 0.5, 0, -1, 0,
  // +Y
  -0.5, 0.5, -0.5, 0, 1, 0,
  -0.5, 0.5, 0.5, 0, 1, 0,
  0.5, 0.5, 0.5, 0, 1, 0,
  0.5, 0.5, -0.5, 0, 1, 0,
  // -Z
  0.5, -0.5, -0.5, 0, 0, -1,
  -0.5, -0.5, -0.5, 0, 0, -1,
  -0.5, 0.5, -0.5, 0, 0, -1,
  0.5, 0.5, -0.5, 0, 0, -1,
  // +Z
  -0.5, -0.5, 0.5, 0, 0, 1,
  0.5, -0.5, 0.5, 0, 0, 1,
  0.5, 0.5, 0.5, 0, 0, 1,
  -0.5, 0.5, 0.5, 0, 0, 1,
] as const;

const canonicalSurfaceIndices = [
  0, 1, 2, 0, 2, 3,
  4, 5, 6, 4, 6, 7,
  8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15,
  16, 17, 18, 16, 18, 19,
  20, 21, 22, 20, 22, 23,
] as const;

const canonicalEdgeVertices = [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
  0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
  0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
  0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5, -0.5, -0.5, 0.5,
  -0.5, -0.5, -0.5, -0.5, -0.5, 0.5,
  0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
  0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
  -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
] as const;

function localBounds(batch: GpuPrototypeBatch): {
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
} {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < batch.surfaceVertices.length; offset += 6) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = batch.surfaceVertices[offset + axis];
      if (value === undefined) throw new RangeError("Incomplete coarse surface position.");
      minimum[axis] = Math.min(minimum[axis] ?? Infinity, value);
      maximum[axis] = Math.max(maximum[axis] ?? -Infinity, value);
    }
  }
  if (minimum.some((value) => !Number.isFinite(value))) {
    throw new TypeError("A coarse batch must contain finite surface positions.");
  }
  return {
    center: [
      ((minimum[0] ?? 0) + (maximum[0] ?? 0)) / 2,
      ((minimum[1] ?? 0) + (maximum[1] ?? 0)) / 2,
      ((minimum[2] ?? 0) + (maximum[2] ?? 0)) / 2,
    ],
    size: [
      (maximum[0] ?? 0) - (minimum[0] ?? 0),
      (maximum[1] ?? 0) - (minimum[1] ?? 0),
      (maximum[2] ?? 0) - (minimum[2] ?? 0),
    ],
  };
}

/** Writes world * translate(center) * scale(size) in column-major order. */
function composeBoundsTransform(
  target: Float32Array,
  world: Float32Array,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
): void {
  for (let row = 0; row < 4; row += 1) {
    target[row] = (world[row] ?? 0) * size[0];
    target[4 + row] = (world[4 + row] ?? 0) * size[1];
    target[8 + row] = (world[8 + row] ?? 0) * size[2];
    target[12 + row] =
      (world[row] ?? 0) * center[0] +
      (world[4 + row] ?? 0) * center[1] +
      (world[8 + row] ?? 0) * center[2] +
      (world[12 + row] ?? 0);
  }
}

/**
 * Collapses compiler-emitted prototype AABBs into one instanced canonical box.
 * The serialized package remains unchanged; this is a Worker-side residency layout.
 */
export function aggregateCoarseScene(scene: DecodedCompiledScene): AggregatedCoarseScene {
  if (scene.summary.representation !== "coarse") {
    throw new TypeError("Only coarse geometry can be aggregated.");
  }
  if (scene.gpuScene.batches.length !== scene.batchEvidence.length) {
    throw new RangeError("Coarse batch evidence is incomplete.");
  }

  const instanceCount = scene.gpuScene.batches.reduce(
    (total, batch) => total + batch.instances.length,
    0,
  );
  const transforms = new Float32Array(instanceCount * 16);
  const targetMeshIndexes = new Uint32Array(instanceCount);
  const instances: GpuOccurrenceInstance[] = new Array(instanceCount);
  let outputIndex = 0;

  scene.gpuScene.batches.forEach((batch, batchIndex) => {
    const evidence = scene.batchEvidence[batchIndex];
    if (!evidence) throw new RangeError(`Missing coarse batch evidence ${batchIndex}.`);
    const bounds = localBounds(batch);
    for (const instance of batch.instances) {
      const transform = transforms.subarray(outputIndex * 16, outputIndex * 16 + 16);
      composeBoundsTransform(transform, instance.transform, bounds.center, bounds.size);
      targetMeshIndexes[outputIndex] = evidence.targetMeshIndex;
      instances[outputIndex] = {
        transform,
        objectId: instance.objectId,
        ...(instance.baseColor ? { baseColor: instance.baseColor } : {}),
      };
      outputIndex += 1;
    }
  });

  const firstEvidence = scene.batchEvidence[0];
  if (!firstEvidence || !instances[0]) {
    throw new TypeError("A coarse scene must contain at least one occurrence.");
  }
  const aggregateEvidence: CompiledBatchEvidence = {
    batchIndex: 0,
    meshIndex: firstEvidence.meshIndex,
    targetMeshIndex: -1,
    surfacePrimitiveIndex: 0,
    prototypeId: "coarse:prototype-aabb-v1",
  };
  const aggregateBatch: GpuPrototypeBatch = {
    surfaceVertices: new Float32Array(canonicalSurfaceVertices),
    surfaceIndices: new Uint32Array(canonicalSurfaceIndices),
    edgeVertices: new Float32Array(canonicalEdgeVertices),
    instances,
  };

  return {
    ...scene,
    gpuScene: { batches: [aggregateBatch] },
    batchEvidence: [aggregateEvidence],
    coarseInstanceTargetMeshIndexes: targetMeshIndexes,
    summary: {
      ...scene.summary,
      prototypeBatches: 1,
      triangles: canonicalSurfaceIndices.length / 3,
      edgeSegments: canonicalEdgeVertices.length / 6,
    },
  };
}
