export interface GpuOccurrenceInstance {
  /** Column-major local-to-world transform. */
  readonly transform: Float32Array;
  /** Zero is reserved for the picking background. */
  readonly objectId: number;
  /** Linear RGBA display color for this occurrence. */
  readonly baseColor?: readonly [number, number, number, number];
}

export interface GpuPrototypeBatch {
  /** Interleaved position.xyz + normal.xyz values. */
  readonly surfaceVertices: Float32Array;
  readonly surfaceIndices: Uint32Array;
  /** Non-indexed line-list position.xyz values. */
  readonly edgeVertices: Float32Array;
  /** Instances share the prototype's surface and edge buffers. */
  readonly instances: readonly GpuOccurrenceInstance[];
}

export interface GpuScene {
  /** One immutable geometry batch per renderable prototype. */
  readonly batches: readonly GpuPrototypeBatch[];
  /** One logical object may span material-separated prototype batches. */
  readonly sharedObjectIdsAcrossBatches?: boolean;
}

export const instanceStride = 96;

export function validatePrototypeBatch(batch: GpuPrototypeBatch): void {
  if (batch.surfaceVertices.length % 6 !== 0) {
    throw new TypeError("surfaceVertices must use position.xyz + normal.xyz records.");
  }
  if (batch.surfaceIndices.length % 3 !== 0) {
    throw new TypeError("surfaceIndices must contain triangle triplets.");
  }
  if (batch.edgeVertices.length % 6 !== 0) {
    throw new TypeError("edgeVertices must contain line-list vertex pairs.");
  }

  const vertexCount = batch.surfaceVertices.length / 6;
  for (const index of batch.surfaceIndices) {
    if (index >= vertexCount) {
      throw new RangeError(`Surface vertex index ${index} exceeds ${vertexCount}.`);
    }
  }

  const objectIds = new Set<number>();
  for (const instance of batch.instances) {
    if (
      instance.transform.length !== 16 ||
      instance.transform.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError("Each occurrence transform must contain 16 finite values.");
    }
    if (!Number.isInteger(instance.objectId) || instance.objectId <= 0) {
      throw new RangeError("Occurrence object IDs must be positive uint32 values.");
    }
    if (instance.objectId > 0xffff_ffff) {
      throw new RangeError("Occurrence object IDs must fit in uint32.");
    }
    if (objectIds.has(instance.objectId)) {
      throw new RangeError(`Duplicate occurrence object ID ${instance.objectId}.`);
    }
    if (
      instance.baseColor &&
      (instance.baseColor.length !== 4 ||
        instance.baseColor.some((value) => !Number.isFinite(value)))
    ) {
      throw new TypeError("Occurrence base colors must contain four finite values.");
    }
    objectIds.add(instance.objectId);
  }
}

export function validateGpuScene(scene: GpuScene): void {
  if (scene.batches.length === 0) {
    throw new TypeError("A GPU scene must contain at least one prototype batch.");
  }

  const objectIds = new Set<number>();
  for (const batch of scene.batches) {
    validatePrototypeBatch(batch);
    for (const instance of batch.instances) {
      if (!scene.sharedObjectIdsAcrossBatches && objectIds.has(instance.objectId)) {
        throw new RangeError(`Duplicate scene object ID ${instance.objectId}.`);
      }
      objectIds.add(instance.objectId);
    }
  }
}

export function packInstanceData(
  instances: readonly GpuOccurrenceInstance[],
): ArrayBuffer {
  const data = new ArrayBuffer(instances.length * instanceStride);
  packInstanceDataInto(instances, new DataView(data));
  return data;
}

/** Packs either all instances or a dense index table into reusable storage. */
export function packInstanceDataInto(
  instances: readonly GpuOccurrenceInstance[],
  target: DataView,
  sourceIndices?: ArrayLike<number>,
  sourceCount = sourceIndices?.length ?? instances.length,
): number {
  if (!Number.isInteger(sourceCount) || sourceCount < 0) {
    throw new RangeError("sourceCount must be a non-negative integer.");
  }
  if (sourceIndices && sourceCount > sourceIndices.length) {
    throw new RangeError("sourceCount exceeds the source index table.");
  }
  if (sourceCount * instanceStride > target.byteLength) {
    throw new RangeError("The target view is too small for the packed instances.");
  }

  for (let outputIndex = 0; outputIndex < sourceCount; outputIndex += 1) {
    const sourceIndex = sourceIndices?.[outputIndex] ?? outputIndex;
    const instance = instances[sourceIndex];
    if (!instance) throw new RangeError(`Instance index ${sourceIndex} is out of range.`);
    const base = outputIndex * instanceStride;
    instance.transform.forEach((value, matrixIndex) => {
      target.setFloat32(base + matrixIndex * 4, value, true);
    });
    target.setUint32(base + 64, instance.objectId, true);
    const color = instance.baseColor ?? [0.16, 0.55, 0.92, 1.0];
    color.forEach((value, channel) => {
      target.setFloat32(base + 80 + channel * 4, value, true);
    });
  }

  return sourceCount * instanceStride;
}

export function decodeObjectId(pixel: ArrayLike<number>): number {
  const r = pixel[0] ?? 0;
  const g = pixel[1] ?? 0;
  const b = pixel[2] ?? 0;
  const a = pixel[3] ?? 0;
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}
