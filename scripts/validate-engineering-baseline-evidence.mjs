import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/ifc/engineering-baseline");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[engineering-baseline] ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertJson(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

const [manifestBytes, fixtureEvidence, adapterBytes, compilerBytes, evidence] = await Promise.all([
  readFile(resolve(repositoryRoot, "fixtures/external/manifest.json")),
  readFile(
    resolve(repositoryRoot, "artifacts/fixtures/external/sixty5-engineering.json"),
    "utf8",
  ).then(JSON.parse),
  readFile(resolve(artifactDirectory, "adapter-report.json")),
  readFile(resolve(artifactDirectory, "build-report.json")),
  readFile(resolve(artifactDirectory, "validation-report.json"), "utf8").then(JSON.parse),
]);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const adapter = JSON.parse(adapterBytes.toString("utf8"));
const compiler = JSON.parse(compilerBytes.toString("utf8"));

const expectedManifestSha256 =
  "77d7d587d6b32938a371325e281a4584e10c2ff3118a59f300a9da097eb2f478";
assert(sha256(manifestBytes) === expectedManifestSha256, "fixture manifest digest changed");
assert(evidence.manifestSha256 === expectedManifestSha256, "evidence manifest digest changed");

const designDataset = manifest.datasets.find(({ id }) => id === "ifc-bench-sixty5");
const engineeringDataset = manifest.datasets.find(({ id }) => id === "sixty5-engineering");
assert(designDataset?.status === "qualified", "sixty5 Design fixture is not qualified");
assert(engineeringDataset?.status === "qualified", "sixty5 Engineering fixture is not qualified");
assert(
  designDataset.source.revision === "4b37e5d77f12f30dfd7cb7375e15278e1037c808" &&
    designDataset.source.license === "CC-BY-4.0",
  "sixty5 Design provenance changed",
);
assert(
  engineeringDataset.source.revision === "7ddf57a201f88a0c213d5322b02ed15e94a60a40" &&
    engineeringDataset.source.license === "CC-BY-4.0" &&
    engineeringDataset.assets.length === 34 &&
    engineeringDataset.expectedDownloadBytes === 654_076_269,
  "sixty5 Engineering provenance or source census changed",
);
assert(
  engineeringDataset.download.provider === "trimble-connect-public-share" &&
    engineeringDataset.download.projectId === "Z4ehtcBhI_g" &&
    engineeringDataset.download.revisionPolicy === "content-digest-only",
  "sixty5 Engineering resolver contract changed",
);
assert(
  fixtureEvidence.schemaVersion === "1.0" &&
    fixtureEvidence.manifestSha256 === expectedManifestSha256 &&
    fixtureEvidence.dataset.id === "sixty5-engineering" &&
    fixtureEvidence.dataset.revision === "7ddf57a201f88a0c213d5322b02ed15e94a60a40" &&
    fixtureEvidence.dataset.license === "CC-BY-4.0",
  "sixty5 Engineering fixture evidence identity changed",
);
assertJson(
  fixtureEvidence.summary,
  {
    fileCount: 34,
    byteLength: 654_076_269,
    entityCount: 11_892_551,
    allEnvelopesValid: true,
  },
  "sixty5 Engineering source census changed",
);
assert(fixtureEvidence.files.length === 34, "Engineering fixture file census changed");
for (const file of fixtureEvidence.files) {
  const asset = engineeringDataset.assets.find(({ id }) => id === file.id);
  assert(
    asset &&
      file.fileName === asset.path &&
      file.byteLength === asset.byteLength &&
      file.sha256 === asset.sha256 &&
      file.part21.envelopeValid === true &&
      JSON.stringify(file.part21.schemas) === JSON.stringify(["IFC2X3"]),
    `Engineering fixture evidence ${file.id} changed`,
  );
}

