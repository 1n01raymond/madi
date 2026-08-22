import { describe, expect, it } from "vitest";

import { createCompiledSceneCamera } from "../src/view.js";

describe("compiled scene camera", () => {
  it("fits finite Y-up metre bounds", () => {
    const camera = createCompiledSceneCamera(
      { min: [-0.048, 0, -0.028], max: [0.048, 0.022, 0.028] },
      16 / 9,
    );

    expect(camera).toHaveLength(16);
    expect(Array.from(camera).every(Number.isFinite)).toBe(true);
  });
});
