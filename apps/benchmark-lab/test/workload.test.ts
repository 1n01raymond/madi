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

  it.each(["gate", "target"] as const)(
    "builds the %s heterogeneous workload with 256 prototypes",
    (scale) => {
      const workload = createIndustrialWorkload(scale, "heterogeneous");
      expect(() => validateGpuScene(workload.scene)).not.toThrow();
      expect(workload.stats.prototypeCount).toBe(256);
      expect(workload.stats.occurrenceCount).toBe(industrialScaleTiers[scale]);
      expect(workload.instanceBounds).toHaveLength(256);
      expect(
        workload.instanceBounds.reduce((count, bounds) => count + bounds.length / 4, 0),
      ).toBe(industrialScaleTiers[scale]);
      if (scale === "target") {
        expect(workload.stats.submittedTriangleCount).toBeGreaterThanOrEqual(10_000_000);
      }
    },
  );
});
