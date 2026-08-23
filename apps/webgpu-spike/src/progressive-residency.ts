import { instanceStride } from "@madi/runtime-webgpu";
import type {
  CompiledBatchEvidence,
  DecodedCompiledScene,
  GpuPrototypeBatch,
} from "@madi/runtime-webgpu";

export const defaultProgressiveResidencyBudget = 64 * 1024 * 1024;

export interface ResidentBatch {
  readonly key: string;
  readonly batch: GpuPrototypeBatch;
  readonly evidence: Omit<CompiledBatchEvidence, "batchIndex">;
}

export interface ResidencyBudget {
  /** Maximum decoded typed-array payload retained by the runtime. */
  readonly decodedBytes: number;
  /** Maximum geometry and instance buffer allocation submitted to WebGPU. */
  readonly gpuBytes: number;
}

export interface ResidencySnapshot {
  readonly entries: readonly ResidentBatch[];
  readonly decodedBytes: number;
  readonly gpuBytes: number;
  readonly triangles: number;
  readonly edgeSegments: number;
}

export interface PromotionResult extends ResidencySnapshot {
  readonly admitted: boolean;
}

function alignedBufferByteLength(byteLength: number): number {
  return Math.max(4, Math.ceil(byteLength / 4) * 4);
}

/** Exact source payload used to create the four renderer buffers for one batch. */
export function estimateBatchDecodedBytes(batch: GpuPrototypeBatch): number {
  return (
    batch.surfaceVertices.byteLength +
    batch.surfaceIndices.byteLength +
    batch.edgeVertices.byteLength +
    batch.instances.length * instanceStride
  );
}

/** WebGPU's four-byte buffer alignment is included in this conservative estimate. */
export function estimateBatchGpuBytes(batch: GpuPrototypeBatch): number {
  return (
    alignedBufferByteLength(batch.surfaceVertices.byteLength) +
    alignedBufferByteLength(batch.surfaceIndices.byteLength) +
    alignedBufferByteLength(batch.edgeVertices.byteLength) +
    alignedBufferByteLength(batch.instances.length * instanceStride)
  );
}

export function residentBatchKey(
  evidence: Omit<CompiledBatchEvidence, "batchIndex">,
): string {
  return `${evidence.targetMeshIndex}:${evidence.surfacePrimitiveIndex}`;
}

function ordered(entries: ReadonlyMap<string, ResidentBatch>): readonly ResidentBatch[] {
  return [...entries.values()].sort(
    (left, right) =>
      left.evidence.targetMeshIndex - right.evidence.targetMeshIndex ||
      left.evidence.surfacePrimitiveIndex - right.evidence.surfacePrimitiveIndex,
  );
}

function snapshot(entries: ReadonlyMap<string, ResidentBatch>): ResidencySnapshot {
  const result = ordered(entries);
  return {
    entries: result,
    decodedBytes: result.reduce(
      (total, { batch }) => total + estimateBatchDecodedBytes(batch),
      0,
    ),
    gpuBytes: result.reduce((total, { batch }) => total + estimateBatchGpuBytes(batch), 0),
    triangles: result.reduce((total, { batch }) => total + batch.surfaceIndices.length / 3, 0),
    edgeSegments: result.reduce((total, { batch }) => total + batch.edgeVertices.length / 6, 0),
  };
}

function entriesFromScene(scene: DecodedCompiledScene): readonly ResidentBatch[] {
  return scene.batchEvidence.map((identity) => {
    const batch = scene.gpuScene.batches[identity.batchIndex];
    if (!batch) throw new Error("Compiled geometry batch identity is incomplete.");
    const { batchIndex: _, ...evidence } = identity;
    return { key: residentBatchKey(evidence), batch, evidence };
  });
}

/**
 * Holds the current coarse/target mix. A promotion replaces every batch for
 * its target mesh atomically, so a rejected request leaves its coarse fallback
 * intact and both decoded and GPU estimates remain below the declared budget.
 */
export class ProgressiveResidency {
  readonly budget: ResidencyBudget;
  private readonly entries = new Map<string, ResidentBatch>();

  constructor(coarse: DecodedCompiledScene, budget: ResidencyBudget) {
    if (
      !Number.isSafeInteger(budget.decodedBytes) ||
      !Number.isSafeInteger(budget.gpuBytes) ||
      budget.decodedBytes < 4 ||
      budget.gpuBytes < 4
    ) {
      throw new TypeError("Residency budgets must be integer values of at least four bytes.");
    }
    this.budget = budget;
    for (const entry of entriesFromScene(coarse)) this.entries.set(entry.key, entry);
    const initial = snapshot(this.entries);
    if (initial.decodedBytes > budget.decodedBytes || initial.gpuBytes > budget.gpuBytes) {
      throw new RangeError("The coarse representation exceeds the configured residency budget.");
    }
  }

  current(): ResidencySnapshot {
    return snapshot(this.entries);
  }

  promote(target: DecodedCompiledScene): PromotionResult {
    const replacements = entriesFromScene(target);
    const targetMeshes = new Set(
      replacements.map(({ evidence }) => evidence.targetMeshIndex),
    );
    const candidate = new Map(this.entries);
    for (const [key, entry] of candidate) {
      if (targetMeshes.has(entry.evidence.targetMeshIndex)) candidate.delete(key);
    }
    for (const replacement of replacements) candidate.set(replacement.key, replacement);
    const next = snapshot(candidate);
    if (
      next.decodedBytes > this.budget.decodedBytes ||
      next.gpuBytes > this.budget.gpuBytes
    ) {
      return { admitted: false, ...this.current() };
    }
    this.entries.clear();
    for (const [key, entry] of candidate) this.entries.set(key, entry);
    return { admitted: true, ...next };
  }
}
