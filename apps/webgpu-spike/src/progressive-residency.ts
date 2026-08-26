import { instanceStride } from "@naru3d/runtime-webgpu";
import type {
  CompiledBatchEvidence,
  DecodedCompiledScene,
  GpuPrototypeBatch,
} from "@naru3d/runtime-webgpu";

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
  /** Target mesh groups currently replacing their coarse fallbacks. */
  readonly targetMeshIndexes: readonly number[];
  /** Target mesh groups protected from eviction by the current selection. */
  readonly pinnedTargetMeshIndexes: readonly number[];
  readonly decodedBytes: number;
  readonly gpuBytes: number;
  readonly triangles: number;
  readonly edgeSegments: number;
}

export interface PromotionResult extends ResidencySnapshot {
  readonly admitted: boolean;
  /** Target groups replaced with their retained coarse fallback for this admission. */
  readonly evictedTargetMeshIndexes: readonly number[];
}

export interface PromotionOptions {
  /** Lower values are hotter; compiled target chunk priority is suitable here. */
  readonly priority?: number;
  /** Make this request's target groups eviction-proof until the next selection boost. */
  readonly pin?: boolean;
}

export interface ProgressiveResidencyOptions {
  /** Keep one shared coarse batch resident and mask its promoted instances. */
  readonly aggregateCoarse?: boolean;
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

function snapshot(
  entries: ReadonlyMap<string, ResidentBatch>,
  targetMeshIndexes: ReadonlySet<number>,
  pinnedTargetMeshIndexes: ReadonlySet<number>,
  coarseEntriesByTargetMesh: ReadonlyMap<number, readonly ResidentBatch[]>,
): ResidencySnapshot {
  const result = ordered(entries);
  const fallbackDecodedBytes = [...targetMeshIndexes].reduce(
    (total, targetMeshIndex) =>
      total + (coarseEntriesByTargetMesh.get(targetMeshIndex) ?? []).reduce(
        (batchTotal, { batch }) => batchTotal + estimateBatchDecodedBytes(batch),
        0,
      ),
    0,
  );
  return {
    entries: result,
    targetMeshIndexes: [...targetMeshIndexes].sort((left, right) => left - right),
    pinnedTargetMeshIndexes: [...pinnedTargetMeshIndexes].sort((left, right) => left - right),
    decodedBytes: result.reduce(
      (total, { batch }) => total + estimateBatchDecodedBytes(batch),
      0,
    ) + fallbackDecodedBytes,
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
 * Holds the current coarse/target mix. The legacy path retains per-target
 * coarse batches; aggregate mode keeps one shared coarse batch and lets the
 * visibility layer mask promoted instances. Both paths can displace colder
 * target groups without losing pickable identity or exceeding either budget.
 */
export class ProgressiveResidency {
  readonly budget: ResidencyBudget;
  private readonly entries = new Map<string, ResidentBatch>();
  private readonly coarseEntriesByTargetMesh = new Map<number, readonly ResidentBatch[]>();
  private readonly targetMeshIndexes = new Set<number>();
  private readonly pinnedTargetMeshIndexes = new Set<number>();
  private readonly priorityByTargetMesh = new Map<number, number>();
  private readonly lastTouchedByTargetMesh = new Map<number, number>();
  private readonly aggregateCoarse: boolean;
  private touchSequence = 0;

  constructor(
    coarse: DecodedCompiledScene,
    budget: ResidencyBudget,
    options: ProgressiveResidencyOptions = {},
  ) {
    if (
      !Number.isSafeInteger(budget.decodedBytes) ||
      !Number.isSafeInteger(budget.gpuBytes) ||
      budget.decodedBytes < 4 ||
      budget.gpuBytes < 4
    ) {
      throw new TypeError("Residency budgets must be integer values of at least four bytes.");
    }
    this.budget = budget;
    this.aggregateCoarse = options.aggregateCoarse === true;
    for (const entry of entriesFromScene(coarse)) {
      const residencyEntry = this.aggregateCoarse
        ? { ...entry, key: "coarse:aggregate" }
        : entry;
      if (this.entries.has(residencyEntry.key)) {
        throw new RangeError(`Duplicate coarse residency key ${residencyEntry.key}.`);
      }
      this.entries.set(residencyEntry.key, residencyEntry);
      if (this.aggregateCoarse) continue;
      const targetMeshIndex = entry.evidence.targetMeshIndex;
      const group = this.coarseEntriesByTargetMesh.get(targetMeshIndex) ?? [];
      this.coarseEntriesByTargetMesh.set(targetMeshIndex, [...group, entry]);
    }
    const initial = this.snapshot();
    if (initial.decodedBytes > budget.decodedBytes || initial.gpuBytes > budget.gpuBytes) {
      throw new RangeError("The coarse representation exceeds the configured residency budget.");
    }
  }

  current(): ResidencySnapshot {
    return this.snapshot();
  }

  hasTargetMeshes(targetMeshIndexes: readonly number[]): boolean {
    return targetMeshIndexes.every((targetMeshIndex) => this.targetMeshIndexes.has(targetMeshIndex));
  }

  /** Pins already-resident target groups after selecting an object. */
  pinTargetMeshes(targetMeshIndexes: readonly number[]): ResidencySnapshot {
    this.pinnedTargetMeshIndexes.clear();
    for (const targetMeshIndex of targetMeshIndexes) {
      if (!this.targetMeshIndexes.has(targetMeshIndex)) continue;
      this.pinnedTargetMeshIndexes.add(targetMeshIndex);
      this.touch(targetMeshIndex);
    }
    return this.snapshot();
  }

  promote(target: DecodedCompiledScene, options: PromotionOptions = {}): PromotionResult {
    const priority = options.priority ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(priority) || priority < 0) {
      throw new TypeError("Target residency priority must be a non-negative safe integer.");
    }
    const replacements = entriesFromScene(target);
    const targetMeshes = new Set(
      replacements.map(({ evidence }) => evidence.targetMeshIndex),
    );
    const candidate = new Map(this.entries);
    this.removeTargetMeshes(candidate, targetMeshes);
    for (const replacement of replacements) candidate.set(replacement.key, replacement);
    const candidateTargetMeshes = new Set(this.targetMeshIndexes);
    for (const targetMeshIndex of targetMeshes) candidateTargetMeshes.add(targetMeshIndex);
    const candidatePins = options.pin
      ? new Set(targetMeshes)
      : new Set(
          [...this.pinnedTargetMeshIndexes].filter((targetMeshIndex) =>
            candidateTargetMeshes.has(targetMeshIndex),
          ),
        );
    const candidatePriorities = new Map(this.priorityByTargetMesh);
    const candidateTouches = new Map(this.lastTouchedByTargetMesh);
    for (const targetMeshIndex of targetMeshes) {
      candidatePriorities.set(targetMeshIndex, priority);
      candidateTouches.set(targetMeshIndex, this.nextTouch());
    }

    const evictedTargetMeshIndexes: number[] = [];
    while (!this.fitsBudget(candidate, candidateTargetMeshes, candidatePins)) {
      const eviction = [...candidateTargetMeshes]
        .filter(
          (targetMeshIndex) =>
            !targetMeshes.has(targetMeshIndex) &&
            !candidatePins.has(targetMeshIndex) &&
            (options.pin || (candidatePriorities.get(targetMeshIndex) ?? priority) > priority),
        )
        .sort(
          (left, right) =>
            (candidatePriorities.get(right) ?? Number.MAX_SAFE_INTEGER) -
              (candidatePriorities.get(left) ?? Number.MAX_SAFE_INTEGER) ||
            (candidateTouches.get(left) ?? 0) - (candidateTouches.get(right) ?? 0) ||
            left - right,
        )[0];
      if (eviction === undefined) {
        return { admitted: false, evictedTargetMeshIndexes: [], ...this.current() };
      }
      this.replaceWithCoarse(candidate, eviction);
      candidateTargetMeshes.delete(eviction);
      candidatePins.delete(eviction);
      candidatePriorities.delete(eviction);
      candidateTouches.delete(eviction);
      evictedTargetMeshIndexes.push(eviction);
    }

    this.entries.clear();
    for (const [key, entry] of candidate) this.entries.set(key, entry);
    this.replaceSet(this.targetMeshIndexes, candidateTargetMeshes);
    this.replaceSet(this.pinnedTargetMeshIndexes, candidatePins);
    this.replaceMap(this.priorityByTargetMesh, candidatePriorities);
    this.replaceMap(this.lastTouchedByTargetMesh, candidateTouches);
    return { admitted: true, evictedTargetMeshIndexes, ...this.current() };
  }

  private snapshot(): ResidencySnapshot {
    return snapshot(
      this.entries,
      this.targetMeshIndexes,
      this.pinnedTargetMeshIndexes,
      this.coarseEntriesByTargetMesh,
    );
  }

  private fitsBudget(
    entries: ReadonlyMap<string, ResidentBatch>,
    targetMeshIndexes: ReadonlySet<number>,
    pinnedTargetMeshIndexes: ReadonlySet<number>,
  ): boolean {
    const candidate = snapshot(
      entries,
      targetMeshIndexes,
      pinnedTargetMeshIndexes,
      this.coarseEntriesByTargetMesh,
    );
    return (
      candidate.decodedBytes <= this.budget.decodedBytes &&
      candidate.gpuBytes <= this.budget.gpuBytes
    );
  }

  private removeTargetMeshes(
    entries: Map<string, ResidentBatch>,
    targetMeshIndexes: ReadonlySet<number>,
  ): void {
    for (const [key, entry] of entries) {
      if (targetMeshIndexes.has(entry.evidence.targetMeshIndex)) entries.delete(key);
    }
  }

  private replaceWithCoarse(entries: Map<string, ResidentBatch>, targetMeshIndex: number): void {
    this.removeTargetMeshes(entries, new Set([targetMeshIndex]));
    if (this.aggregateCoarse) return;
    const coarse = this.coarseEntriesByTargetMesh.get(targetMeshIndex);
    if (!coarse) {
      throw new RangeError(`Missing coarse fallback for target mesh ${targetMeshIndex}.`);
    }
    for (const entry of coarse) entries.set(entry.key, entry);
  }

  private touch(targetMeshIndex: number): void {
    this.lastTouchedByTargetMesh.set(targetMeshIndex, this.nextTouch());
  }

  private nextTouch(): number {
    this.touchSequence += 1;
    return this.touchSequence;
  }

  private replaceSet(target: Set<number>, source: ReadonlySet<number>): void {
    target.clear();
    for (const value of source) target.add(value);
  }

  private replaceMap(target: Map<number, number>, source: ReadonlyMap<number, number>): void {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  }
}
