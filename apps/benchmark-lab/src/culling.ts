import type { IndustrialWorkload } from "./workload.js";

export interface DenseVisibility {
  readonly indicesByBatch: readonly Int32Array[];
  readonly counts: Uint32Array;
  readonly visibleOccurrences: number;
}

interface MutableDenseVisibility extends DenseVisibility {
  visibleOccurrences: number;
}

/** Allocation-stable CPU sphere/frustum culling over dense occurrence tables. */
export class DenseFrustumCuller {
  private readonly boundsByBatch: readonly Float32Array[];
  private readonly indicesByBatch: readonly Int32Array[];
  private readonly counts: Uint32Array;
  private readonly planes = new Float32Array(24);
  private readonly result: MutableDenseVisibility;

  constructor(workload: IndustrialWorkload) {
    this.boundsByBatch = workload.instanceBounds;
    this.indicesByBatch = workload.instanceBounds.map(
      (bounds) => new Int32Array(bounds.length / 4),
    );
    this.counts = new Uint32Array(workload.instanceBounds.length);
    this.result = { indicesByBatch: this.indicesByBatch, counts: this.counts, visibleOccurrences: 0 };
  }

  cull(viewProjection: Float32Array): DenseVisibility {
    if (viewProjection.length !== 16) {
      throw new TypeError("viewProjection must contain 16 float32 values.");
    }
    extractWebGpuFrustumPlanes(viewProjection, this.planes);
    let total = 0;

    for (let batchIndex = 0; batchIndex < this.boundsByBatch.length; batchIndex += 1) {
      const bounds = this.boundsByBatch[batchIndex];
      const visibleIndices = this.indicesByBatch[batchIndex];
      if (!bounds || !visibleIndices) continue;
      let count = 0;
      for (let offset = 0, instanceIndex = 0; offset < bounds.length; offset += 4, instanceIndex += 1) {
        if (sphereIntersectsFrustum(
          this.planes,
          bounds[offset] ?? 0,
          bounds[offset + 1] ?? 0,
          bounds[offset + 2] ?? 0,
          bounds[offset + 3] ?? 0,
        )) {
          visibleIndices[count] = instanceIndex;
          count += 1;
        }
      }
      this.counts[batchIndex] = count;
      total += count;
    }

    this.result.visibleOccurrences = total;
    return this.result;
  }
}

export function extractWebGpuFrustumPlanes(
  matrix: Float32Array,
  target = new Float32Array(24),
): Float32Array {
  if (matrix.length !== 16 || target.length < 24) {
    throw new RangeError("A 4x4 matrix and storage for six vec4 planes are required.");
  }
  writeNormalizedPlane(target, 0, matrix[3]! + matrix[0]!, matrix[7]! + matrix[4]!, matrix[11]! + matrix[8]!, matrix[15]! + matrix[12]!);
  writeNormalizedPlane(target, 4, matrix[3]! - matrix[0]!, matrix[7]! - matrix[4]!, matrix[11]! - matrix[8]!, matrix[15]! - matrix[12]!);
  writeNormalizedPlane(target, 8, matrix[3]! + matrix[1]!, matrix[7]! + matrix[5]!, matrix[11]! + matrix[9]!, matrix[15]! + matrix[13]!);
  writeNormalizedPlane(target, 12, matrix[3]! - matrix[1]!, matrix[7]! - matrix[5]!, matrix[11]! - matrix[9]!, matrix[15]! - matrix[13]!);
  writeNormalizedPlane(target, 16, matrix[2]!, matrix[6]!, matrix[10]!, matrix[14]!);
  writeNormalizedPlane(target, 20, matrix[3]! - matrix[2]!, matrix[7]! - matrix[6]!, matrix[11]! - matrix[10]!, matrix[15]! - matrix[14]!);
  return target;
}

function writeNormalizedPlane(
  target: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const inverseLength = 1 / Math.max(Number.EPSILON, Math.hypot(x, y, z));
  target[offset] = x * inverseLength;
  target[offset + 1] = y * inverseLength;
  target[offset + 2] = z * inverseLength;
  target[offset + 3] = w * inverseLength;
}

function sphereIntersectsFrustum(
  planes: Float32Array,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  for (let offset = 0; offset < 24; offset += 4) {
    const distance =
      (planes[offset] ?? 0) * x +
      (planes[offset + 1] ?? 0) * y +
      (planes[offset + 2] ?? 0) * z +
      (planes[offset + 3] ?? 0);
    if (distance < -radius) return false;
  }
  return true;
}
