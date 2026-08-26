import { createHash } from "node:crypto";

import { encodeSpatialDemandIndex } from "../../../packages/compiler/src/spatial-demand.js";
import type { CompiledHierarchy } from "@naru3d/runtime-webgpu";
import { describe, expect, it } from "vitest";

import { loadSpatialDemandIndex } from "../src/spatial-demand-source.js";

const hierarchy = {
  nodeCount: 2,
  renderableOccurrences: 1,
  targetChunks: [{ id: "chunk" }],
} as CompiledHierarchy;

function source() {
  const bytes = encodeSpatialDemandIndex([
    {
      id: "occurrence",
      nodeIndex: 1,
      targetChunkIndex: 0,
      minimum: [10_000_000.000_25, 0, 0],
      maximum: [10_000_000.125_25, 1, 1],
    },
  ]).bytes;
  return {
    bytes,
    source: {
      kind: "file" as const,
      ref: {
        schemaVersion: "naru.spatial-demand-index.1" as const,
        uri: "spatial.bin",
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      file: new File([bytes], "spatial.bin"),
    },
  };
}

describe("spatial demand source", () => {
  it("authenticates and opens a local sidecar against its hierarchy", async () => {
    const fixture = source();
    const decoded = await loadSpatialDemandIndex(fixture.source, hierarchy);

    expect(decoded.stats.occurrenceCount).toBe(1);
    expect(decoded.bounds[0]).toBe(10_000_000.000_25);
  });

  it("rejects byte-length and digest mismatches before decoding", async () => {
    const fixture = source();
    await expect(
      loadSpatialDemandIndex(
        {
          ...fixture.source,
          ref: { ...fixture.source.ref, byteLength: fixture.bytes.byteLength + 1 },
        },
        hierarchy,
      ),
    ).rejects.toThrow(/must be/u);
    await expect(
      loadSpatialDemandIndex(
        {
          ...fixture.source,
          ref: { ...fixture.source.ref, sha256: "0".repeat(64) },
        },
        hierarchy,
      ),
    ).rejects.toThrow(/digest mismatch/u);
  });
});
