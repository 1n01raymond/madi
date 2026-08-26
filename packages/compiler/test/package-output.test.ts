import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRepeatedTriangleScene } from "@naru3d/scene-ir";
import { describe, expect, it } from "vitest";

import { compileSceneToGltf, writeCompiledPackage } from "../src/index.js";

describe("compiled package output", () => {
  it("writes the declared spatial demand resource byte for byte", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-spatial-package-"));
    const outputDirectory = join(temporaryDirectory, "compiled");
    try {
      const compiled = compileSceneToGltf(createRepeatedTriangleScene(), {
        coarseBounds: true,
        spatialIndex: true,
        spatialBinaryUri: "occurrence-spatial.bin",
      });

      await writeCompiledPackage(compiled, outputDirectory);

      expect(await readFile(join(outputDirectory, "occurrence-spatial.bin"))).toEqual(
        Buffer.from(compiled.spatialBinary as Uint8Array),
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
