import { describe, expect, it } from "vitest";

import { validateGpuScene } from "@madi/runtime-webgpu";

import { createIndustrialWorkload, industrialScaleTiers } from "../src/workload.js";

describe("industrial benchmark workload", () => {
  it.each(Object.entries(industrialScaleTiers))(
    "builds the deterministic %s tier",
    (scale, occurrenceCount) => {
      const workload = createIndustrialWorkload(scale as keyof typeof industrialScaleTiers);
      expect(() => validateGpuScene(workload.scene)).not.toThrow();
      expect(workload.stats.occurrenceCount).toBe(occurrenceCount);
      expect(workload.scene.batches).toHaveLength(4);
      expect(workload.scene.batches.flatMap(({ instances }) => instances)).toHaveLength(
        occurrenceCount,
      );
      expect(workload.stats.instanceBytes).toBe(occurrenceCount * 96);
    },
  );

  it("reaches the public 100k occurrence and 10M submitted-triangle target", () => {
    const workload = createIndustrialWorkload("target");
    expect(workload.stats.occurrenceCount).toBe(100_000);
    expect(workload.stats.submittedTriangleCount).toBeGreaterThanOrEqual(10_000_000);
  });
});
