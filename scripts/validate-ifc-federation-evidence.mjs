import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/ifc/digital-hub");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[ifc-federation] ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertCounts(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    assert(actual?.[key] === value, `${label} ${key} changed.`);
  }
}

const [manifest, adapterBytes, compilerBytes, evidence] = await Promise.all([
  readFile(resolve(repositoryRoot, "fixtures/external/manifest.json"), "utf8").then(JSON.parse),
  readFile(resolve(artifactDirectory, "adapter-report.json")),
  readFile(resolve(artifactDirectory, "build-report.json")),
  readFile(resolve(artifactDirectory, "validation-report.json"), "utf8").then(JSON.parse),
]);
const adapter = JSON.parse(adapterBytes.toString("utf8"));
const compiler = JSON.parse(compilerBytes.toString("utf8"));
const dataset = manifest.datasets.find(({ id }) => id === "ifc-bench-digital-hub");

assert(dataset?.status === "qualified", "Digital Hub fixture is not qualified.");
assert(dataset.source.license === "MIT", "Digital Hub source license changed.");
assert(
  dataset.source.revision === "4b37e5d77f12f30dfd7cb7375e15278e1037c808",
  "Digital Hub source revision changed.",
);
assert(adapter.schemaVersion === "madi.ifc-adapter-report.1", "Unknown adapter report.");
assert(
  adapter.adapter.name === "IfcOpenShell" && adapter.adapter.version === "0.8.5",
  "IfcOpenShell evidence version changed.",
);
assert(adapter.adapter.geometryLibrary === "opencascade", "Geometry library changed.");
assert(
  adapter.federation.sourceDigest ===
    "89fae107a28fc5f86494cb9ce788f62789b9f4ace46c42b1bb7a9e54265d4785",
  "Federation source digest changed.",
);
assert(
  JSON.stringify(adapter.federation.documentOrder) ===
    JSON.stringify(["architecture", "heating", "plumbing", "ventilation"]),
  "Federation document order changed.",
);
assert(
  adapter.federation.options.includeSurfaces === true &&
    adapter.federation.options.includeEdges === false &&
    adapter.federation.options.useWorldCoordinates === false &&
    adapter.federation.options.normalizeSceneToMeters === true,
  "Federation extraction contract changed.",
);

const expectedSources = new Map([
  ["architecture", { unitScaleToMeters: 1, triangleCount: 95680, submittedTriangleCount: 343300 }],
  ["heating", { unitScaleToMeters: 0.001, triangleCount: 303854, submittedTriangleCount: 618056 }],
  ["plumbing", { unitScaleToMeters: 0.001, triangleCount: 436138, submittedTriangleCount: 1414048 }],
  ["ventilation", { unitScaleToMeters: 0.001, triangleCount: 77848, submittedTriangleCount: 158960 }],
]);
assert(adapter.sources.length === dataset.assets.length, "Source document count changed.");
for (const source of adapter.sources) {
  const asset = dataset.assets.find(({ discipline }) => discipline === source.discipline);
  const expected = expectedSources.get(source.discipline);
  assert(asset && expected, `Unknown source discipline ${source.discipline}.`);
  assert(source.path === `projects/digital_hub/${asset.path}`, `${source.discipline} URI changed.`);
  assert(source.schema === "IFC4", `${source.discipline} IFC schema changed.`);
  assert(source.byteLength === asset.byteLength, `${source.discipline} byte count changed.`);
  assert(source.sha256 === asset.sha256, `${source.discipline} digest changed.`);
  assert(
    source.unitScaleToMeters === expected.unitScaleToMeters,
    `${source.discipline} unit scale changed.`,
  );
  assertCounts(
    source.counts,
    {
      triangleCount: expected.triangleCount,
      submittedTriangleCount: expected.submittedTriangleCount,
    },
    source.discipline,
  );
}

