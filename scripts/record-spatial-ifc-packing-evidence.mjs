import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";

import {
  compileSceneToGltf,
  writeCompiledPackage,
} from "../packages/compiler/dist/index.js";
import { hydrateIfcSceneSplit } from "../packages/compiler/dist/ifc-scene.js";
import { readIfcStructure } from "../packages/compiler/dist/ifc-structure-stream.js";
import { decodeSpatialDemandIndex } from "../packages/runtime-webgpu/dist/index.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const insideRepository = (value, label) => {
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

const inputDirectory = insideRepository(
  argument("--input", "output/ifc/digital-hub-spatial-packed"),
  "Input directory",
);
const outputDirectory = insideRepository(
  argument("--output", "output/ifc/digital-hub-spatial-analysis"),
  "Output directory",
);
const targetChunkByteBudget = Number(argument("--target-chunk-bytes", String(512 * 1024)));
if (!Number.isSafeInteger(targetChunkByteBudget) || targetChunkByteBudget < 4) {
  throw new TypeError("--target-chunk-bytes must be an integer of at least four bytes.");
}
const leafCapacity = Number(argument("--leaf-capacity", "64"));
if (!Number.isSafeInteger(leafCapacity) || leafCapacity < 1 || leafCapacity > 65_535) {
  throw new TypeError("--leaf-capacity must be an integer from 1 through 65535.");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const percentile = (values, fraction) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
};
const distribution = (values) => ({
  minimum: Math.min(...values),
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  maximum: Math.max(...values),
  mean: values.reduce((total, value) => total + value, 0) / values.length,
});

const [structure, geometry, properties] = await Promise.all([
  readIfcStructure(resolve(inputDirectory, "scene-ir.json")),
  readFile(resolve(inputDirectory, "scene-ir-geometry.bin")),
  readFile(resolve(inputDirectory, "scene-ir-properties.bin")),
]);
const scene = hydrateIfcSceneSplit(structure.value, geometry, properties);
const commonOptions = {
  coarseBounds: true,
  generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
  propertyColumns: properties,
};
const compile = (options) => {
  const startedAt = performance.now();
  const result = compileSceneToGltf(scene, { ...commonOptions, ...options });
  return { result, milliseconds: performance.now() - startedAt };
};

const prototypeRanges = compile({});
const compatibility = compile({
  targetChunkByteBudget,
  spatialIndex: true,
  spatialLeafCapacity: leafCapacity,
});
const packed = compile({
  targetChunkByteBudget,
  spatialIndex: true,
  spatialLeafCapacity: leafCapacity,
  spatialPayloadOrder: true,
});
const packedRepeat = compile({
  targetChunkByteBudget,
  spatialIndex: true,
  spatialLeafCapacity: leafCapacity,
  spatialPayloadOrder: true,
});
if (
  packedRepeat.result.json !== packed.result.json ||
  !Buffer.from(packedRepeat.result.binary).equals(packed.result.binary) ||
  !Buffer.from(packedRepeat.result.coarseBinary).equals(packed.result.coarseBinary) ||
  !Buffer.from(packedRepeat.result.spatialBinary).equals(packed.result.spatialBinary)
) {
  throw new Error("Repeated spatial payload compilation was not byte-identical.");
}
if (!Buffer.from(compatibility.result.coarseBinary).equals(packed.result.coarseBinary)) {
  throw new Error("Spatial payload ordering changed coarse.bin.");
}

