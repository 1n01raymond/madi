/**
 * Measures the compiled glTF document one option variant at a time.
 *
 * Issue #85 asks where a federation-scale document actually spends its bytes
 * before any lever is chosen. Answering that needs the same scene compiled
 * several ways, and a sixty5-scale compile peaks near 3 GB, so each variant
 * runs in its own process against a retained split Scene IR. Nothing is
 * written to a package directory: only the document is measured, field by
 * field, by streaming it through the shared scanner.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { compileSceneToGltf } from "../packages/compiler/dist/index.js";
import { hydrateIfcSceneSplit } from "../packages/compiler/dist/ifc-scene.js";
import { readIfcStructure } from "../packages/compiler/dist/ifc-structure-stream.js";

import { measureGltfNodeBytesInString } from "./lib/gltf-node-bytes.mjs";
import {
  NODE_FIELD_COMPILE_OPTIONS,
  NODE_FIELD_VARIANTS,
} from "./lib/node-field-variants.mjs";

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
const outputPath = insideRepository(argument("--output"), "--output");
const variant = argument("--variant", "baseline");
if (!Object.hasOwn(NODE_FIELD_VARIANTS, variant)) {
  throw new TypeError(`--variant must be one of ${Object.keys(NODE_FIELD_VARIANTS).join(", ")}.`);
}
const label = argument("--label", "unnamed");

const startedAt = performance.now();
const seconds = (from) => Number(((performance.now() - from) / 1000).toFixed(1));
// The structure document is hundreds of megabytes, so it is read as a stream.
const [structure, geometry, properties] = await Promise.all([
  readIfcStructure(resolve(inputDirectory, "scene-ir.json")),
  readFile(resolve(inputDirectory, "scene-ir-geometry.bin")),
  readFile(resolve(inputDirectory, "scene-ir-properties.bin")),
]);
console.log(
  `[node-fields] ${label}/${variant}: structure ${structure.byteLength} B ` +
    `${structure.sha256.slice(0, 8)} (${seconds(startedAt)} s)`,
);

const compiledAt = performance.now();
// Every option except the variant's own matches the engineering baseline
// compile, so a byte delta can only come from the lever under test.
const result = compileSceneToGltf(hydrateIfcSceneSplit(structure.value, geometry, properties), {
  ...NODE_FIELD_COMPILE_OPTIONS,
  propertyColumns: properties,
  ...NODE_FIELD_VARIANTS[variant],
});
const compileSeconds = seconds(compiledAt);
// The compiled document is a streaming recipe, not a string (ADR-0016);
// the scanner reads a string, and every document measured here is below
// the runtime's maximum string length.
const measurement = await measureGltfNodeBytesInString(result.json.text());
console.log(
  `[node-fields] ${label}/${variant}: document ${measurement.rawBytes} B, ` +
    `${measurement.elementCount} nodes, digest ` +
    `${result.report.output.packageDigest.slice(0, 12)} (${compileSeconds} s)`,
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      label,
      variant,
      compileSeconds,
      sourceStructure: { byteLength: structure.byteLength, sha256: structure.sha256 },
      options: result.report.options,
      counts: result.report.counts,
      packageDigest: result.report.output.packageDigest,
      measurement,
      peakRssBytes: process.memoryUsage().rss,
    },
    undefined,
    2,
  )}\n`,
  "utf8",
);
console.log(`[node-fields] ${label}/${variant}: wrote ${relative(repositoryRoot, outputPath)}`);
