#!/usr/bin/env node

import { constants as bufferConstants } from "node:buffer";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { compileIfcFederation } from "../packages/compiler/dist/index.js";
import { loadEngineeringBaselineSources } from "./lib/engineering-baseline.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new TypeError(`[engineering-baseline] ${message}`);
}

const outputDirectory = resolve(argument("--output", "output/ifc/engineering-baseline"));
const cacheDirectory = resolve(argument("--cache", "output/cache/engineering-baseline"));
const pythonExecutable = argument(
  "--python",
  process.env.NARU_IFC_PYTHON ?? process.env.NARU_PYTHON ?? "python3",
);
const threads = Number(argument("--threads", "6"));
assert(Number.isSafeInteger(threads) && threads > 0, "--threads must be a positive integer");

const sources = await loadEngineeringBaselineSources();
const result = await compileIfcFederation({
  documents: sources.documents,
  outputDirectory,
  cacheDirectory,
  pythonExecutable,
  threads,
  targetChunkByteBudget: 512 * 1024,
  spatialIndex: true,
  spatialPayloadOrder: true,
  compactJson: true,
  omitResourceNames: true,
});
const adapter = result.adapterReport;
const adapterCounts = adapter.counts;
const compilerCounts = result.report.counts;

assert(adapterCounts.geometricOccurrenceCount >= 100_000, "renderable occurrence floor failed");
assert(adapterCounts.submittedTriangleCount >= 10_000_000, "submitted triangle floor failed");
assert(adapterCounts.geometricPrototypeCount >= 10_000, "geometric prototype floor failed");
assert(
  compilerCounts.renderableOccurrenceCount === adapterCounts.geometricOccurrenceCount &&
    compilerCounts.compiledPrototypeCount === adapterCounts.geometricPrototypeCount &&
    compilerCounts.triangleCount === adapterCounts.triangleCount,
  "adapter/compiler count parity failed",
);
assert(result.report.options.jsonFormatting === "compact", "compact JSON was not recorded");
assert(result.report.options.resourceNames === "omitted", "resource-name policy was not recorded");

const gltf = await stat(resolve(outputDirectory, "scene.gltf"));
assert(
  gltf.size <= bufferConstants.MAX_STRING_LENGTH,
  `scene.gltf is ${gltf.size} bytes, above this Node/V8 string limit ` +
    `${bufferConstants.MAX_STRING_LENGTH}`,
);

console.log(
  `[engineering-baseline] ${sources.documents.length} documents / ` +
    `${adapterCounts.geometricOccurrenceCount.toLocaleString("en-US")} renderable occurrences / ` +
    `${adapterCounts.geometricPrototypeCount.toLocaleString("en-US")} geometric prototypes`,
);
console.log(
  `[engineering-baseline] ${adapterCounts.submittedTriangleCount.toLocaleString("en-US")} ` +
    `submitted / ${adapterCounts.triangleCount.toLocaleString("en-US")} unique triangles`,
);
console.log(`[engineering-baseline] scene.gltf ${gltf.size.toLocaleString("en-US")} bytes`);
console.log(`[engineering-baseline] package ${result.report.output.packageDigest}`);
