import { constants as bufferConstants } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";

import { decodeSpatialDemandIndex } from "../packages/runtime-webgpu/dist/index.js";

import {
  engineeringBaselineEvidenceSchema,
  loadEngineeringBaselineSources,
} from "./lib/engineering-baseline.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const inputDirectory = resolve(
  repositoryRoot,
  process.argv[2] ?? "output/ifc/engineering-baseline",
);
const artifactDirectory = resolve(
  repositoryRoot,
  process.argv[3] ?? "artifacts/ifc/engineering-baseline",
);

function assert(condition, message) {
  if (!condition) throw new TypeError(`[engineering-baseline] ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const sources = await loadEngineeringBaselineSources();
const [adapterReportBytes, buildReportBytes] = await Promise.all([
  readFile(resolve(inputDirectory, "adapter-report.json")),
  readFile(resolve(inputDirectory, "build-report.json")),
]);
const adapter = JSON.parse(adapterReportBytes.toString("utf8"));
const compiler = JSON.parse(buildReportBytes.toString("utf8"));

assert(adapter.schemaVersion === "naru.ifc-adapter-report.6", "adapter schema changed");
assert(adapter.adapter?.name === "IfcOpenShell", "adapter identity changed");
assert(adapter.adapter?.version === "0.8.5", "IfcOpenShell version changed");
assert(adapter.sources?.length === sources.selected.length, "source count changed");
for (const expected of sources.selected) {
  const actual = adapter.sources.find(({ discipline }) => discipline === expected.discipline);
  assert(actual, `adapter report is missing ${expected.discipline}`);
  assert(actual.path === expected.uriHint, `${expected.discipline} URI hint changed`);
  assert(actual.byteLength === expected.byteLength, `${expected.discipline} bytes changed`);
  assert(actual.sha256 === expected.sha256, `${expected.discipline} SHA-256 changed`);
}

const counts = adapter.counts;
assert(counts.geometricOccurrenceCount >= 100_000, "renderable occurrence floor failed");
assert(counts.submittedTriangleCount >= 10_000_000, "submitted triangle floor failed");
assert(counts.geometricPrototypeCount >= 10_000, "geometric prototype floor failed");
assert(Number.isSafeInteger(counts.triangleCount), "unique triangle count is missing");
assert(
  compiler.counts.renderableOccurrenceCount === counts.geometricOccurrenceCount &&
    compiler.counts.compiledPrototypeCount === counts.geometricPrototypeCount &&
    compiler.counts.triangleCount === counts.triangleCount,
  "adapter/compiler count parity failed",
);
assert(
  compiler.options.jsonFormatting === "compact" &&
    compiler.options.resourceNames === "omitted" &&
    compiler.options.targetPayloadOrder === "spatial-leaf-anchor-v1",
  "large-package compile options changed",
);

const resourceBytes = new Map();
for (const resource of compiler.output.resources) {
  const bytes = await readFile(resolve(inputDirectory, resource.path));
  assert(bytes.byteLength === resource.bytes, `${resource.path} byte count changed`);
  assert(sha256(bytes) === resource.sha256, `${resource.path} SHA-256 changed`);
  resourceBytes.set(resource.path, bytes);
}
const gltfBytes = resourceBytes.get("scene.gltf");
assert(gltfBytes, "scene.gltf is missing");
assert(
  gltfBytes.byteLength <= bufferConstants.MAX_STRING_LENGTH,
  `scene.gltf exceeds this Node/V8 string limit (${bufferConstants.MAX_STRING_LENGTH})`,
);
const spatialBytes = resourceBytes.get("spatial.bin");
assert(spatialBytes, "spatial.bin is missing");
const decodedSpatialIndex = decodeSpatialDemandIndex(spatialBytes, {
  gltfNodeCount: compiler.counts.gltfNodeCount,
  targetChunkCount: compiler.counts.targetChunkCount,
  expectedOccurrenceCount: counts.geometricOccurrenceCount,
});
const spatialIndex = {
  schemaVersion: decodedSpatialIndex.schemaVersion,
  ...decodedSpatialIndex.stats,
  rootBoundsMeters: {
    minimum: Array.from(decodedSpatialIndex.bounds.subarray(0, 3)),
    maximum: Array.from(decodedSpatialIndex.bounds.subarray(3, 6)),
  },
};

const packageHash = createHash("sha256");
for (const resource of compiler.output.resources) {
  packageHash.update(resourceBytes.get(resource.path));
}
assert(
  packageHash.digest("hex") === compiler.output.packageDigest,
  "package digest chain changed",
);

const officialValidation = await validateBytes(
  new Uint8Array(gltfBytes.buffer, gltfBytes.byteOffset, gltfBytes.byteLength),
  {
    uri: "scene.gltf",
    format: "gltf",
    writeTimestamp: false,
    maxIssues: 100,
    externalResourceFunction: async (uri) => {
      const bytes = resourceBytes.get(uri);
      if (bytes) {
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }
      throw new TypeError(`Unexpected glTF resource ${uri}.`);
    },
  },
);
assert(
  officialValidation.issues.numErrors === 0 &&
    officialValidation.issues.numWarnings === 0,
  "Khronos glTF validation found errors or warnings",
);

const evidence = {
  schemaVersion: engineeringBaselineEvidenceSchema,
  recordedAt: new Date().toISOString(),
  status: "qualified-package-not-yet-published",
  manifestSha256: sources.manifestSha256,
  datasets: sources.datasets.map(({ id, name, source }) => ({
    id,
    name,
    revision: source.revision,
    license: source.license,
    licenseUrl: source.licenseUrl,
    attribution: source.attribution,
  })),
  selection: {
    policy: "sixty5-design-plus-complete-geelen-aarts-cohort-v1",
    sha256: sources.selectionSha256,
    documentCount: sources.selected.length,
    sourceBytes: sources.selected.reduce((sum, source) => sum + source.byteLength, 0),
    documents: sources.selected,
  },
  toolchain: {
    adapter: adapter.adapter,
    sceneIrEncoding: adapter.scene.encodingVersion,
    compiler: compiler.compiler,
    gltfValidator: gltfValidatorVersion(),
  },
  host: {
    node: process.versions.node,
    platform: platform(),
    architecture: arch(),
    release: release(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  counts: {
    occurrenceCount: counts.occurrenceCount,
    geometricOccurrenceCount: counts.geometricOccurrenceCount,
    geometricPrototypeCount: counts.geometricPrototypeCount,
    submittedTriangleCount: counts.submittedTriangleCount,
    triangleCount: counts.triangleCount,
    edgeSegmentCount: counts.edgeSegmentCount,
    submittedEdgeSegmentCount: counts.submittedEdgeSegmentCount,
  },
  gate: {
    geometricOccurrenceCount: { minimum: 100_000, measured: counts.geometricOccurrenceCount },
    submittedTriangleCount: { minimum: 10_000_000, measured: counts.submittedTriangleCount },
    geometricPrototypeCount: { minimum: 10_000, measured: counts.geometricPrototypeCount },
    passed: true,
  },
  reports: {
    adapter: {
      path: "adapter-report.json",
      bytes: adapterReportBytes.byteLength,
      sha256: sha256(adapterReportBytes),
    },
    compiler: {
      path: "build-report.json",
      bytes: buildReportBytes.byteLength,
      sha256: sha256(buildReportBytes),
    },
  },
  package: {
    digest: compiler.output.packageDigest,
    resources: compiler.output.resources,
    totalBytes: compiler.output.resources.reduce((sum, resource) => sum + resource.bytes, 0),
    documentStringLimitBytes: bufferConstants.MAX_STRING_LENGTH,
    publicUrl: null,
  },
  spatialDemandIndex: spatialIndex,
  khronosValidation: {
    validator: "Khronos glTF Validator",
    version: gltfValidatorVersion(),
    issues: {
      numErrors: officialValidation.issues.numErrors,
      numWarnings: officialValidation.issues.numWarnings,
      numInfos: officialValidation.issues.numInfos,
      numHints: officialValidation.issues.numHints,
    },
  },
  limitations: [
    "This record qualifies source, compilation, package identity, and the engineering-scale floor; it is not a startup, frame-time, memory, or renderer comparison.",
    "The compiled package has not yet been published or opened through the public Studio delivery path, so the Phase 2 public-baseline exit criterion remains partial.",
    "West Riverside Hospital is excluded: its upstream publisher does not state redistribution terms, so no source-derived artifact from it is included.",
    "CadQuarry is tracked separately as a source-derived synthetic STEP/OCCT breadth control and cannot satisfy this real-engineering-source gate.",
  ],
};

await mkdir(artifactDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(artifactDirectory, "adapter-report.json"), adapterReportBytes),
  writeFile(resolve(artifactDirectory, "build-report.json"), buildReportBytes),
  writeFile(
    resolve(artifactDirectory, "validation-report.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(
  `[engineering-baseline] recorded ${counts.geometricOccurrenceCount.toLocaleString("en-US")} ` +
    `renderable occurrences / ${counts.geometricPrototypeCount.toLocaleString("en-US")} ` +
    `geometric prototypes`,
);
console.log(
  `[engineering-baseline] Khronos glTF Validator ${gltfValidatorVersion()} ` +
    `(${officialValidation.issues.numErrors} errors / ` +
    `${officialValidation.issues.numWarnings} warnings)`,
);
console.log(`[engineering-baseline] package ${compiler.output.packageDigest}`);
