import { describe, expect, it } from "vitest";

import type { GpuPrototypeBatch, GpuScene } from "@naru3d/runtime-webgpu";

import { OccurrenceVisibility, syncHierarchyVisibility } from "../src/visibility.js";

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function batch(objectIds: readonly number[]): GpuPrototypeBatch {
  return {
    surfaceVertices: new Float32Array(),
    surfaceIndices: new Uint32Array(),
    edgeVertices: new Float32Array(),
    instances: objectIds.map((objectId) => ({ transform: identity, objectId })),
  };
}

function scene(): GpuScene {
  return { batches: [batch([1, 2]), batch([3])] };
}

describe("occurrence visibility", () => {
  it("synchronizes hierarchy markers through the node lookup", () => {
    const first = { dataset: { hidden: "true" } };
    const second = { dataset: {} as { hidden?: string } };

    syncHierarchyVisibility(
      [
        { nodeIndex: 10, objectId: 1 },
        { nodeIndex: 20, objectId: 2 },
        { nodeIndex: 30, objectId: 3 },
      ],
      new Map([
        [10, first],
        [20, second],
      ]),
      (objectId) => objectId === 1,
    );

    expect(first.dataset.hidden).toBeUndefined();
    expect(second.dataset.hidden).toBe("true");
  });

  it("builds full dense tables initially", () => {
    const visibility = new OccurrenceVisibility(scene());

    expect(Array.from(visibility.counts)).toEqual([2, 1]);
    expect(Array.from(visibility.indicesByBatch[0] ?? [])).toEqual([0, 1]);
    expect(visibility.state()).toEqual({
      mode: "all",
      totalOccurrences: 3,
      visibleOccurrences: 3,
      hiddenOccurrences: 0,
    });
  });

  it("hides one occurrence and reuses the allocated tables", () => {
    const visibility = new OccurrenceVisibility(scene());
    const firstTable = visibility.indicesByBatch[0];
    const counts = visibility.counts;

    visibility.hide(1);

    expect(visibility.indicesByBatch[0]).toBe(firstTable);
    expect(visibility.counts).toBe(counts);
    expect(Array.from(visibility.counts)).toEqual([1, 1]);
    expect(visibility.indicesByBatch[0]?.[0]).toBe(1);
    expect(visibility.isVisible(1)).toBe(false);
    expect(visibility.state().mode).toBe("hidden");
  });

  it("isolates across prototypes and restores all occurrences", () => {
    const visibility = new OccurrenceVisibility(scene());

    visibility.isolate(3);
    expect(Array.from(visibility.counts)).toEqual([0, 1]);
    expect(visibility.state()).toEqual({
      mode: "isolated",
      totalOccurrences: 3,
      visibleOccurrences: 1,
      hiddenOccurrences: 2,
      isolatedObjectId: 3,
    });

    visibility.showAll();
    expect(Array.from(visibility.counts)).toEqual([2, 1]);
    expect(visibility.state().mode).toBe("all");
  });

  it("rejects unknown occurrence IDs", () => {
    const visibility = new OccurrenceVisibility(scene());
    expect(() => visibility.hide(99)).toThrow(/Unknown scene object ID 99/u);
    expect(() => visibility.isolate(0)).toThrow(/Unknown scene object ID 0/u);
  });

  it("counts and filters material-split occurrences once", () => {
    const visibility = new OccurrenceVisibility({
      batches: [batch([1, 2]), batch([1])],
      sharedObjectIdsAcrossBatches: true,
    });

    expect(visibility.state().totalOccurrences).toBe(2);
    expect(visibility.state().visibleOccurrences).toBe(2);
    visibility.hide(1);
    expect(Array.from(visibility.counts)).toEqual([1, 0]);
    expect(visibility.state()).toMatchObject({
      visibleOccurrences: 1,
      hiddenOccurrences: 1,
    });
  });

  it("preserves hidden and isolated intent across a replacement scene", () => {
    const first = new OccurrenceVisibility(scene());
    first.hide(1);
    const hidden = first.snapshot();
    const replacement = new OccurrenceVisibility(scene());

    replacement.restore(hidden);
    expect(replacement.state()).toMatchObject({ mode: "hidden", visibleOccurrences: 2 });
    expect(replacement.isVisible(1)).toBe(false);

    first.isolate(3);
    replacement.restore(first.snapshot());
    expect(replacement.state()).toMatchObject({
      mode: "isolated",
      visibleOccurrences: 1,
      isolatedObjectId: 3,
    });
  });

  it("combines residency masking with user visibility", () => {
    const visibility = new OccurrenceVisibility(
      { batches: [batch([1, 2]), batch([1])], sharedObjectIdsAcrossBatches: true },
      (batchIndex, instanceIndex) => batchIndex !== 0 || instanceIndex !== 0,
    );

    expect(Array.from(visibility.counts)).toEqual([1, 1]);
    expect(visibility.state()).toMatchObject({
      totalOccurrences: 2,
      visibleOccurrences: 2,
    });
    visibility.hide(1);
    expect(Array.from(visibility.counts)).toEqual([1, 0]);
    expect(visibility.state().visibleOccurrences).toBe(1);
  });
});
