import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  openPropertyValueColumns,
  parsePackageProperties,
  resolvePropertyEntries,
} from "@naru3d/scene-ir";
import { describe, expect, it, vi } from "vitest";

import { compileIfcFederation } from "../src/ifc-federation.js";

const sceneTemplatePath = fileURLToPath(
  new URL("../../../artifacts/occt/repeated-fasteners.scene.json", import.meta.url),
);

describe("IFC federation compiler orchestration", () => {
  it("validates adapter identity and writes a compiled package", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-ifc-test-"));
    try {
      const sourcePath = join(temporaryDirectory, "architecture.ifc");
      const adapterPath = join(temporaryDirectory, "fake-ifc-adapter.mjs");
      const outputDirectory = join(temporaryDirectory, "compiled");
      const cachedOutputDirectory = join(temporaryDirectory, "compiled-cached");
      const relabeledOutputDirectory = join(temporaryDirectory, "compiled-relabeled");
      const cacheDirectory = join(temporaryDirectory, "cache");
      const adapterCountPath = join(temporaryDirectory, "adapter-count.txt");
      await writeFile(adapterCountPath, "0", "utf8");
      await writeFile(
        sourcePath,
        "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
        "utf8",
      );
      await writeFile(
        adapterPath,
        `import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args.includes("--identity")) {
  console.log(JSON.stringify({
    schemaVersion: "naru.ifc-adapter-identity.1",
    name: "IfcOpenShell",
    version: "test",
    fingerprint: "2".repeat(64),
  }));
  process.exit(0);
}
const option = (name) => args[args.indexOf(name) + 1];
const adapterCount = Number(await readFile(${JSON.stringify(adapterCountPath)}, "utf8"));
await writeFile(${JSON.stringify(adapterCountPath)}, String(adapterCount + 1));
const documentCache = args.includes("--document-cache")
  ? option("--document-cache")
  : undefined;
if (documentCache) {
  await mkdir(documentCache, { recursive: true });
  await writeFile(documentCache + "/fake-marker", "document-cache-enabled");
}
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

// Mirrors split.3 property columns: distinct keys and key-sets interned into
// the scene-level propertyIndex, semantics keeping only set ids plus a row
// into the external binary value columns.
const keys = [...new Set(
  scene.semantics.flatMap((semantic) => Object.keys(semantic.properties.entries)),
)].sort();
const keyIndexes = new Map(keys.map((key, index) => [key, index]));
const sets = [];
const setIndexes = new Map();
const valueRows = [];
scene.semantics = scene.semantics.map((semantic, row) => {
  const sorted = Object.keys(semantic.properties.entries).sort();
  const tuple = sorted.map((key) => keyIndexes.get(key));
  const token = tuple.join(",");
  if (!setIndexes.has(token)) {
    setIndexes.set(token, sets.length);
    sets.push(tuple);
  }
  valueRows.push(sorted.map((key) => semantic.properties.entries[key]));
  return {
    ...semantic,
    properties: {
      schema: semantic.properties.schema,
      set: setIndexes.get(token),
      row,
    },
  };
});
scene.propertyIndex = { keys, sets };

// Canonical compact JSON with sorted keys, matching the Python encoder.
const canonical = (value) => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(
      (key) => JSON.stringify(key) + ":" + canonical(value[key]),
    ).join(",") + "}";
  }
  return JSON.stringify(value);
};
const encodedRows = valueRows.map((row) => row.map((value) => Buffer.from(canonical(value), "utf8")));
const distinct = [...new Map(
  encodedRows.flat().map((encoded) => [encoded.toString("binary"), encoded]),
).values()].sort(Buffer.compare);
const positions = new Map(distinct.map((encoded, index) => [encoded.toString("binary"), index]));
const rowRefs = [];
const rowOffsets = [0];
for (const row of encodedRows) {
  for (const encoded of row) rowRefs.push(positions.get(encoded.toString("binary")));
  rowOffsets.push(rowRefs.length);
}
const valueOffsets = [0];
for (const encoded of distinct) valueOffsets.push(valueOffsets.at(-1) + encoded.byteLength);
const propertyStreams = [];
let propertyLength = 0;
const appendProperty = (payload, encoding) => {
  while (propertyLength % 8) {
    propertyStreams.push(Buffer.alloc(1));
    propertyLength += 1;
  }
  const entry = { encoding, byteOffset: propertyLength, byteLength: payload.byteLength };
  propertyStreams.push(payload);
  propertyLength += payload.byteLength;
  return entry;
};
scene.propertyValues = {
  encoding: "madi.property-columns.1",
  valueCount: rowRefs.length,
  rowCount: encodedRows.length,
  distinctValueCount: distinct.length,
  rows: appendProperty(Buffer.from(Uint32Array.from(rowRefs).buffer), "u32le"),
  rowOffsets: appendProperty(Buffer.from(Uint32Array.from(rowOffsets).buffer), "u32le"),
  valueOffsets: appendProperty(Buffer.from(Uint32Array.from(valueOffsets).buffer), "u32le"),
  valueHeap: appendProperty(Buffer.concat(distinct), "utf8-json"),
};
const properties = Buffer.concat(propertyStreams);

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
await writeFile(option("--properties"), properties);
const identify = (bytes) => ({
  byteLength: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
await writeFile(option("--report"), JSON.stringify({
  schemaVersion: "naru.ifc-adapter-report.6",
  federation: { sourceDigest: federationDigest },
  sources: [{
    discipline,
    path: uriHint,
    byteLength: source.byteLength,
    sha256: sourceDigest,
    schema: "IFC4",
  }],
  documentArtifactCache: {
    schemaVersion: "naru.ifc-document-artifact.1",
    status: documentCache ? "enabled" : "disabled",
    hits: [],
    misses: documentCache ? [discipline] : [],
  },
  scene: {
    encodingVersion: "naru.ifc-scene-ir-split.4",
    structure: identify(structure),
    geometry: identify(geometry),
    properties: identify(properties),
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
        cacheDirectory,
        spatialIndex: true,
        spatialLeafCapacity: 2,
        spatialPayloadOrder: true,
        compactJson: true,
      });
      const cached = await compileIfcFederation({
        documents: [
          {
            discipline: "architecture",
            sourcePath,
            uriHint: "projects/digital_hub/arc.ifc",
          },
        ],
        outputDirectory: cachedOutputDirectory,
        pythonExecutable: process.execPath,
        adapterScriptPath: adapterPath,
        retainSceneIr: true,
        cacheDirectory,
        spatialIndex: true,
        spatialLeafCapacity: 2,
        spatialPayloadOrder: true,
        compactJson: true,
      });

      expect(result.sources[0]).toMatchObject({
        discipline: "architecture",
        schema: "IFC4",
        uriHint: "projects/digital_hub/arc.ifc",
      });
      expect(result.adapterReport).toMatchObject({
        documentArtifactCache: {
          status: "enabled",
          misses: ["architecture"],
        },
        sceneIrValidation: { ok: true, errorCount: 0, warningCount: 0 },
      });
      expect(result.cache).toMatchObject({ status: "miss" });
      expect(cached.cache).toEqual({ status: "hit", key: result.cache.key });
      expect(cached.report.output.packageDigest).toBe(result.report.output.packageDigest);
      expect(await readFile(adapterCountPath, "utf8")).toBe("1");
      await expect(
        readFile(join(cacheDirectory, "ifc-documents", "fake-marker"), "utf8"),
      ).resolves.toBe("document-cache-enabled");
      await expect(readFile(join(cachedOutputDirectory, "scene-ir.json"))).resolves.toEqual(
        await readFile(join(outputDirectory, "scene-ir.json")),
      );
      const relabeled = await compileIfcFederation({
        documents: [
          {
            discipline: "architecture",
            sourcePath,
            uriHint: "projects/digital_hub/architecture-renamed.ifc",
          },
        ],
        outputDirectory: relabeledOutputDirectory,
        pythonExecutable: process.execPath,
        adapterScriptPath: adapterPath,
        retainSceneIr: true,
        cacheDirectory,
        spatialIndex: true,
        spatialLeafCapacity: 2,
        spatialPayloadOrder: true,
        compactJson: true,
      });
      expect(relabeled.cache.status).toBe("miss");
      expect(relabeled.cache.key).not.toBe(result.cache.key);
      expect(await readFile(adapterCountPath, "utf8")).toBe("2");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await writeFile(
          join(cacheDirectory, String(result.cache.key), "scene.gltf"),
          "corrupted",
          "utf8",
        );
        const recovered = await compileIfcFederation({
          documents: [
            {
              discipline: "architecture",
              sourcePath,
              uriHint: "projects/digital_hub/arc.ifc",
            },
          ],
          outputDirectory: join(temporaryDirectory, "compiled-recovered"),
          pythonExecutable: process.execPath,
          adapterScriptPath: adapterPath,
          retainSceneIr: true,
          cacheDirectory,
          spatialIndex: true,
          spatialLeafCapacity: 2,
          spatialPayloadOrder: true,
          compactJson: true,
        });
        expect(recovered.cache).toEqual({ status: "miss", key: result.cache.key });
        expect(recovered.report.output.packageDigest).toBe(
          result.report.output.packageDigest,
        );
        expect(await readFile(adapterCountPath, "utf8")).toBe("3");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("cache restore failed"),
        );
      } finally {
        warnSpy.mockRestore();
      }
      expect(result.report.counts).toMatchObject({
        compiledPrototypeCount: 3,
        renderableOccurrenceCount: 10,
        triangleCount: 2076,
      });
      const [
        gltf,
        retainedScene,
        retainedGeometry,
        retainedProperties,
        adapterReport,
        packageProperties,
        packageColumns,
        spatialIndex,
        dependencyIndex,
      ] = await Promise.all([
        readFile(join(outputDirectory, "scene.gltf"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "scene-ir.json"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "scene-ir-geometry.bin")),
        readFile(join(outputDirectory, "scene-ir-properties.bin")),
        readFile(join(outputDirectory, "adapter-report.json"), "utf8").then(JSON.parse),
        readFile(join(outputDirectory, "properties.json"), "utf8"),
        readFile(join(outputDirectory, "properties.bin")),
        readFile(join(outputDirectory, "spatial.bin")),
        readFile(join(outputDirectory, "incremental-dependencies.json"), "utf8").then(
          JSON.parse,
        ),
      ]);
      expect(gltf.asset.generator).toContain("IfcOpenShell federation slice");
      expect(gltf.extras.madi.progressive.spatialIndex).toMatchObject({
        schemaVersion: "naru.spatial-demand-index.1",
        byteLength: spatialIndex.byteLength,
      });
      expect(gltf.extras.madi.progressive.targetPayloadOrder).toBe(
        "spatial-leaf-anchor-v1",
      );
      expect(result.report.options.targetPayloadOrder).toBe("spatial-leaf-anchor-v1");
      expect(result.report.options.jsonFormatting).toBe("compact");
      expect(dependencyIndex).toEqual(result.dependencyIndex);
      expect(cached.dependencyIndex).toEqual(result.dependencyIndex);
      expect(dependencyIndex).toMatchObject({
        schemaVersion: "naru.ifc-incremental-dependency-index.1",
        scene: { packageDigest: result.report.output.packageDigest },
        documents: [
          {
            discipline: "architecture",
            sourceDigest: `sha256:${result.sources[0]?.sha256}`,
            uriHint: "projects/digital_hub/arc.ifc",
          },
        ],
      });
      expect(dependencyIndex.documents[0].prototypeIds).toHaveLength(
        result.report.counts.prototypeCount,
      );
      expect(dependencyIndex.documents[0].targetChunkIds).toHaveLength(
        result.report.counts.targetChunkCount,
      );
      expect(dependencyIndex.documents[0].semanticIds).toHaveLength(
        retainedScene.semantics.length,
      );
      // The package carries the property sidecar: a pointer in the glTF
      // extras, the parsed document, and the adapter column file verbatim.
      expect(gltf.extras.madi.properties).toMatchObject({
        schemaVersion: "madi.package-properties.1",
        uri: "properties.json",
        byteLength: Buffer.byteLength(packageProperties, "utf8"),
      });
      expect(packageColumns.equals(retainedProperties)).toBe(true);
      const sidecar = parsePackageProperties(JSON.parse(packageProperties));
      const sidecarReader = openPropertyValueColumns(sidecar.propertyValues, packageColumns);
      const sidecarIndex = sidecar.semanticIds.indexOf(retainedScene.semantics[0].id);
      expect(sidecarIndex).toBeGreaterThanOrEqual(0);
      expect(
        resolvePropertyEntries(
          {
            set: sidecar.semanticSets[sidecarIndex] as number,
            row: sidecar.semanticRows[sidecarIndex] as number,
          },
          sidecar.propertyIndex,
          sidecarReader,
        ),
      ).toEqual(
        JSON.parse(await readFile(sceneTemplatePath, "utf8")).semantics[0].properties.entries,
      );
      expect(retainedScene.documents[0].format).toBe("IFC");
      expect(adapterReport.sceneIrValidation.ok).toBe(true);
      // The retained structure keeps column properties plus the scene tables;
      // the values themselves live only in the retained column file.
      expect(retainedScene.propertyIndex.keys.length).toBeGreaterThan(0);
      expect(retainedScene.semantics[0].properties.set).toBeTypeOf("number");
      expect(retainedScene.semantics[0].properties.row).toBeTypeOf("number");
      expect(retainedScene.semantics[0].properties.entries).toBeUndefined();
      expect(retainedScene.semantics[0].properties.values).toBeUndefined();
      const columns = openPropertyValueColumns(
        retainedScene.propertyValues,
        retainedProperties,
      );
      expect(columns.rowCount).toBe(retainedScene.semantics.length);
      const template = JSON.parse(await readFile(sceneTemplatePath, "utf8"));
      expect(
        resolvePropertyEntries(
          retainedScene.semantics[0].properties,
          retainedScene.propertyIndex,
          columns,
        ),
      ).toEqual(template.semantics[0].properties.entries);
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
