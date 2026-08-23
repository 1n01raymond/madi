import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileStepFile } from "../src/step-compiler.js";

const sceneTemplatePath = fileURLToPath(
  new URL("../../../artifacts/occt/repeated-fasteners.scene.json", import.meta.url),
);

describe("direct STEP compiler orchestration", () => {
  it("passes a local AP242 file through an adapter and writes a validated package", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "madi-step-test-"));
    try {
      const sourcePath = join(temporaryDirectory, "assembly.step");
      const adapterPath = join(temporaryDirectory, "fake-adapter.mjs");
      const outputDirectory = join(temporaryDirectory, "compiled");
      await writeFile(
        sourcePath,
        "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
        "utf8",
      );
      await writeFile(
        adapterPath,
        `import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const sourcePath = args[0];
const option = (name) => args[args.indexOf(name) + 1];
const source = await readFile(sourcePath);
const digest = createHash("sha256").update(source).digest("hex");
const scene = JSON.parse(await readFile(${JSON.stringify(sceneTemplatePath)}, "utf8"));
scene.revision.sourceDigest = "sha256:" + digest;
scene.documents = scene.documents.map((document) => ({
  ...document,
  uriHint: option("--uri-hint"),
  displayName: basename(sourcePath),
  formatVersion: "AP242",
  sourceDigest: "sha256:" + digest,
}));
await writeFile(option("--scene"), JSON.stringify(scene));
await writeFile(option("--report"), JSON.stringify({
  schemaVersion: "test-adapter.1",
  source: {
    path: option("--uri-hint"),
    sha256: digest,
    format: "STEP AP242",
    schemaIdentifiers: ["AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF"],
  },
}));
`,
        "utf8",
      );

      const result = await compileStepFile({
        sourcePath,
        outputDirectory,
        pythonExecutable: process.execPath,
        adapterScriptPath: adapterPath,
      });

      expect(result.source.schema).toBe("AP242");
      expect(result.report.counts).toMatchObject({
        compiledPrototypeCount: 3,
        renderableOccurrenceCount: 10,
        triangleCount: 2076,
        edgeSegmentCount: 181,
      });
      const [gltf, binary, buildReport, adapterReport] = await Promise.all([
        readFile(join(outputDirectory, "scene.gltf"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "scene.bin")),
        readFile(join(outputDirectory, "build-report.json"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "adapter-report.json"), "utf8").then(JSON.parse),
      ]);
      expect(gltf.buffers).toEqual([{ uri: "scene.bin", byteLength: binary.byteLength }]);
      expect(buildReport.source.sourceDigest).toBe(`sha256:${result.source.sha256}`);
      expect(adapterReport.source).toMatchObject({
        path: "assembly.step",
        sha256: result.source.sha256,
        format: "STEP AP242",
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an adapter result that does not belong to the selected STEP file", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "madi-step-mismatch-test-"));
    try {
      const sourcePath = join(temporaryDirectory, "assembly.step");
      const adapterPath = join(temporaryDirectory, "mismatched-adapter.mjs");
      const outputDirectory = join(temporaryDirectory, "compiled");
      await writeFile(
        sourcePath,
        "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
        "utf8",
      );
      await writeFile(
        adapterPath,
        `import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
await writeFile(option("--scene"), "{}");
await writeFile(option("--report"), JSON.stringify({
  source: { sha256: "0".repeat(64), format: "STEP AP242" },
}));
`,
        "utf8",
      );

      await expect(
        compileStepFile({
          sourcePath,
          outputDirectory,
          pythonExecutable: process.execPath,
          adapterScriptPath: adapterPath,
        }),
      ).rejects.toThrow(/source digest does not match/u);
      await expect(readFile(join(outputDirectory, "scene.gltf"))).rejects.toThrow();
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
