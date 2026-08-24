import type { GpuScene } from "@naru3d/runtime-webgpu";

export type VisibilityMode = "all" | "hidden" | "isolated";

export interface VisibilityState {
  readonly mode: VisibilityMode;
  readonly totalOccurrences: number;
  readonly visibleOccurrences: number;
  readonly hiddenOccurrences: number;
  readonly isolatedObjectId?: number;
}

export interface OccurrenceVisibilitySnapshot {
  readonly hiddenObjectIds: readonly number[];
  readonly isolatedObjectId?: number;
}

/**
 * Builds dense per-prototype instance tables without allocating during review
 * actions. The renderer consumes these tables through updateVisibleInstances().
 */
export class OccurrenceVisibility {
  readonly indicesByBatch: readonly Int32Array[];
  readonly counts: Uint32Array;

  private readonly scene: GpuScene;
  private readonly objectIds = new Set<number>();
  private readonly hiddenObjectIds = new Set<number>();
  private isolatedObjectId?: number;
  private visibleOccurrences = 0;

  constructor(scene: GpuScene) {
    this.scene = scene;
    this.indicesByBatch = scene.batches.map(
      (batch) => new Int32Array(batch.instances.length),
    );
    this.counts = new Uint32Array(scene.batches.length);
    for (const batch of scene.batches) {
      for (const instance of batch.instances) {
        if (
          !scene.sharedObjectIdsAcrossBatches &&
          this.objectIds.has(instance.objectId)
        ) {
          throw new RangeError(`Duplicate scene object ID ${instance.objectId}.`);
        }
        this.objectIds.add(instance.objectId);
      }
    }
    this.rebuildTables();
  }

  hide(objectId: number): void {
    this.requireObject(objectId);
    this.isolatedObjectId = undefined;
    this.hiddenObjectIds.add(objectId);
    this.rebuildTables();
  }

  isolate(objectId: number): void {
    this.requireObject(objectId);
    this.isolatedObjectId = objectId;
    this.rebuildTables();
  }

  showAll(): void {
    this.hiddenObjectIds.clear();
    this.isolatedObjectId = undefined;
    this.rebuildTables();
  }

  isVisible(objectId: number): boolean {
    if (!this.objectIds.has(objectId)) return false;
    return this.isolatedObjectId === undefined
      ? !this.hiddenObjectIds.has(objectId)
      : this.isolatedObjectId === objectId;
  }

  state(): VisibilityState {
    const mode =
      this.isolatedObjectId !== undefined
        ? "isolated"
        : this.hiddenObjectIds.size > 0
          ? "hidden"
          : "all";
    return {
      mode,
      totalOccurrences: this.objectIds.size,
      visibleOccurrences: this.visibleOccurrences,
      hiddenOccurrences: this.objectIds.size - this.visibleOccurrences,
      ...(this.isolatedObjectId === undefined
        ? {}
        : { isolatedObjectId: this.isolatedObjectId }),
    };
  }

  /** Captures user visibility intent before residency changes rebuild batch tables. */
  snapshot(): OccurrenceVisibilitySnapshot {
    return {
      hiddenObjectIds: [...this.hiddenObjectIds].sort((left, right) => left - right),
      ...(this.isolatedObjectId === undefined ? {} : { isolatedObjectId: this.isolatedObjectId }),
    };
  }

  /** Reapplies visibility intent to a scene with replacement GPU batches. */
  restore(snapshot: OccurrenceVisibilitySnapshot): void {
    this.hiddenObjectIds.clear();
    for (const objectId of snapshot.hiddenObjectIds) {
      this.requireObject(objectId);
      this.hiddenObjectIds.add(objectId);
    }
    if (snapshot.isolatedObjectId !== undefined) {
      this.requireObject(snapshot.isolatedObjectId);
    }
    this.isolatedObjectId = snapshot.isolatedObjectId;
    this.rebuildTables();
  }

  private rebuildTables(): void {
    const visibleObjectIds = new Set<number>();
    this.scene.batches.forEach((batch, batchIndex) => {
      const indices = this.indicesByBatch[batchIndex];
      if (!indices) throw new RangeError(`Missing visibility table ${batchIndex}.`);
      let count = 0;
      batch.instances.forEach((instance, sourceIndex) => {
        if (this.isVisible(instance.objectId)) {
          indices[count] = sourceIndex;
          count += 1;
          visibleObjectIds.add(instance.objectId);
        }
      });
      this.counts[batchIndex] = count;
    });
    this.visibleOccurrences = visibleObjectIds.size;
  }

  private requireObject(objectId: number): void {
    if (!this.objectIds.has(objectId)) {
      throw new RangeError(`Unknown scene object ID ${objectId}.`);
    }
  }
}
