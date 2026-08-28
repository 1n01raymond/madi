/**
 * Proves that eliding derived identifiers and default transforms changes what
 * the document says, not what the runtime loads.
 *
 * The same scene is compiled twice -- once with today's default options, once
 * with both size levers on -- and both packages are then decoded through the
 * runtime loader. Every occurrence must come back with the same identity and
 * the same world transform, bit for bit: a translation-only node is re-emitted
 * as TRS precisely because that form recomposes its matrix exactly.
 *
 * Both documents are held at once, so this runs on a model small enough to
 * afford it. Federation-scale documents are measured, not round-tripped.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { compileSceneToGltf } from "../packages/compiler/dist/index.js";
import { hydrateIfcSceneSplit } from "../packages/compiler/dist/ifc-scene.js";
import { readIfcStructure } from "../packages/compiler/dist/ifc-structure-stream.js";
import { decodeCompiledGltf } from "../packages/runtime-webgpu/dist/index.js";

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
  ...NODE_FIELD_VARIANTS[variant],
});

const toArrayBuffer = (bytes) => bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);

function loaded(result) {
  const coarse = result.coarseBinary;
  if (!coarse) throw new Error("The compile produced no coarse binary to decode.");
  const decoded = decodeCompiledGltf(JSON.parse(result.json), toArrayBuffer(coarse), {
    representation: "coarse",
  });
  const identities = new Map();
  for (const object of decoded.objectEvidence) {
    identities.set(object.occurrenceId, {
      objectId: object.objectId,
      semanticId: object.semanticId ?? null,
      sourceRef: object.sourceRef ?? null,
    });
  }
  const transforms = new Map();
  for (const batch of decoded.gpuScene.batches) {
    for (const instance of batch.instances) {
      transforms.set(instance.objectId, [...instance.transform]);
    }
  }
  const hierarchy = new Map();
  for (const entry of decoded.hierarchy.entries) {
    hierarchy.set(entry.nodeIndex, [entry.occurrenceId, entry.semanticId ?? null, entry.sourceRef ?? null].join("\u0000"));
  }
  return { decoded, identities, transforms, hierarchy };
}

const baseline = loaded(compile("baseline"));
const elided = loaded(compile("both"));

const mismatches = [];
const note = (kind, key, expected, actual) => {
  if (mismatches.length < 10) mismatches.push({ kind, key, expected, actual });
};

for (const [occurrenceId, expected] of baseline.identities) {
  const actual = elided.identities.get(occurrenceId);
  if (!actual) note("missing-occurrence", occurrenceId, expected, null);
  else if (
    actual.semanticId !== expected.semanticId ||
    actual.sourceRef !== expected.sourceRef ||
    actual.objectId !== expected.objectId
  ) note("identity", occurrenceId, expected, actual);
}
for (const [nodeIndex, expected] of baseline.hierarchy) {
  const actual = elided.hierarchy.get(nodeIndex);
  if (actual !== expected) note("hierarchy", String(nodeIndex), expected, actual ?? null);
}
let instancesCompared = 0;
for (const [objectId, expected] of baseline.transforms) {
  const actual = elided.transforms.get(objectId);
  instancesCompared += 1;
  if (!actual || actual.length !== expected.length) {
    note("missing-instance", String(objectId), expected.length, actual?.length ?? null);
    continue;
  }
  const element = expected.findIndex((value, at) => !Object.is(value, actual[at]));
  if (element !== -1) {
    note("transform", `${objectId}[${element}]`, expected[element], actual[element]);
  }
}

const summaryOf = ({ decoded }) => ({
  ...decoded.summary,
  occurrences: decoded.objectEvidence.length,
  hierarchyEntries: decoded.hierarchy.entries.length,
});
const record = {
  label,
  sourceStructure: { byteLength: structure.byteLength, sha256: structure.sha256 },
  occurrencesCompared: baseline.identities.size,
  hierarchyEntriesCompared: baseline.hierarchy.size,
  instancesCompared,
  mismatchCount: mismatches.length,
  mismatches,
  baseline: summaryOf(baseline),
  elided: summaryOf(elided),
  identical: mismatches.length === 0,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
console.log(
  `[round-trip] ${label}: ${record.occurrencesCompared} occurrences, ` +
    `${record.instancesCompared} instances, ${record.mismatchCount} mismatches`,
);
if (!record.identical) process.exitCode = 1;
