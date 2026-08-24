import { constants as bufferConstants } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/ifc/digital-hub");
const sixty5Directory = resolve(repositoryRoot, "artifacts/ifc/sixty5");

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
assert(adapter.schemaVersion === "madi.ifc-adapter-report.4", "Unknown adapter report.");
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
    adapter.federation.options.normalizeSceneToMeters === true &&
    adapter.federation.options.propertyMode === "indexed-column-values",
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
    propertyKeyCount: 1656,
    propertySetCount: 279,
    propertyDistinctValueCount: 48649,
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
    "9b98866671eb080fd1a34646b6225d27d1ee55bddecbaad58790d35a344c5f1c",
  "Compiled package digest changed.",
);
assert(
  compiler.options.targetChunking === "coalesced-prototype-range-v1" &&
    compiler.options.targetChunkByteBudget === 524288,
  "IFC target range coalescing contract changed.",
);
// The compiled package carries the property sidecar: properties.json is the
// madi.package-properties.1 semantic index and properties.bin is the adapter
// column file byte for byte.
assert(
  compiler.options.propertiesUri === "properties.json" &&
    compiler.options.propertiesBinaryUri === "properties.bin",
  "Property sidecar resource URIs changed.",
);
const propertySidecarBinary = compiler.output.resources.find(
  ({ path }) => path === "properties.bin",
);
assert(
  compiler.output.resources.some(({ path }) => path === "properties.json") &&
    propertySidecarBinary?.bytes === adapter.scene.properties.byteLength &&
    propertySidecarBinary?.sha256 === adapter.scene.properties.sha256,
  "Package property columns no longer match the adapter column file.",
);
assert(
  adapter.scene.encodingVersion === "madi.ifc-scene-ir-split.3",
  "Scene IR transport encoding changed.",
);
// Property indexing (split.2) interned key strings into the scene-level
// propertyIndex, shrinking the structure from 39,135,637 bytes (split.1) to
// 30,592,935 bytes; property value columns (split.3) moved the values into
// the binary column file and shrank the structure again.
assert(
  adapter.scene.structure.sha256 ===
    "1d838a03785899a94d5eddd04eaa57c79a956c99c0c9cb601d524778ded5655f" &&
    adapter.scene.structure.byteLength === 26235818,
  "Scene IR structure evidence changed.",
);
assert(
  adapter.scene.geometry.sha256 ===
    "247ae94d95883b1b65c5cc00e35048379fb8adbb22999cee9a13858945e84c2b" &&
    adapter.scene.geometry.byteLength === 28134848,
  "Scene IR geometry evidence changed.",
);
assert(
  adapter.scene.properties.sha256 ===
    "712fea65ca4b9de75683a01ee79f4fff5ae6f89b0c29cbd0b38a83bb586d07c1" &&
    adapter.scene.properties.byteLength === 2260991,
  "Scene IR property column evidence changed.",
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


// The real-large federation now carries end-to-end compile evidence: its
// structure document is still larger than one JavaScript string, and the
// compiler streams it record by record into the same compiled-package contract
// the Digital Hub record proves.
const [sixty5Bytes, sixty5CompilerBytes, sixty5Evidence] = await Promise.all([
  readFile(resolve(sixty5Directory, "adapter-report.json")),
  readFile(resolve(sixty5Directory, "build-report.json")),
  readFile(resolve(sixty5Directory, "validation-report.json"), "utf8").then(JSON.parse),
]);
const sixty5 = JSON.parse(sixty5Bytes.toString("utf8"));
const sixty5Compiler = JSON.parse(sixty5CompilerBytes.toString("utf8"));
const sixty5Dataset = manifest.datasets.find(({ id }) => id === "ifc-bench-sixty5");

assert(sixty5Dataset?.status === "qualified", "sixty5 fixture is not qualified.");
assert(sixty5Dataset.tier === "real-large", "sixty5 fixture tier changed.");
assert(sixty5Dataset.source.license === "CC-BY-4.0", "sixty5 source license changed.");
assert(
  sixty5Dataset.source.revision === "4b37e5d77f12f30dfd7cb7375e15278e1037c808",
  "sixty5 source revision changed.",
);
assert(sixty5.schemaVersion === "madi.ifc-adapter-report.4", "Unknown sixty5 adapter report.");
assert(
  sixty5.federation.options.propertyMode === "indexed-column-values",
  "sixty5 property transport mode changed.",
);
assert(
  sixty5.adapter.name === "IfcOpenShell" && sixty5.adapter.version === "0.8.5",
  "sixty5 IfcOpenShell evidence version changed.",
);
assert(
  sixty5.federation.sourceDigest ===
    "e334c6a9295a0adbf8ffbb15c61ea05c47b0135a319ee370f853bb9a36d21dec",
  "sixty5 federation source digest changed.",
);
assert(
  JSON.stringify(sixty5.federation.documentOrder) ===
    JSON.stringify([
      "architecture",
      "electrical",
      "facade",
      "kitchen",
      "plumbing",
      "structure",
      "ventilation",
    ]),
  "sixty5 federation document order changed.",
);
assert(
  sixty5.sources.length === sixty5Dataset.assets.length,
  "sixty5 source document count changed.",
);
for (const source of sixty5.sources) {
  const asset = sixty5Dataset.assets.find(({ discipline }) => discipline === source.discipline);
  assert(asset, `Unknown sixty5 discipline ${source.discipline}.`);
  assert(
    source.path === `projects/sixty5/${asset.path}`,
    `sixty5 ${source.discipline} URI changed.`,
  );
  assert(source.schema === "IFC2X3", `sixty5 ${source.discipline} IFC schema changed.`);
  assert(source.byteLength === asset.byteLength, `sixty5 ${source.discipline} byte count changed.`);
  assert(source.sha256 === asset.sha256, `sixty5 ${source.discipline} digest changed.`);
}
assertCounts(
  sixty5.counts,
  {
    documentCount: 7,
    part21EntityCount: 11376756,
    semanticEntityCount: 192316,
    occurrenceCount: 188319,
    geometricOccurrenceCount: 78173,
    prototypeCount: 42469,
    geometricPrototypeCount: 42435,
    mappedItemCount: 38812,
    reusedGeometryOccurrenceCount: 35738,
    submittedTriangleCount: 40310966,
    triangleCount: 4866386,
    vertexCount: 2596268,
    propertyValueCount: 4503078,
    propertyKeyCount: 35510,
    propertySetCount: 299,
    propertyDistinctValueCount: 488526,
    duplicateGlobalIdCount: 0,
  },
  "sixty5 adapter",
);
assert(
  sixty5.scene.encodingVersion === "madi.ifc-scene-ir-split.3",
  "sixty5 Scene IR transport encoding changed.",
);
// Property indexing (split.2) shrank the structure from the split.1 record's
// 631,943,761 bytes (sha256 c82f2dd2…) to 419,502,749 bytes; property value
// columns (split.3) then moved the values into the binary column file and
// shrank it to 345,472,410 bytes. The split.1 structure exceeded V8's
// 536,870,888-byte string limit; that boundary crossing is preserved as
// history in the E1.9 record at commit 41e6973 and the streaming reader still
// protects the compiler if a future federation crosses it again.
assert(
  sixty5.scene.structure.sha256 ===
    "4aece038a4c983036a0b83af3027956a28eb902ac9f348d37974aceaa8fd3709" &&
    sixty5.scene.structure.byteLength === 345472410,
  "sixty5 Scene IR structure evidence changed.",
);
assert(
  sixty5.scene.geometry.sha256 ===
    "d4960401750f7e67b9c0387c846636e7d63e4bdba099e78886f0bf439d9a8d0d" &&
    sixty5.scene.geometry.byteLength === 151864848,
  "sixty5 Scene IR geometry evidence changed.",
);
assert(
  sixty5.scene.properties.sha256 ===
    "dad8d98909c738df930569c4b907c29e64cda2b65d84917936c1c4d86d3dd8c4" &&
    sixty5.scene.properties.byteLength === 31179862,
  "sixty5 Scene IR property column evidence changed.",
);
assert(
  sixty5.scene.structure.byteLength < bufferConstants.MAX_STRING_LENGTH,
  "sixty5 structure exceeds one string again; restate the streaming-reader boundary claim.",
);
assert(sixty5.sceneIrValidation.ok === true, "sixty5 Scene IR validation failed.");
assert(
  sixty5.sceneIrValidation.errorCount === 0 && sixty5.sceneIrValidation.warningCount === 0,
  "sixty5 Scene IR validation emitted diagnostics.",
);
assert(
  sixty5.diagnostics.codes.includes("IFC_EDGE_EXTRACTION_DEFERRED"),
  "sixty5 deferred IFC edge limitation is no longer explicit.",
);
assert(
  sixty5.diagnostics.codes.includes("IFC_DEGENERATE_PLACEMENT"),
  "sixty5 degenerate-placement diagnostic is no longer explicit.",
);
assertCounts(
  sixty5.diagnostics.counts,
  { info: 1, warning: 56 },
  "sixty5 diagnostics",
);

assert(
  sixty5Compiler.schemaVersion === "madi.phase1.compiler-report.1" &&
    sixty5Compiler.profile === "madi.experimental.gltf.1" &&
    sixty5Compiler.status === "experimental-not-interchange",
  "sixty5 compiler profile changed.",
);
assert(
  sixty5Compiler.source.sourceDigest === `sha256:${sixty5.federation.sourceDigest}` &&
    sixty5Compiler.source.adapter === "IfcOpenShell 0.8.5",
  "sixty5 compiler and adapter source identities differ.",
);
assertCounts(
  sixty5Compiler.counts,
  {
    prototypeCount: 42469,
    compiledPrototypeCount: 42435,
    occurrenceCount: 188319,
    renderableOccurrenceCount: 78173,
    gltfNodeCount: 188320,
    gltfMeshCount: 84870,
    materialCount: 318,
    triangleCount: 4866386,
    edgeSegmentCount: 0,
    targetChunkCount: 234,
  },
  "sixty5 compiler",
);
assert(
  sixty5Compiler.output.packageDigest ===
    "a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347",
  "sixty5 compiled package digest changed.",
);
assert(
  sixty5Compiler.options.targetChunking === "coalesced-prototype-range-v1" &&
    sixty5Compiler.options.targetChunkByteBudget === 524288,
  "sixty5 target range coalescing contract changed.",
);
assert(
  sixty5Compiler.options.propertiesUri === "properties.json" &&
    sixty5Compiler.options.propertiesBinaryUri === "properties.bin",
  "sixty5 property sidecar resource URIs changed.",
);
const sixty5SidecarBinary = sixty5Compiler.output.resources.find(
  ({ path }) => path === "properties.bin",
);
assert(
  sixty5Compiler.output.resources.some(({ path }) => path === "properties.json") &&
    sixty5SidecarBinary?.bytes === sixty5.scene.properties.byteLength &&
    sixty5SidecarBinary?.sha256 === sixty5.scene.properties.sha256,
  "sixty5 package property columns no longer match the adapter column file.",
);

assert(
  sixty5Evidence.schemaVersion === "madi.ifc-federation-evidence.1",
  "Unknown sixty5 evidence envelope.",
);
assert(
  sixty5Evidence.dataset.id === sixty5Dataset.id &&
    sixty5Evidence.dataset.revision === sixty5Dataset.source.revision &&
    sixty5Evidence.dataset.sourceDigest === sixty5.federation.sourceDigest,
  "sixty5 evidence dataset identity changed.",
);
assert(
  sixty5Evidence.reports.adapter.bytes === sixty5Bytes.byteLength &&
    sixty5Evidence.reports.adapter.sha256 === sha256(sixty5Bytes),
  "sixty5 adapter report digest changed.",
);
assert(
  sixty5Evidence.reports.compiler.bytes === sixty5CompilerBytes.byteLength &&
    sixty5Evidence.reports.compiler.sha256 === sha256(sixty5CompilerBytes),
  "sixty5 compiler report digest changed.",
);
assert(
  sixty5Evidence.package.digest === sixty5Compiler.output.packageDigest &&
    JSON.stringify(sixty5Evidence.package.resources) ===
      JSON.stringify(sixty5Compiler.output.resources),
  "sixty5 evidence package identity changed.",
);
assert(
  sixty5Evidence.khronosValidation.validator === "Khronos glTF Validator" &&
    sixty5Evidence.khronosValidation.version === "2.0.0-dev.3.10" &&
    sixty5Evidence.khronosValidation.issues.numErrors === 0 &&
    sixty5Evidence.khronosValidation.issues.numWarnings === 0,
  "sixty5 Khronos validation evidence failed or changed.",
);
for (const text of [
  adapterBytes.toString("utf8"),
  compilerBytes.toString("utf8"),
  sixty5Bytes.toString("utf8"),
  sixty5CompilerBytes.toString("utf8"),
]) {
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
console.log(
  `[ifc-federation] verified sixty5 ${sixty5Compiler.output.packageDigest.slice(0, 12)} ` +
    `(${sixty5Compiler.counts.renderableOccurrenceCount.toLocaleString("en-US")} renderable ` +
    `occurrences, ${sixty5Compiler.counts.triangleCount.toLocaleString("en-US")} unique ` +
    `triangles) from a ${sixty5.scene.structure.byteLength.toLocaleString("en-US")}-byte ` +
    `indexed structure (${sixty5.counts.propertyKeyCount.toLocaleString("en-US")} keys / ` +
    `${sixty5.counts.propertySetCount.toLocaleString("en-US")} key-sets)`,
);
