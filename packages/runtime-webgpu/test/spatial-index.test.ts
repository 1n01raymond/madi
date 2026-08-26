import { describe, expect, it } from "vitest";

import { encodeSpatialDemandIndex } from "../../compiler/src/spatial-demand.js";
import {
  decodeSpatialDemandIndex,
  querySpatialDemandIndex,
  SpatialDemandIndexError,
  supportedSpatialDemandIndexSchema,
} from "../src/index.js";

const leafSentinel = 0xffff_ffff;

function validIndex(): Uint8Array {
  const bytes = new Uint8Array(64 + 3 * 72 + 2 * 8 + 2 * 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4e, 0x53, 0x44, 0x49]);
  view.setUint32(4, 1, true);
  view.setUint32(8, 64, true);
  view.setUint32(12, 72, true);
  view.setUint32(16, 3, true);
  view.setUint32(20, 2, true);
  view.setUint32(24, 2, true);
  view.setUint32(28, 2, true);
  view.setUint32(32, 0, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 1, true);
  view.setUint32(44, 64, true);
  view.setUint32(48, 64 + 3 * 72, true);
  view.setUint32(52, 64 + 3 * 72 + 2 * 8, true);
  view.setUint32(56, bytes.byteLength, true);

  const writeNode = (
    index: number,
    minimum: readonly [number, number, number],
    maximum: readonly [number, number, number],
    left: number,
    right: number,
    firstOccurrence: number,
    occurrenceCount: number,
    firstChunk: number,
    chunkCount: number,
  ) => {
    const offset = 64 + index * 72;
    minimum.forEach((value, axis) => view.setFloat64(offset + axis * 8, value, true));
    maximum.forEach((value, axis) => view.setFloat64(offset + 24 + axis * 8, value, true));
    view.setUint32(offset + 48, left, true);
    view.setUint32(offset + 52, right, true);
    view.setUint32(offset + 56, firstOccurrence, true);
    view.setUint32(offset + 60, occurrenceCount, true);
    view.setUint32(offset + 64, firstChunk, true);
    view.setUint32(offset + 68, chunkCount, true);
  };
  writeNode(0, [-2, -1, -1], [10_000_000.125_25, 1, 1], 1, 2, 0, 0, 0, 0);
  writeNode(1, [-2, -1, -1], [-1, 1, 1], leafSentinel, leafSentinel, 0, 1, 0, 1);
  writeNode(
    2,
    [10_000_000.000_25, 0, 0],
    [10_000_000.125_25, 1, 1],
    leafSentinel,
    leafSentinel,
    1,
    1,
    1,
    1,
  );
  const occurrencesOffset = 64 + 3 * 72;
  view.setUint32(occurrencesOffset, 3, true);
  view.setUint32(occurrencesOffset + 4, 0, true);
  view.setUint32(occurrencesOffset + 8, 7, true);
  view.setUint32(occurrencesOffset + 12, 1, true);
  const chunksOffset = occurrencesOffset + 16;
  view.setUint32(chunksOffset, 0, true);
  view.setUint32(chunksOffset + 4, 1, true);
  return bytes;
}

