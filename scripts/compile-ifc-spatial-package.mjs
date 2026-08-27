/**
 * Compiles one spatially indexed glTF package from a retained split Scene IR.
 *
 * `record-spatial-ifc-packing-evidence.mjs` compiles every payload order in a
 * single process, which a federation the size of sixty5 cannot afford: one
 * compile alone peaks near 3 GB. This helper compiles exactly one order per
 * process so a memory-bounded host can still reproduce the packages the
 * localized-trace records were recorded against. It mirrors the options
 * `ifc-federation.ts` uses, plus the ADR-0008 spatial index.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getHeapStatistics } from "node:v8";

import { compileSceneToGltf, writeCompiledPackage } from "../packages/compiler/dist/index.js";
import { hydrateIfcSceneSplit } from "../packages/compiler/dist/ifc-scene.js";
import { readIfcStructure } from "../packages/compiler/dist/ifc-structure-stream.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const insideRepository = (value, label) => {
  if (!value) throw new TypeError(`${label} is required.`);
  const path = resolve(repositoryRoot, value);
  const fromRoot = relative(repositoryRoot, path);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new TypeError(`${label} must remain inside the repository.`);
  }
  return path;
};

const inputDirectory = insideRepository(argument("--input"), "--input");
const outputDirectory = insideRepository(argument("--output"), "--output");
const payloadOrder = argument("--payload-order", "compatibility");
if (payloadOrder !== "compatibility" && payloadOrder !== "spatial-leaf-anchor") {
  throw new TypeError("--payload-order must be compatibility or spatial-leaf-anchor.");
}
const targetChunkByteBudget = Number(argument("--target-chunk-bytes", String(512 * 1024)));
if (!Number.isSafeInteger(targetChunkByteBudget) || targetChunkByteBudget < 4) {
  throw new TypeError("--target-chunk-bytes must be an integer of at least four bytes.");
}
const leafCapacity = Number(argument("--leaf-capacity", "64"));
if (!Number.isSafeInteger(leafCapacity) || leafCapacity < 1 || leafCapacity > 65_535) {
  throw new TypeError("--leaf-capacity must be an integer from 1 through 65535.");
}

const startedAt = performance.now();
const seconds = (from) => ((performance.now() - from) / 1000).toFixed(1);
// The structure document is hundreds of megabytes, so it is read as a stream.
const [structure, geometry, properties] = await Promise.all([
  readIfcStructure(resolve(inputDirectory, "scene-ir.json")),
  readFile(resolve(inputDirectory, "scene-ir-geometry.bin")),
  readFile(resolve(inputDirectory, "scene-ir-properties.bin")),
]);
console.log(
  `[spatial-package] ${payloadOrder}: structure ${structure.byteLength} B ` +
    `${structure.sha256.slice(0, 8)}, geometry ${geometry.byteLength} B, ` +
    `properties ${properties.byteLength} B (${seconds(startedAt)} s)`,
);

const compiledAt = performance.now();
const result = compileSceneToGltf(hydrateIfcSceneSplit(structure.value, geometry, properties), {
  coarseBounds: true,
  generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
  propertyColumns: properties,
  targetChunkByteBudget,
  spatialIndex: true,
  spatialLeafCapacity: leafCapacity,
  ...(payloadOrder === "spatial-leaf-anchor" ? { spatialPayloadOrder: true } : {}),
});
console.log(
  `[spatial-package] ${payloadOrder}: compiled in ${seconds(compiledAt)} s, ` +
    `${result.report.counts.targetChunkCount} chunks, ` +
    `spatial.bin ${result.spatialBinary.byteLength} B, ` +
    `digest ${result.report.output.packageDigest.slice(0, 12)}`,
);

await writeCompiledPackage(result, outputDirectory);
console.log(
  `[spatial-package] ${payloadOrder}: wrote ${outputDirectory} in ${seconds(startedAt)} s, ` +
    `peak heap ${getHeapStatistics().peak_malloced_memory} B, rss ${process.memoryUsage().rss} B`,
);
