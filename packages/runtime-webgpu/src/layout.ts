export interface GpuOccurrenceInstance {
  /** Column-major local-to-world transform. */
  readonly transform: Float32Array;
  /** Zero is reserved for the picking background. */
  readonly objectId: number;
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

export const instanceStride = 80;

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
    objectIds.add(instance.objectId);
  }
}

export function packInstanceData(
  instances: readonly GpuOccurrenceInstance[],
): ArrayBuffer {
  const data = new ArrayBuffer(instances.length * instanceStride);
  const view = new DataView(data);

  instances.forEach((instance, instanceIndex) => {
    const base = instanceIndex * instanceStride;
    instance.transform.forEach((value, matrixIndex) => {
      view.setFloat32(base + matrixIndex * 4, value, true);
    });
    view.setUint32(base + 64, instance.objectId, true);
  });

  return data;
}

export function decodeObjectId(pixel: ArrayLike<number>): number {
  const r = pixel[0] ?? 0;
  const g = pixel[1] ?? 0;
  const b = pixel[2] ?? 0;
  const a = pixel[3] ?? 0;
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}
