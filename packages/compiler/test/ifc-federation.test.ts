import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileIfcFederation } from "../src/ifc-federation.js";

const sceneTemplatePath = fileURLToPath(
  new URL("../../../artifacts/occt/repeated-fasteners.scene.json", import.meta.url),
);

describe("IFC federation compiler orchestration", () => {
  it("validates adapter identity and writes a compiled package", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "madi-ifc-test-"));
    try {
      const sourcePath = join(temporaryDirectory, "architecture.ifc");
      const adapterPath = join(temporaryDirectory, "fake-ifc-adapter.mjs");
      const outputDirectory = join(temporaryDirectory, "compiled");
      await writeFile(
        sourcePath,
        "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
        "utf8",
      );
      await writeFile(
        adapterPath,
        `import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const documentArgument = option("--document");
const uriArgument = option("--uri-hint");
const discipline = documentArgument.slice(0, documentArgument.indexOf("="));
const sourcePath = documentArgument.slice(documentArgument.indexOf("=") + 1);
const uriHint = uriArgument.slice(uriArgument.indexOf("=") + 1);
const source = await readFile(sourcePath);
const sourceDigest = createHash("sha256").update(source).digest("hex");
const federationDigest = "a".repeat(64);
const scene = JSON.parse(await readFile(${JSON.stringify(sceneTemplatePath)}, "utf8"));
scene.revision.sourceDigest = "sha256:" + federationDigest;
scene.revision.adapter = { name: "IfcOpenShell", version: "test" };
scene.documents = scene.documents.map((document) => ({
  ...document,
  uriHint,
  displayName: "architecture.ifc",
  format: "IFC",
  formatVersion: "IFC4",
  sourceDigest: "sha256:" + sourceDigest,
}));

// Mirrors split.2 property indexing: distinct keys and key-sets interned into
// the scene-level propertyIndex, semantics keeping only set ids plus values.
const keys = [...new Set(
  scene.semantics.flatMap((semantic) => Object.keys(semantic.properties.entries)),
)].sort();
const keyIndexes = new Map(keys.map((key, index) => [key, index]));
const sets = [];
const setIndexes = new Map();
scene.semantics = scene.semantics.map((semantic) => {
  const sorted = Object.keys(semantic.properties.entries).sort();
  const tuple = sorted.map((key) => keyIndexes.get(key));
  const token = tuple.join(",");
  if (!setIndexes.has(token)) {
    setIndexes.set(token, sets.length);
    sets.push(tuple);
  }
  return {
    ...semantic,
    properties: {
      schema: semantic.properties.schema,
      set: setIndexes.get(token),
      values: sorted.map((key) => semantic.properties.entries[key]),
    },
  };
});
scene.propertyIndex = { keys, sets };

// Mirrors the adapter transport: surface-only representations whose streams
// are little-endian references into one concatenated geometry file.
const streams = [];
let geometryLength = 0;
const append = (values, Ctor, encoding) => {
  while (geometryLength % 8) {
    streams.push(Buffer.alloc(1));
    geometryLength += 1;
  }
  const payload = Buffer.from(Ctor.from(values).buffer);
  const entry = { encoding, byteOffset: geometryLength, byteLength: payload.byteLength };
  streams.push(payload);
  geometryLength += payload.byteLength;
  return entry;
};
scene.representations = scene.representations.map((representation) => {
  const { edges, ...rest } = representation;
  const { faceSourceIds, uvs, colorIds, ...surface } = representation.surface;
  return {
    ...rest,
    surface: {
      ...surface,
      positions: append(surface.positions, Float64Array, "f64le"),
      indices: append(surface.indices, Uint32Array, "u32le"),
      normals: append(surface.normals, Float32Array, "f32le"),
    },
  };
});
const structure = Buffer.from(JSON.stringify(scene) + "\\n", "utf8");
const geometry = Buffer.concat(streams);
await writeFile(option("--scene"), structure);
await writeFile(option("--geometry"), geometry);
const identify = (bytes) => ({
  byteLength: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
await writeFile(option("--report"), JSON.stringify({
  schemaVersion: "madi.ifc-adapter-report.3",
  federation: { sourceDigest: federationDigest },
  sources: [{
    discipline,
    path: uriHint,
    byteLength: source.byteLength,
    sha256: sourceDigest,
    schema: "IFC4",
  }],
  scene: {
    encodingVersion: "madi.ifc-scene-ir-split.2",
    structure: identify(structure),
    geometry: identify(geometry),
  },
}));
`,
        "utf8",
      );

      const result = await compileIfcFederation({
        documents: [
          {
            discipline: "architecture",
            sourcePath,
            uriHint: "projects/digital_hub/arc.ifc",
          },
        ],
        outputDirectory,
        pythonExecutable: process.execPath,
        adapterScriptPath: adapterPath,
        retainSceneIr: true,
      });

      expect(result.sources[0]).toMatchObject({
        discipline: "architecture",
        schema: "IFC4",
        uriHint: "projects/digital_hub/arc.ifc",
      });
      expect(result.adapterReport).toMatchObject({
        sceneIrValidation: { ok: true, errorCount: 0, warningCount: 0 },
      });
      expect(result.report.counts).toMatchObject({
        compiledPrototypeCount: 3,
        renderableOccurrenceCount: 10,
        triangleCount: 2076,
      });
      const [gltf, retainedScene, retainedGeometry, adapterReport] = await Promise.all([
        readFile(join(outputDirectory, "scene.gltf"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "scene-ir.json"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "scene-ir-geometry.bin")),
        readFile(join(outputDirectory, "adapter-report.json"), "utf8").then(JSON.parse),
      ]);
      expect(gltf.asset.generator).toContain("IfcOpenShell federation slice");
      expect(retainedScene.documents[0].format).toBe("IFC");
      expect(adapterReport.sceneIrValidation.ok).toBe(true);
      // The retained structure keeps indexed properties plus the scene table.
      expect(retainedScene.propertyIndex.keys.length).toBeGreaterThan(0);
      expect(retainedScene.semantics[0].properties.set).toBeTypeOf("number");
      expect(retainedScene.semantics[0].properties.entries).toBeUndefined();
      // The retained structure keeps references, not expanded coordinate arrays.
      expect(retainedScene.representations[0].surface.positions).toMatchObject({
        encoding: "f64le",
        byteOffset: 0,
      });
      expect(retainedGeometry.byteLength).toBeGreaterThan(
        retainedScene.representations[0].surface.positions.byteLength,
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate discipline identities before starting the adapter", async () => {
    await expect(
      compileIfcFederation({
        documents: [
          { discipline: "architecture", sourcePath: "missing-a.ifc" },
          { discipline: "architecture", sourcePath: "missing-b.ifc" },
        ],
        outputDirectory: "unused",
      }),
    ).rejects.toThrow(/Duplicate IFC discipline/u);
  });
});
