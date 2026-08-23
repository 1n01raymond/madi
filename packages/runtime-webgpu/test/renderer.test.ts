import { describe, expect, it } from "vitest";

import { normalizeSectionPlane } from "../src/index.js";

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
});
