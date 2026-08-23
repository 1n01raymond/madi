import { describe, expect, it } from "vitest";

import { createBenchmarkCamera } from "../src/camera.js";
import { DenseFrustumCuller, extractWebGpuFrustumPlanes } from "../src/culling.js";
import { createIndustrialWorkload } from "../src/workload.js";

describe("dense frustum culling", () => {
  it("extracts WebGPU clip planes without replacing caller storage", () => {
    const target = new Float32Array(24);
    expect(extractWebGpuFrustumPlanes(new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]), target)).toBe(target);
    expect([...target]).toEqual([
      1, 0, 0, 1,
      -1, 0, 0, 1,
      0, 1, 0, 1,
      0, -1, 0, 1,
      0, 0, 1, 0,
      0, 0, -1, 1,
    ]);
  });

  it("reuses dense tables and culls a local-review trace deterministically", () => {
    const workload = createIndustrialWorkload("gate", "heterogeneous");
    const camera = createBenchmarkCamera(workload.bounds, 1.5, 0.125, "local-review");
    const culler = new DenseFrustumCuller(workload);
    const first = culler.cull(camera.viewProjection);
    const visible = first.visibleOccurrences;
    const second = culler.cull(camera.viewProjection);
    expect(second).toBe(first);
    expect(second.indicesByBatch).toBe(first.indicesByBatch);
    expect(second.visibleOccurrences).toBe(visible);
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(workload.stats.occurrenceCount * 0.75);
  });
});
