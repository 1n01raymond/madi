import { describe, expect, it } from "vitest";

import {
  encodeSpatialDemandIndex,
  spatialDemandIndexSchema,
} from "../src/index.js";
import type { SpatialDemandOccurrence } from "../src/index.js";

const occurrences: readonly SpatialDemandOccurrence[] = [
  {
    id: "occurrence:c",
    nodeIndex: 7,
    targetChunkIndex: 1,
    minimum: [10_000_000.000_25, -3, 4],
    maximum: [10_000_000.125_25, -2, 5],
  },
  {
    id: "occurrence:a",
    nodeIndex: 3,
    targetChunkIndex: 0,
    minimum: [-8, -2, -1],
    maximum: [-6, 2, 1],
  },
  {
    id: "occurrence:b",
    nodeIndex: 5,
    targetChunkIndex: 0,
    minimum: [2, 0, 1],
    maximum: [3, 1, 2],
  },
];

describe("spatial demand index encoder", () => {
  it("builds the same f64 BVH regardless of occurrence input order", () => {
    const first = encodeSpatialDemandIndex(occurrences, { leafCapacity: 1 });
    const second = encodeSpatialDemandIndex([...occurrences].reverse(), { leafCapacity: 1 });
    const view = new DataView(first.bytes.buffer);

    expect(first.schemaVersion).toBe(spatialDemandIndexSchema);
    expect(second.bytes).toEqual(first.bytes);
    expect(first.stats).toEqual({
      nodeCount: 5,
      leafCount: 3,
      occurrenceCount: 3,
      chunkReferenceCount: 3,
      maxDepth: 2,
      leafCapacity: 1,
    });
    expect(new TextDecoder().decode(first.bytes.subarray(0, 4))).toBe("NSDI");
    expect(view.getFloat64(64, true)).toBe(-8);
    expect(view.getFloat64(64 + 24, true)).toBe(10_000_000.125_25);
  });

  it("deduplicates and sorts target chunks within each leaf", () => {
    const encoded = encodeSpatialDemandIndex(occurrences, { leafCapacity: 3 });
    const view = new DataView(encoded.bytes.buffer);
    const chunkOffset = view.getUint32(52, true);

    expect(encoded.stats.chunkReferenceCount).toBe(2);
    expect(view.getUint32(chunkOffset, true)).toBe(0);
    expect(view.getUint32(chunkOffset + 4, true)).toBe(1);
  });

  it("rejects ambiguous identity, invalid bounds, and invalid leaf capacity", () => {
    expect(() => encodeSpatialDemandIndex([occurrences[0]!, occurrences[0]!])).toThrow(
      /Duplicate spatial occurrence id/u,
    );
    expect(() =>
      encodeSpatialDemandIndex([
        { ...occurrences[0]!, id: "bad", minimum: [Number.NaN, 0, 0] },
      ]),
    ).toThrow(/invalid axis 0 bounds/u);
    expect(() => encodeSpatialDemandIndex(occurrences, { leafCapacity: 0 })).toThrow(
      /between 1 and 65535/u,
    );
  });
});