assert(
  evidence.schemaVersion === "naru.engineering-baseline-evidence.1" &&
    evidence.status === "qualified-package-not-yet-published",
  "evidence envelope changed",
);
assertJson(evidence.toolchain, {
  adapter: {
    geometryLibrary: "opencascade",
    name: "IfcOpenShell",
    version: "0.8.5",
  },
  sceneIrEncoding: "naru.ifc-scene-ir-split.4",
  compiler: {
    name: "@madi/compiler",
    version: "0.0.0",
    generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
  },
  gltfValidator: "2.0.0-dev.3.10",
}, "evidence toolchain changed");
assertJson(evidence.host, {
  node: "25.2.1",
  platform: "darwin",
  architecture: "arm64",
  release: "24.6.0",
  cpu: "Apple M4 Pro",
  logicalCpuCount: 14,
  totalMemoryBytes: 51_539_607_552,
}, "recording host changed");
assertJson(
  evidence.datasets,
  [
    {
      id: "ifc-bench-sixty5",
      name: "IFC-Bench sixty5 multi-discipline federation",
      revision: "4b37e5d77f12f30dfd7cb7375e15278e1037c808",
      license: "CC-BY-4.0",
      licenseUrl:
        "https://github.com/buildingSMART-community/Community-Sample-Test-Files/blob/7ddf57a201f88a0c213d5322b02ed15e94a60a40/IFC%202.3.0.1%20(IFC%202x3)/SDK%20-%20S1/README.md#license",
      attribution:
        "Stam + De Koning; Selahattin Dülger; buildingSMART Community; IFC-Bench mirror",
    },
    {
      id: "sixty5-engineering",
      name: "SDK-S1 sixty5 Engineering federation",
      revision: "7ddf57a201f88a0c213d5322b02ed15e94a60a40",
      license: "CC-BY-4.0",
      licenseUrl:
        "https://github.com/buildingSMART-community/Community-Sample-Test-Files/blob/7ddf57a201f88a0c213d5322b02ed15e94a60a40/IFC%202.3.0.1%20(IFC%202x3)/SDK%20-%20S1/README.md#license",
      attribution: "Stam + De Koning; Selahattin Dülger; buildingSMART Community",
    },
  ],
  "evidence dataset identity changed",
);
assert(
  evidence.selection.policy === "sixty5-design-plus-complete-geelen-aarts-cohort-v1" &&
    evidence.selection.sha256 ===
      "9d02e0efaf2f47c2e9f7b9cdb38a58ea78abcb0763c0cd4d3b02c828ea6834a7" &&
    evidence.selection.documentCount === 31 &&
    evidence.selection.sourceBytes === 899_467_071 &&
    evidence.selection.documents.length === 31,
  "fixed 31-document selection changed",
);
assert(
  sha256(Buffer.from(JSON.stringify(evidence.selection.documents))) ===
    evidence.selection.sha256,
  "selection identity does not match its documents",
);
assert(
  evidence.selection.documents.filter(({ datasetId }) => datasetId === "ifc-bench-sixty5")
    .length === 7 &&
    evidence.selection.documents.filter(({ datasetId }) => datasetId === "sixty5-engineering")
      .length === 24,
  "Design/Engineering cohort split changed",
);
assertJson(
  evidence.toolchain,
  {
    adapter: {
      geometryLibrary: "opencascade",
      name: "IfcOpenShell",
      version: "0.8.5",
    },
    sceneIrEncoding: "naru.ifc-scene-ir-split.4",
    compiler: {
      name: "@madi/compiler",
      version: "0.0.0",
      generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
    },
    gltfValidator: "2.0.0-dev.3.10",
  },
  "evidence toolchain changed",
);

assert(
  adapter.schemaVersion === "naru.ifc-adapter-report.6" &&
    adapter.adapter.name === "IfcOpenShell" &&
    adapter.adapter.version === "0.8.5" &&
    adapter.adapter.geometryLibrary === "opencascade",
  "adapter identity changed",
);
assert(
  adapter.federation.sourceDigest ===
    "005cd2fe73ef75093cf5e77b4d4fc078a391eec902d31e2b7c9e2e357e689f16",
  "federation source digest changed",
);
assertJson(
  adapter.federation.options,
  {
    edgeMode: "ifcopenshell-opencascade-face-boundaries",
    geometryLibrary: "opencascade",
    includeEdges: true,
    includeSurfaces: true,
    normalizeSceneToMeters: true,
    propertyMode: "indexed-column-values",
    useWorldCoordinates: false,
    weldVertices: true,
  },
  "adapter options changed",
);
assert(adapter.sources.length === 31, "adapter source count changed");
assertJson(
  adapter.federation.documentOrder,
  evidence.selection.documents.map(({ discipline }) => discipline).sort(),
  "adapter document order changed",
);
for (const document of evidence.selection.documents) {
  const source = adapter.sources.find(({ discipline }) => discipline === document.discipline);
  assert(source, `adapter source ${document.discipline} is missing`);
  assert(
    source.path === document.uriHint &&
      source.byteLength === document.byteLength &&
      source.sha256 === document.sha256 &&
      source.schema === "IFC2X3" &&
      source.unitScaleToMeters === 0.001,
    `adapter source ${document.discipline} changed`,
  );
}