assertCounts(
  adapter.counts,
  {
    documentCount: 4,
    part21EntityCount: 482994,
    semanticEntityCount: 14675,
    productCount: 13677,
    occurrenceCount: 13681,
    geometricOccurrenceCount: 5152,
    prototypeCount: 3405,
    geometricPrototypeCount: 3383,
    representationCount: 3383,
    mappedItemCount: 2567,
    representationMapCount: 777,
    reusedGeometryOccurrenceCount: 1769,
    triangleCount: 913520,
    submittedTriangleCount: 2534364,
    vertexCount: 477005,
    propertyValueCount: 273188,
    duplicateGlobalIdCount: 0,
    maxHierarchyDepth: 5,
  },
  "adapter",
);
assert(adapter.sceneIrValidation.ok === true, "Scene IR validation failed.");
assert(
  adapter.sceneIrValidation.errorCount === 0 &&
    adapter.sceneIrValidation.warningCount === 0,
  "Scene IR validation emitted diagnostics.",
);
assert(
  adapter.diagnostics.codes.includes("IFC_EDGE_EXTRACTION_DEFERRED"),
  "Deferred IFC edge limitation is no longer explicit.",
);

assert(
  compiler.schemaVersion === "madi.phase1.compiler-report.1" &&
    compiler.profile === "madi.experimental.gltf.1" &&
    compiler.status === "experimental-not-interchange",
  "Compiler profile changed.",
);
assert(
  compiler.source.sourceDigest === `sha256:${adapter.federation.sourceDigest}` &&
    compiler.source.adapter === "IfcOpenShell 0.8.5",
  "Compiler and adapter source identities differ.",
);
assertCounts(
  compiler.counts,
  {
    prototypeCount: 3405,
    compiledPrototypeCount: 3383,
    occurrenceCount: 13681,
    renderableOccurrenceCount: 5152,
    gltfNodeCount: 13682,
    gltfMeshCount: 6766,
    materialCount: 88,
    triangleCount: 913520,
    edgeSegmentCount: 0,
    targetChunkCount: 45,
  },
  "compiler",
);
assert(
  compiler.output.packageDigest ===
    "a6d5c0eecebf286208e151d281af26e6747e8a163ba3eb4a3b5cfe9353260d5d",
  "Compiled package digest changed.",
);
assert(
  compiler.options.targetChunking === "coalesced-prototype-range-v1" &&
    compiler.options.targetChunkByteBudget === 524288,
  "IFC target range coalescing contract changed.",
);
assert(
  adapter.scene.sha256 === "0f9b1e65d81370c283da4313312568da53a77373dd8f87486bb8b912d8fdaec1" &&
    adapter.scene.byteLength === 81805061,
  "Scene IR evidence changed.",
);

assert(
  evidence.schemaVersion === "madi.ifc-federation-evidence.1",
  "Unknown evidence envelope.",
);
assert(evidence.dataset.id === dataset.id, "Evidence dataset identity changed.");
assert(evidence.dataset.revision === dataset.source.revision, "Evidence revision changed.");
assert(
  evidence.dataset.sourceDigest === adapter.federation.sourceDigest,
  "Evidence source digest changed.",
);
assert(
  evidence.reports.adapter.bytes === adapterBytes.byteLength &&
    evidence.reports.adapter.sha256 === sha256(adapterBytes),
  "Adapter report digest changed.",
);
assert(
  evidence.reports.compiler.bytes === compilerBytes.byteLength &&
    evidence.reports.compiler.sha256 === sha256(compilerBytes),
  "Compiler report digest changed.",
);
assert(
  evidence.package.digest === compiler.output.packageDigest &&
    JSON.stringify(evidence.package.resources) === JSON.stringify(compiler.output.resources),
  "Evidence package identity changed.",
);
assert(
  evidence.khronosValidation.validator === "Khronos glTF Validator" &&
    evidence.khronosValidation.version === "2.0.0-dev.3.10" &&
    evidence.khronosValidation.issues.numErrors === 0 &&
    evidence.khronosValidation.issues.numWarnings === 0,
  "Khronos validation evidence failed or changed.",
);

for (const text of [adapterBytes.toString("utf8"), compilerBytes.toString("utf8")]) {
  assert(!/[A-Za-z]:[\\/]/u.test(text), "Evidence leaks an absolute Windows path.");
  assert(!text.includes("output/external-fixtures"), "Evidence leaks a local cache path.");
}

console.log(
  `[ifc-federation] verified Digital Hub ${compiler.output.packageDigest.slice(0, 12)} ` +
    `(${compiler.counts.renderableOccurrenceCount.toLocaleString("en-US")} renderable ` +
    `occurrences, ${compiler.counts.triangleCount.toLocaleString("en-US")} unique triangles)`,
);
console.log(
  `[ifc-federation] Khronos glTF Validator ${evidence.khronosValidation.version} ` +
    `(0 errors / 0 warnings)`,
);
