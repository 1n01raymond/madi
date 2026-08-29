/**
 * Proves that relocating mesh-less hierarchy nodes changes where the assembly
 * tree is stored, not what it says.
 *
 * The same scene is compiled twice -- once with today's default options, once
 * with the nodes relocated to the sidecar -- and both packages are decoded
 * through the runtime loader. The tree has to come back entry for entry in the
 * same order, with the same names, depths, and identities, and every occurrence
 * has to keep its world transform bit for bit: relocation bakes composed
 * transforms onto the nodes it keeps, so a rounding difference there would be a
 * silently moved model.
 *
 * Both packages are held at once, so this runs on a model small enough to
 * afford it. Federation-scale documents are measured, not round-tripped.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { compileSceneToGltf } from "../packages/compiler/dist/index.js";
import { hydrateIfcSceneSplit } from "../packages/compiler/dist/ifc-scene.js";
import { readIfcStructure } from "../packages/compiler/dist/ifc-structure-stream.js";
import { decodeCompiledGltf } from "../packages/runtime-webgpu/dist/index.js";

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
    fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
  ) {
    throw new TypeError(`${label} must remain inside the repository.`);
  }
  return path;
};

const inputDirectory = insideRepository(argument("--input"), "--input");
const outputPath = insideRepository(argument("--output"), "--output");
const label = argument("--label", "unnamed");

const [structure, geometry, properties] = await Promise.all([
  readIfcStructure(resolve(inputDirectory, "scene-ir.json")),
  readFile(resolve(inputDirectory, "scene-ir-geometry.bin")),
  readFile(resolve(inputDirectory, "scene-ir-properties.bin")),
]);
const scene = hydrateIfcSceneSplit(structure.value, geometry, properties);

const compile = (variant) => compileSceneToGltf(scene, {
  ...NODE_FIELD_COMPILE_OPTIONS,
  propertyColumns: properties,
  ...HIERARCHY_RELOCATION_VARIANTS[variant],
});

const toArrayBuffer = (bytes) => bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);

function loaded(result) {
  const coarse = result.coarseBinary;
  if (!coarse) throw new Error("The compile produced no coarse binary to decode.");
  const sidecar = result.hierarchyJson && result.hierarchyBinary
    ? { hierarchy: { json: result.hierarchyJson, columns: result.hierarchyBinary } }
    : {};
  const decoded = decodeCompiledGltf(JSON.parse(result.json.text()), toArrayBuffer(coarse), {
    representation: "coarse",
    ...sidecar,
  });
  // Node indexes are the one field relocation is allowed to change: the
  // document renumbers when nodes leave it, and relocated entries are keyed
  // past the end of the node array.
  const tree = decoded.hierarchy.entries.map((entry) => [
    entry.name,
    entry.depth,
    entry.renderable,
    entry.occurrenceId,
    entry.prototypeId,
    entry.semanticId ?? null,
    entry.sourceRef ?? null,
  ].join("\u0000"));
  const occurrenceById = new Map(
    decoded.objectEvidence.map((object) => [object.objectId, object.occurrenceId]),
  );
  const transforms = new Map();
  for (const batch of decoded.gpuScene.batches) {
    for (const instance of batch.instances) {
      const occurrenceId = occurrenceById.get(instance.objectId);
      if (occurrenceId !== undefined) transforms.set(occurrenceId, [...instance.transform]);
    }
  }
  return { decoded, tree, transforms };
}

const baseline = loaded(compile("baseline"));
const relocated = loaded(compile("relocated"));

const mismatches = [];
const note = (kind, key, expected, actual) => {
  if (mismatches.length < 10) mismatches.push({ kind, key, expected, actual });
};

if (baseline.tree.length !== relocated.tree.length) {
  note("tree-length", "entries", baseline.tree.length, relocated.tree.length);
}
for (const [position, expected] of baseline.tree.entries()) {
  const actual = relocated.tree[position];
  if (actual !== expected) note("tree-entry", String(position), expected, actual ?? null);
}
let instancesCompared = 0;
for (const [occurrenceId, expected] of baseline.transforms) {
  const actual = relocated.transforms.get(occurrenceId);
  instancesCompared += 1;
  if (!actual || actual.length !== expected.length) {
    note("missing-instance", occurrenceId, expected.length, actual?.length ?? null);
    continue;
  }
  const element = expected.findIndex((value, at) => !Object.is(value, actual[at]));
  if (element !== -1) {
    note("transform", `${occurrenceId}[${element}]`, expected[element], actual[element]);
  }
}

const summaryOf = ({ decoded }) => ({
  ...decoded.summary,
  occurrences: decoded.objectEvidence.length,
  hierarchyEntries: decoded.hierarchy.entries.length,
  documentNodes: decoded.hierarchy.nodeCount,
  renderableOccurrences: decoded.hierarchy.renderableOccurrences,
});
const record = {
  label,
  sourceStructure: { byteLength: structure.byteLength, sha256: structure.sha256 },
  hierarchyEntriesCompared: baseline.tree.length,
  instancesCompared,
  relocatedCount: relocated.decoded.hierarchy.relocatedHierarchy?.relocatedCount ?? 0,
  mismatchCount: mismatches.length,
  mismatches,
  baseline: summaryOf(baseline),
  relocated: summaryOf(relocated),
  identical: mismatches.length === 0,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
console.log(
  `[round-trip] ${label}: ${record.hierarchyEntriesCompared} entries, ` +
    `${record.instancesCompared} instances, ${record.mismatchCount} mismatches`,
);
if (!record.identical) process.exitCode = 1;