const expectedAdapterCounts = {
  documentCount: 31,
  duplicateGlobalIdCount: 0,
  edgeSegmentCount: 5_598_195,
  geometricOccurrenceCount: 104_337,
  geometricPrototypeCount: 66_396,
  mappedItemCount: 39_132,
  maxHierarchyDepth: 5,
  occurrenceCount: 268_001,
  part21EntityCount: 12_339_886,
  productCount: 267_970,
  propertyDistinctValueCount: 623_153,
  propertyKeyCount: 35_630,
  propertySetCount: 313,
  propertyValueCount: 4_806_296,
  prototypeCount: 66_611,
  representationCount: 66_396,
  representationMapCount: 45_647,
  reusedGeometryOccurrenceCount: 37_941,
  semanticEntityCount: 272_085,
  submittedEdgeSegmentCount: 50_324_345,
  submittedTriangleCount: 46_059_890,
  triangleCount: 10_394_938,
  vertexCount: 5_311_895,
};
assertJson(adapter.counts, expectedAdapterCounts, "adapter counts changed");
assert(
  adapter.sceneIrValidation.ok === true &&
    adapter.sceneIrValidation.errorCount === 0 &&
    adapter.sceneIrValidation.warningCount === 0,
  "Scene IR validation changed",
);
assertJson(
  adapter.diagnostics,
  {
    codes: ["IFC_DEGENERATE_PLACEMENT", "IFC_EDGE_CLASSIFICATION_BOUNDARY_ONLY"],
    counts: { info: 1, warning: 56 },
  },
  "adapter diagnostics changed",
);
assertJson(
  adapter.scene,
  {
    encodingVersion: "naru.ifc-scene-ir-split.4",
    geometry: {
      byteLength: 389_006_624,
      sha256: "1d3ecb784907cbb3fa095d4af34a983390c942d5212addbc9f2a93e09d07bec8",
    },
    properties: {
      byteLength: 37_308_484,
      sha256: "03fc3ead3b0b133bb1b6860946a21864529e7426227a17752d54d1ff42ef4747",
    },
    structure: {
      byteLength: 544_042_270,
      sha256: "3e505f691cb577e2bb6bb678d792773e23b57ed822a94b005c10beff758e11f8",
    },
  },
  "split Scene IR resources changed",
);

assert(
  compiler.schemaVersion === "madi.phase1.compiler-report.1" &&
    compiler.profile === "madi.experimental.gltf.1" &&
    compiler.status === "experimental-not-interchange",
  "compiler report profile changed",
);
assert(
  compiler.source.sourceDigest === `sha256:${adapter.federation.sourceDigest}` &&
    compiler.source.optionsDigest ===
      "sha256:809e8ea555dea32be53fe4268e0831ca6d1bc43079333c78b2e521150758f79f",
  "compiler source identity changed",
);
assertJson(
  compiler.options,
  {
    binaryUri: "scene.bin",
    coarseBinaryUri: "coarse.bin",
    propertiesUri: "properties.json",
    propertiesBinaryUri: "properties.bin",
    coordinateSystem: "right-handed-y-up-meters",
    geometryEncoding: "gltf-f32",
    jsonFormatting: "compact",
    resourceNames: "omitted",
    progressiveRepresentation: "prototype-aabb-v1",
    targetChunking: "coalesced-prototype-range-v1",
    targetChunkByteBudget: 524_288,
    targetPayloadOrder: "spatial-leaf-anchor-v1",
  },
  "compiler options changed",
);
assertJson(
  compiler.counts,
  {
    prototypeCount: 66_611,
    compiledPrototypeCount: 66_396,
    occurrenceCount: 268_001,
    renderableOccurrenceCount: 104_337,
    gltfNodeCount: 268_002,
    gltfMeshCount: 132_792,
    materialCount: 422,
    triangleCount: 10_394_938,
    edgeSegmentCount: 5_598_195,
    targetChunkCount: 626,
  },
  "compiler counts changed",
);

const expectedResources = [
  {
    path: "scene.gltf",
    mediaType: "model/gltf+json",
    bytes: 405_570_167,
    sha256: "13a8160b7a371e06ffbe454596ddf050e11d405feaaacaf2d7d43cef9c746930",
  },
  {
    path: "scene.bin",
    mediaType: "application/octet-stream",
    bytes: 325_019_652,
    sha256: "3f78235d58181f10a241e5b30302595761534c713d15e70e7eb92f51a2062e3b",
  },
  {
    path: "coarse.bin",
    mediaType: "application/octet-stream",
    bytes: 60_553_152,
    sha256: "b5e245dc909e6c45115078726f26114730a8e1b35758a3107eac4f92b8f42f85",
  },
  {
    path: "spatial.bin",
    mediaType: "application/octet-stream",
    bytes: 1_217_288,
    sha256: "d614f2e6880dd171f0658184a3e09af72809225262053f8597e81fd07a872f53",
  },
  {
    path: "properties.json",
    mediaType: "application/json",
    bytes: 24_778_000,
    sha256: "fb5342589c1ac08fba0c0bed7a00784106baa6fa2776d3f59ae1dea67aa4cd79",
  },
  {
    path: "properties.bin",
    mediaType: "application/octet-stream",
    bytes: 37_308_484,
    sha256: "03fc3ead3b0b133bb1b6860946a21864529e7426227a17752d54d1ff42ef4747",
  },
];
assert(
  compiler.output.packageDigest ===
    "6d23bffd6632345f8b2714684abbbb3b68ef59158beee4474b87b381f4df9acf",
  "compiled package digest changed",
);
assertJson(compiler.output.resources, expectedResources, "compiled package resources changed");

