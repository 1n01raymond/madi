import { describe, expect, it } from "vitest";

import { OrthographicOrbitCamera, createCompiledSceneCamera } from "../src/view.js";

const bounds = { min: [-0.048, 0, -0.028], max: [0.048, 0.022, 0.028] } as const;

describe("compiled scene camera", () => {
  it("fits finite Y-up metre bounds", () => {
    const camera = createCompiledSceneCamera(bounds, 16 / 9);

    expect(camera).toHaveLength(16);
    expect(Array.from(camera).every(Number.isFinite)).toBe(true);
  });

  it("changes the matrix for orbit, pan, and zoom and restores fit", () => {
    const camera = new OrthographicOrbitCamera(bounds);
    const initial = Array.from(camera.viewProjection(16 / 9));

    camera.orbit(40, -20);
    expect(Array.from(camera.viewProjection(16 / 9))).not.toEqual(initial);
    camera.reset();
    expect(Array.from(camera.viewProjection(16 / 9))).toEqual(initial);

    camera.pan(50, -25, 1_000, 500, 2);
    expect(Array.from(camera.viewProjection(2))).not.toEqual(
      Array.from(createCompiledSceneCamera(bounds, 2)),
    );
    camera.fit();
    expect(Array.from(camera.viewProjection(2))).toEqual(
      Array.from(createCompiledSceneCamera(bounds, 2)),
    );

    camera.zoomBy(-120);
    expect(camera.viewProjection(2)[0]).toBeGreaterThan(createCompiledSceneCamera(bounds, 2)[0]);
  });

  it("rejects invalid scene bounds", () => {
    expect(
      () => new OrthographicOrbitCamera({ min: [1, 0, 0], max: [0, 1, 1] }),
    ).toThrow(/ordered finite values/u);
  });
});
