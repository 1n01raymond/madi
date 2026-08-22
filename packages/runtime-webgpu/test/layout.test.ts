import { describe, expect, it } from "vitest";

import {
  decodeObjectId,
  instanceStride,
  packInstanceData,
  validatePrototypeBatch,
} from "../src/index.js";
import type { GpuPrototypeBatch } from "../src/index.js";

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function createBatch(): GpuPrototypeBatch {
  return {
    surfaceVertices: new Float32Array([
      0, 0, 0, 0, 0, 1,
      1, 0, 0, 0, 0, 1,
      0, 1, 0, 0, 0, 1,
    ]),
    surfaceIndices: new Uint32Array([0, 1, 2]),
    edgeVertices: new Float32Array([0, 0, 0, 1, 0, 0]),
    instances: [
      { transform: identity, objectId: 0x0403_0201 },
      { transform: identity, objectId: 9 },
    ],
  };
}

describe("WebGPU packed layouts", () => {
  it("packs transforms once per occurrence with a uint32 object ID", () => {
    const packed = packInstanceData(createBatch().instances);
    const view = new DataView(packed);

    expect(packed.byteLength).toBe(instanceStride * 2);
    expect(view.getFloat32(0, true)).toBe(1);
    expect(view.getUint32(64, true)).toBe(0x0403_0201);
    expect(view.getUint32(instanceStride + 64, true)).toBe(9);
  });

  it("decodes the picking color without signed overflow", () => {
    expect(decodeObjectId([1, 2, 3, 4])).toBe(0x0403_0201);
    expect(decodeObjectId([255, 255, 255, 255])).toBe(0xffff_ffff);
  });

  it("rejects duplicate occurrence IDs", () => {
    const batch = createBatch();
    expect(() =>
      validatePrototypeBatch({
        ...batch,
        instances: [
          { transform: identity, objectId: 7 },
          { transform: identity, objectId: 7 },
        ],
      }),
    ).toThrow(/Duplicate occurrence object ID/u);
  });
});