describe("spatial demand index runtime boundary", () => {
  it("decodes compiler v1 output without reducing large coordinates to f32", () => {
    const encoded = encodeSpatialDemandIndex(
      [
        {
          id: "occurrence:large",
          nodeIndex: 7,
          targetChunkIndex: 1,
          minimum: [10_000_000.000_25, 0, 0],
          maximum: [10_000_000.125_25, 1, 1],
        },
        {
          id: "occurrence:origin",
          nodeIndex: 3,
          targetChunkIndex: 0,
          minimum: [-2, -1, -1],
          maximum: [-1, 1, 1],
        },
      ],
      { leafCapacity: 1 },
    );
    const decoded = decodeSpatialDemandIndex(encoded.bytes, {
      gltfNodeCount: 8,
      targetChunkCount: 2,
      expectedOccurrenceCount: 2,
    });

    expect(decoded.stats).toEqual(encoded.stats);
    expect(decoded.bounds[3]).toBe(10_000_000.125_25);
    expect(Math.fround(decoded.bounds[3]!)).not.toBe(decoded.bounds[3]);
  });

  it("visits only intersecting leaves and returns their deduplicated target demand", () => {
    const decoded = decodeSpatialDemandIndex(validIndex(), {
      gltfNodeCount: 8,
      targetChunkCount: 2,
    });
    const viewProjection = new Float64Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);

    expect(querySpatialDemandIndex(decoded, { viewProjection, origin: [0, 0, 0] })).toEqual({
      candidates: [{ targetChunkIndex: 0, screenDistanceSquared: 2.25 }],
      visitedNodeCount: 3,
      visibleLeafCount: 1,
      testedOccurrenceCount: 1,
    });
    expect(
      querySpatialDemandIndex(decoded, {
        viewProjection,
        origin: [10_000_000.062_75, 0, 0],
      }).candidates,
    ).toEqual([{ targetChunkIndex: 1, screenDistanceSquared: 0.25 }]);
  });

  it("has no false negatives against a brute-force orthographic oracle", () => {
    const occurrences = Array.from({ length: 100 }, (_, index) => {
      const x = (index % 10) * 2 - 9;
      const y = Math.floor(index / 10) * 2 - 9;
      return {
        id: `occurrence:${String(index).padStart(3, "0")}`,
        nodeIndex: index,
        targetChunkIndex: index,
        minimum: [x - 0.25, y - 0.25, 0] as const,
        maximum: [x + 0.25, y + 0.25, 1] as const,
      };
    });
    const encoded = encodeSpatialDemandIndex(occurrences, { leafCapacity: 4 });
    const decoded = decodeSpatialDemandIndex(encoded.bytes, {
      gltfNodeCount: occurrences.length,
      targetChunkCount: occurrences.length,
    });
    const result = querySpatialDemandIndex(decoded, {
      viewProjection: new Float64Array([
        0.25, 0, 0, 0,
        0, 0.25, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      origin: [0, 0, 0],
    });
    const bruteForce = occurrences
      .filter(({ minimum, maximum }) =>
        maximum[0] >= -4 && minimum[0] <= 4 && maximum[1] >= -4 && minimum[1] <= 4,
      )
      .map(({ targetChunkIndex }) => targetChunkIndex);
    const candidates = new Set(result.candidates.map(({ targetChunkIndex }) => targetChunkIndex));

    expect(bruteForce.every((chunkIndex) => candidates.has(chunkIndex))).toBe(true);
    expect(result.candidates.length).toBeLessThan(occurrences.length);
    expect(result.visitedNodeCount).toBeLessThan(encoded.stats.nodeCount);
    expect(result.testedOccurrenceCount).toBeLessThan(occurrences.length);
  });

  it("decodes exact f64 bounds and occurrence-to-chunk ownership", () => {
    const decoded = decodeSpatialDemandIndex(validIndex(), {
      gltfNodeCount: 8,
      targetChunkCount: 2,
      expectedOccurrenceCount: 2,
    });

    expect(decoded.schemaVersion).toBe(supportedSpatialDemandIndexSchema);
    expect(decoded.stats).toEqual({
      nodeCount: 3,
      leafCount: 2,
      occurrenceCount: 2,
      chunkReferenceCount: 2,
      maxDepth: 1,
      leafCapacity: 1,
    });
    expect(decoded.bounds[3]).toBe(10_000_000.125_25);
    expect([...decoded.occurrenceNodeIndexes]).toEqual([3, 7]);
    expect([...decoded.occurrenceTargetChunkIndexes]).toEqual([0, 1]);
  });

  it("rejects truncation and declared allocation limits before exposing arrays", () => {
    const bytes = validIndex();
    expect(() =>
      decodeSpatialDemandIndex(bytes.subarray(0, bytes.byteLength - 1), {
        gltfNodeCount: 8,
        targetChunkCount: 2,
      }),
    ).toThrow(SpatialDemandIndexError);
    expect(() =>
      decodeSpatialDemandIndex(bytes, {
        gltfNodeCount: 8,
        targetChunkCount: 2,
        maximumNodeCount: 2,
      }),
    ).toThrow(/configured node limit/u);
  });

  it("rejects invalid glTF/chunk references and inconsistent leaf ownership", () => {
    const badNode = validIndex();
    new DataView(badNode.buffer).setUint32(64 + 3 * 72, 8, true);
    expect(() =>
      decodeSpatialDemandIndex(badNode, { gltfNodeCount: 8, targetChunkCount: 2 }),
    ).toThrow(/missing glTF node 8/u);

    const badChunk = validIndex();
    const view = new DataView(badChunk.buffer);
    view.setUint32(64 + 3 * 72 + 2 * 8 + 4, 0, true);
    expect(() =>
      decodeSpatialDemandIndex(badChunk, { gltfNodeCount: 8, targetChunkCount: 2 }),
    ).toThrow(/without an occurrence|omits an occurrence chunk/u);
  });
});