assertJson(evidence.counts, {
  occurrenceCount: 268_001,
  geometricOccurrenceCount: 104_337,
  geometricPrototypeCount: 66_396,
  submittedTriangleCount: 46_059_890,
  triangleCount: 10_394_938,
  edgeSegmentCount: 5_598_195,
  submittedEdgeSegmentCount: 50_324_345,
}, "evidence counts changed");
assertJson(evidence.gate, {
  geometricOccurrenceCount: { minimum: 100_000, measured: 104_337 },
  submittedTriangleCount: { minimum: 10_000_000, measured: 46_059_890 },
  geometricPrototypeCount: { minimum: 10_000, measured: 66_396 },
  passed: true,
}, "engineering-scale gate changed");
assertJson(evidence.spatialDemandIndex, {
  schemaVersion: "naru.spatial-demand-index.1",
  nodeCount: 4_095,
  leafCount: 2_048,
  occurrenceCount: 104_337,
  chunkReferenceCount: 21_922,
  maxDepth: 11,
  leafCapacity: 64,
  rootBoundsMeters: {
    minimum: [-2.2400381565093994, -30.399999618530273, -62.0700503502861],
    maximum: [42.28521084799495, 57.900001525878906, 0.5],
  },
}, "spatial-demand index census changed");
assert(
  evidence.reports.adapter.bytes === 70_814 &&
    evidence.reports.adapter.sha256 ===
      "fa1cb3fe28592c2906bb06420f34dc009ae077cbea4899b4e7e5c7e0a4fbe17c" &&
    evidence.reports.adapter.bytes === adapterBytes.byteLength &&
    evidence.reports.adapter.sha256 === sha256(adapterBytes),
  "adapter report identity changed",
);
assert(
  evidence.reports.compiler.bytes === 157_882 &&
    evidence.reports.compiler.sha256 ===
      "fd4078e66e5c69792c56e9aad02b59e827724ea24034bb6e1110e97d5c6eca5c" &&
    evidence.reports.compiler.bytes === compilerBytes.byteLength &&
    evidence.reports.compiler.sha256 === sha256(compilerBytes),
  "compiler report identity changed",
);
assert(
  evidence.package.digest === compiler.output.packageDigest &&
    evidence.package.totalBytes === 854_446_743 &&
    evidence.package.documentStringLimitBytes === 536_870_888 &&
    evidence.package.publicUrl === null,
  "evidence package boundary changed",
);
assertJson(evidence.package.resources, expectedResources, "evidence resources changed");
assert(expectedResources[0].bytes < evidence.package.documentStringLimitBytes, "glTF JSON limit failed");
assert(
  evidence.khronosValidation.validator === "Khronos glTF Validator" &&
  evidence.khronosValidation.version === "2.0.0-dev.3.10" &&
    evidence.khronosValidation.issues.numErrors === 0 &&
    evidence.khronosValidation.issues.numWarnings === 0 &&
    evidence.khronosValidation.issues.numInfos === 100 &&
    evidence.khronosValidation.issues.numHints === 0,
  "Khronos validation is not clean",
);
assert(
  evidence.limitations.some((value) => value.includes("not yet been published")) &&
    evidence.limitations.some((value) => value.includes("West Riverside Hospital is excluded")) &&
    evidence.limitations.some((value) => value.includes("CadQuarry is tracked separately")),
  "scope limitations changed",
);

console.log(
  "[engineering-baseline] verified 31 documents / 104,337 renderable occurrences / " +
    "66,396 geometric prototypes / 46,059,890 submitted triangles",
);
console.log(
  "[engineering-baseline] package 6d23bffd6632345f8b2714684abbbb3b68ef59158beee4474b87b381f4df9acf " +
    "(2,048 spatial leaves; Khronos 0 errors / 0 warnings; public delivery pending)",
);