const progressiveFor = (compiled) => compiled.document.extras.madi.progressive;
const prototypeBytes = new Map(
  progressiveFor(prototypeRanges.result).targetChunks.map((chunk) => [
    chunk.prototypeId,
    chunk.byteLength,
  ]),
);
const leafMetrics = (compiled) => {
  const progressive = progressiveFor(compiled);
  const chunks = progressive.targetChunks;
  const spatial = decodeSpatialDemandIndex(compiled.spatialBinary, {
    gltfNodeCount: compiled.document.nodes.length,
    targetChunkCount: chunks.length,
    expectedOccurrenceCount: compiled.report.counts.renderableOccurrenceCount,
  });
  const requestedBytes = [];
  const usefulBytes = [];
  const offViewBytes = [];
  const chunkCounts = [];
  for (let nodeIndex = 0; nodeIndex < spatial.stats.nodeCount; nodeIndex += 1) {
    const occurrenceCount = spatial.occurrenceReferenceCounts[nodeIndex];
    if (occurrenceCount === 0) continue;
    const firstOccurrence = spatial.firstOccurrenceReferences[nodeIndex];
    const prototypes = new Set();
    for (let index = firstOccurrence; index < firstOccurrence + occurrenceCount; index += 1) {
      const gltfNodeIndex = spatial.occurrenceNodeIndexes[index];
      const prototypeId = compiled.document.nodes[gltfNodeIndex]?.extras?.madi?.prototypeId;
      if (typeof prototypeId !== "string") {
        throw new Error(`Spatial leaf references node ${String(gltfNodeIndex)} without prototypeId.`);
      }
      prototypes.add(prototypeId);
    }
    const firstChunk = spatial.firstChunkReferences[nodeIndex];
    const chunkCount = spatial.chunkReferenceCounts[nodeIndex];
    let requested = 0;
    for (let index = firstChunk; index < firstChunk + chunkCount; index += 1) {
      const chunk = chunks[spatial.chunkReferences[index]];
      if (!chunk) throw new Error("Spatial leaf references a missing target chunk.");
      requested += chunk.byteLength;
    }
    let useful = 0;
    for (const prototypeId of prototypes) {
      const bytes = prototypeBytes.get(prototypeId);
      if (bytes === undefined) throw new Error(`Missing payload length for ${prototypeId}.`);
      useful += bytes;
    }
    requestedBytes.push(requested);
    usefulBytes.push(useful);
    offViewBytes.push(requested - useful);
    chunkCounts.push(chunkCount);
  }
  return {
    leafCount: spatial.stats.leafCount,
    chunkReferences: spatial.stats.chunkReferenceCount,
    chunksPerLeaf: distribution(chunkCounts),
    requestedBytesPerLeaf: distribution(requestedBytes),
    usefulBytesPerLeaf: distribution(usefulBytes),
    offViewBytesPerLeaf: distribution(offViewBytes),
    summedRequestedBytes: requestedBytes.reduce((total, value) => total + value, 0),
    summedUsefulBytes: usefulBytes.reduce((total, value) => total + value, 0),
    summedOffViewBytes: offViewBytes.reduce((total, value) => total + value, 0),
  };
};
const summarize = ({ result, milliseconds }) => ({
  compileMilliseconds: milliseconds,
  packageDigest: result.report.output.packageDigest,
  targetChunkCount: result.report.counts.targetChunkCount,
  targetBytes: result.binary.byteLength,
  coarseBytes: result.coarseBinary.byteLength,
  spatialBytes: result.spatialBinary.byteLength,
  spatialSha256: sha256(result.spatialBinary),
  leafMetrics: leafMetrics(result),
});
const validatePackage = async (compiled) => {
  const resources = new Map([
    ["scene.bin", compiled.binary],
    ["coarse.bin", compiled.coarseBinary],
  ]);
  const report = await validateBytes(new TextEncoder().encode(compiled.json), {
    uri: "scene.gltf",
    format: "gltf",
    writeTimestamp: false,
    maxIssues: 100,
    externalResourceFunction: async (uri) => {
      const bytes = resources.get(uri);
      if (!bytes) throw new TypeError(`Unexpected glTF resource ${uri}.`);
      return bytes;
    },
  });
  if (report.issues.numErrors !== 0 || report.issues.numWarnings !== 0) {
    throw new Error("Khronos glTF validation found errors or warnings.");
  }
  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
  };
};
const [compatibilityValidation, packedValidation] = await Promise.all([
  validatePackage(compatibility.result),
  validatePackage(packed.result),
]);
const evidence = {
  schemaVersion: "naru.spatial-ifc-packing-evidence.1",
  source: {
    sceneId: scene.sceneId,
    revisionId: scene.revision.id,
    sourceDigest: scene.revision.sourceDigest,
    structureBytes: structure.byteLength,
    structureSha256: structure.sha256,
    geometryBytes: geometry.byteLength,
    geometrySha256: sha256(geometry),
  },
  options: { targetChunkByteBudget, leafCapacity },
  counts: packed.result.report.counts,
  compatibility: summarize(compatibility),
  spatialLeafAnchor: summarize(packed),
  khronosValidation: {
    validator: "Khronos glTF Validator",
    version: gltfValidatorVersion(),
    compatibility: compatibilityValidation,
    spatialLeafAnchor: packedValidation,
  },
  deterministicRepeat: true,
  coarseByteIdentical: true,
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeCompiledPackage(compatibility.result, resolve(outputDirectory, "compatibility")),
  writeCompiledPackage(packed.result, resolve(outputDirectory, "spatial-leaf-anchor")),
]);
await writeFile(
  resolve(outputDirectory, "evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);
console.log(
  `[spatial-ifc-packing] compatibility ${evidence.compatibility.targetChunkCount} chunks, ` +
  `${Math.round(evidence.compatibility.leafMetrics.summedOffViewBytes / 1024)} KiB off-view; ` +
  `leaf-anchor ${evidence.spatialLeafAnchor.targetChunkCount} chunks, ` +
  `${Math.round(evidence.spatialLeafAnchor.leafMetrics.summedOffViewBytes / 1024)} KiB off-view`,
);
console.log(`[spatial-ifc-packing] evidence: ${outputDirectory}`);
