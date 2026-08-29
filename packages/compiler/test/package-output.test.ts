import { createHash } from "node:crypto";
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
  it("writes the streamed document exactly as the build report declares it", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-streamed-package-"));
    const outputDirectory = join(temporaryDirectory, "compiled");
    try {
      const compiled = compileSceneToGltf(createRepeatedTriangleScene(), {
        coarseBounds: true,
      });

      await writeCompiledPackage(compiled, outputDirectory);

      const written = await readFile(join(outputDirectory, "scene.gltf"));
      const declared = compiled.report.output.resources.find(
        (resource) => resource.path === "scene.gltf",
      );
      // The report is written before the file is, so a drift between the two
      // would ship a package whose own digest disagrees with its contents.
      expect(declared?.bytes).toBe(written.byteLength);
      expect(declared?.sha256).toBe(createHash("sha256").update(written).digest("hex"));
      expect(written.toString("utf8")).toBe(compiled.json.text());
      expect(JSON.parse(written.toString("utf8"))).toEqual(compiled.document);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("delivers the file's bytes as ordered chunks", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-chunked-package-"));
    const outputDirectory = join(temporaryDirectory, "compiled");
    try {
      const compiled = compileSceneToGltf(createRepeatedTriangleScene(), {
        coarseBounds: true,
      });
      const chunks: Uint8Array[] = [];
      compiled.json.write((chunk) => chunks.push(Uint8Array.from(chunk)));

      await writeCompiledPackage(compiled, outputDirectory);

      const written = await readFile(join(outputDirectory, "scene.gltf"));
      // The packager appends chunks in the order the writer hands them over, so
      // this is what guarantees a streamed file is the document and not a
      // permutation of its pieces.
      expect(Buffer.concat(chunks)).toEqual(written);
      expect(chunks.every((chunk) => chunk.byteLength > 0)).toBe(true);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
