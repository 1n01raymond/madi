/**
 * Measures what relocating mesh-less hierarchy nodes costs and recovers, one
 * option variant per process.
 *
 * The lever was ranked before it was built: mesh-less occurrence nodes are
 * 88,741,293 B of the engineering baseline's document, 21.88% of it
 * (`artifacts/compiler/node-field-elision`). That figure is an upper bound on
 * what the document can shed, not a saving -- the nodes still have to be
 * carried, and this script measures the whole package on both sides so the
 * sidecar's own bytes are charged against the document bytes it removes.
 *
 * A federation-scale compile peaks near 3 GB, so each variant runs on its own.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { compileSceneToGltf } from "../packages/compiler/dist/index.js";
import { hydrateIfcSceneSplit } from "../packages/compiler/dist/ifc-scene.js";
import { readIfcStructure } from "../packages/compiler/dist/ifc-structure-stream.js";

import { measureGltfNodeBytesInString } from "./lib/gltf-node-bytes.mjs";
import { HIERARCHY_RELOCATION_VARIANTS } from "./lib/hierarchy-relocation-variants.mjs";
import { NODE_FIELD_COMPILE_OPTIONS } from "./lib/node-field-variants.mjs";

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
if (!Object.hasOwn(HIERARCHY_RELOCATION_VARIANTS, variant)) {
  throw new TypeError(
    `--variant must be one of ${Object.keys(HIERARCHY_RELOCATION_VARIANTS).join(", ")}.`,
  );
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
const scene = hydrateIfcSceneSplit(structure.value, geometry, properties);
const hydratedSeconds = seconds(startedAt);

const compileStartedAt = performance.now();
const result = compileSceneToGltf(scene, {
  ...NODE_FIELD_COMPILE_OPTIONS,
  propertyColumns: properties,
  ...HIERARCHY_RELOCATION_VARIANTS[variant],
});
const compileSeconds = seconds(compileStartedAt);

// Where the document's bytes sit, so the package delta can be explained rather
// than asserted: relocation empties the nodes array but also drops every
// `children` member, bakes a matrix onto the nodes it keeps, and lists them all
// in the scene. The scanner streams and never parses.
const measurement = await measureGltfNodeBytesInString(result.json.text());
const fieldBytes = (field) => measurement.fields.find((entry) => entry.field === field)?.bytes ?? 0;
const memberBytes = (member) =>
  measurement.topLevel.find((entry) => entry.member === member)?.bytes ?? 0;

const resources = result.report.output.resources.map(({ path, bytes, sha256 }) => ({
  path,
  bytes,
  sha256,
}));
const byPath = new Map(resources.map((resource) => [resource.path, resource]));
const record = {
  label,
  variant,
  options: result.report.options,
  sourceStructure: { byteLength: structure.byteLength, sha256: structure.sha256 },
  counts: result.report.counts,
  document: { bytes: result.json.bytes, sha256: result.json.sha256 },
  nodeSplit: {
    compactBytes: measurement.compactBytes,
    nodeArrayBytes: memberBytes("nodes"),
    nodeCount: measurement.elementCount,
    sceneArrayBytes: memberBytes("scenes"),
    meshlessNodeBytes: measurement.classes.meshless.bytes,
    meshlessNodeCount: measurement.classes.meshless.count,
    childrenBytes: fieldBytes("children"),
    matrixBytes: fieldBytes("matrix"),
  },
  sidecar: {
    json: byPath.get(result.report.options.hierarchyUri ?? "hierarchy.json") ?? null,
    columns: byPath.get(result.report.options.hierarchyBinaryUri ?? "hierarchy.bin") ?? null,
  },
  resources,
  packageBytes: resources.reduce((total, resource) => total + resource.bytes, 0),
  packageDigest: result.report.output.packageDigest,
  timings: { hydratedSeconds, compileSeconds, totalSeconds: seconds(startedAt) },
  peakResidentBytes: process.memoryUsage().rss,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
console.log(
  `[relocation] ${label}/${variant}: document ${record.document.bytes.toLocaleString("en-US")} B, ` +
    `package ${record.packageBytes.toLocaleString("en-US")} B, ` +
    `${record.counts.gltfNodeCount.toLocaleString("en-US")} nodes in ${compileSeconds} s`,
);
