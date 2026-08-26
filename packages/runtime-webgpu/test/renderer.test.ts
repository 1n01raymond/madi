import { describe, expect, it } from "vitest";

import { normalizeSectionPlane, rebaseSectionPlane } from "../src/index.js";

describe("WebGPU section plane", () => {
  it("normalizes the plane equation without changing its half-space", () => {
    expect(normalizeSectionPlane({ normal: [0, 0, 4], offset: 12 })).toEqual({
      normal: [0, 0, 1],
      offset: 3,
    });
  });

  it("rejects non-finite and zero-length planes", () => {
    expect(() => normalizeSectionPlane({ normal: [0, 0, 0], offset: 1 })).toThrow(
      /must be non-zero/u,
    );
    expect(() => normalizeSectionPlane({ normal: [1, 0, 0], offset: Number.NaN })).toThrow(
      /must be finite/u,
    );
  });

  it("rebases world-space clipping around a large camera origin", () => {
    const world = normalizeSectionPlane({
      normal: [1, 0, 0],
      offset: 10_000_000.000_25,
    });
    expect(rebaseSectionPlane(world, [10_000_000, -7_000_000, 3_000_000])).toEqual({
      normal: [1, 0, 0],
      offset: 0.000_250_000_506_639_480_6,
    });
  });
});
