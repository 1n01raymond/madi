import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/ifc/explicit-edges");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[ifc-explicit-edges] ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function accessorValues(gltf, buffers, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  const view = gltf.bufferViews?.[accessor?.bufferView];
  const buffer = buffers[view?.buffer];
  assert(accessor && view && buffer, `Accessor ${String(accessorIndex)} is incomplete.`);
  assert(accessor.type === "SCALAR", `Accessor ${String(accessorIndex)} is not scalar.`);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (accessor.componentType === 5121) {
    return [...buffer.subarray(start, start + accessor.count)];
  }
  assert(
    accessor.componentType === 5125,
    `Accessor ${String(accessorIndex)} has an unexpected component type.`,
  );
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return Array.from({ length: accessor.count }, (_, index) =>
    data.getUint32(start + index * 4, true),
  );
}

function edgeKey(left, right) {
  return left < right ? `${String(left)}:${String(right)}` : `${String(right)}:${String(left)}`;
}

const artifact = (name) => resolve(artifactDirectory, name);
const resources = [
  "scene.gltf",
  "scene.bin",
  "coarse.bin",
  "properties.json",
  "properties.bin",
];
const [fixture, adapter, compiler, ...resourceBytes] = await Promise.all([
  readFile(resolve(repositoryRoot, "fixtures/ifc/explicit-edge-wall.ifc")),
  readFile(artifact("adapter-report.json"), "utf8").then(JSON.parse),
  readFile(artifact("build-report.json"), "utf8").then(JSON.parse),
  ...resources.map((name) => readFile(artifact(name))),
]);
const bytesByName = new Map(
  resources.map((name, index) => [name, resourceBytes[index]]),
);
const gltfBytes = bytesByName.get("scene.gltf");
const sceneBinary = bytesByName.get("scene.bin");
const coarseBinary = bytesByName.get("coarse.bin");
assert(gltfBytes && sceneBinary && coarseBinary, "Compiled package resources are missing.");
const gltf = JSON.parse(gltfBytes.toString("utf8"));

assert(
  sha256(fixture) === "cf15bb336ca6f563ab899bd0d3d5e499529d9523cf5c2275ed161dd42a8f8f28",
  "Fixture digest changed.",
);
assert(adapter.schemaVersion === "naru.ifc-adapter-report.5", "Unknown adapter schema.");
assert(
  adapter.adapter?.name === "IfcOpenShell" && adapter.adapter?.version === "0.8.5",
  "IfcOpenShell identity changed.",
);
assert(
  adapter.federation?.options?.includeEdges === true &&
    adapter.federation.options.edgeMode === "ifcopenshell-opencascade-face-boundaries",
  "Explicit-edge extraction options changed.",
);
assert(
  adapter.scene?.encodingVersion === "naru.ifc-scene-ir-split.4",
  "Unknown split Scene IR transport.",
);
assert(
  adapter.scene.geometry?.byteLength === 592 &&
    adapter.scene.geometry.sha256 ===
      "1a7b29785444fbb3374c13e76739c9c7dc9adcf49282a2587d97b0a11e04aa02",
  "Split edge geometry record changed.",
);
assert(
  adapter.sources?.length === 1 &&
    adapter.sources[0].path === "fixtures/ifc/explicit-edge-wall.ifc" &&
    adapter.sources[0].sha256 === sha256(fixture) &&
    adapter.sources[0].schema === "IFC4" &&
    adapter.sources[0].unitScaleToMeters === 0.001,
  "Fixture source identity changed.",
);
for (const [name, expected] of Object.entries({
  vertexCount: 8,
  triangleCount: 12,
  submittedTriangleCount: 12,
  edgeSegmentCount: 12,
  submittedEdgeSegmentCount: 12,
  geometricPrototypeCount: 1,
  geometricOccurrenceCount: 1,
})) {
  assert(adapter.counts?.[name] === expected, `Adapter ${name} changed.`);
}
assert(
  adapter.diagnostics?.codes?.includes("IFC_EDGE_CLASSIFICATION_BOUNDARY_ONLY") &&
    !adapter.diagnostics.codes.includes("IFC_EDGE_EXTRACTION_DEFERRED"),
  "Edge extraction diagnostic changed.",
);

assert(
  compiler.schemaVersion === "madi.phase1.compiler-report.1" &&
    compiler.profile === "madi.experimental.gltf.1",
  "Compiler report contract changed.",
);
assert(
  compiler.output?.packageDigest ===
    "83ab598070eee6bb77536f8f80d90a3712afde2638c50a5ea5d0d743eab598fc",
  "Compiled package digest changed.",
);
assert(
  compiler.counts?.triangleCount === 12 && compiler.counts?.edgeSegmentCount === 12,
  "Compiler geometry counts changed.",
);
const reportedResources = new Map(
  compiler.output.resources.map((resource) => [resource.path, resource]),
);
for (const [name, bytes] of bytesByName) {
  const reported = reportedResources.get(name);
  assert(reported?.bytes === bytes.byteLength, `${name} byte count changed.`);
  assert(reported?.sha256 === sha256(bytes), `${name} digest changed.`);
}

assert(gltf.asset?.version === "2.0", "Compiled package is not glTF 2.0.");
assert(!gltf.extensionsRequired, "Compiled package requires a custom glTF extension.");
const targetMesh = gltf.meshes?.find((mesh) =>
  mesh.primitives?.some((primitive) => primitive.extras?.madi?.kind === "explicit-cad-edges"),
);
const surface = targetMesh?.primitives?.find((primitive) => primitive.mode === 4);
const edges = targetMesh?.primitives?.find((primitive) => primitive.mode === 1);
assert(surface && edges, "Surface and explicit-edge primitives are not paired.");
assert(
  surface.attributes?.POSITION === edges.attributes?.POSITION,
  "Edges do not reuse the surface position accessor.",
);
const edgeMetadata = edges.extras?.madi;
assert(
  edgeMetadata?.sourceRefs?.length === 2 &&
    edgeMetadata.sourceRefs[1]?.endsWith(":step:21:representation-item"),
  "Edge source representation item changed.",
);

const buffers = [sceneBinary, coarseBinary];
const surfaceIndices = accessorValues(gltf, buffers, surface.indices);
const edgeIndices = accessorValues(gltf, buffers, edges.indices);
const edgeClasses = accessorValues(gltf, buffers, edgeMetadata.edgeClassAccessor);
const edgeSourceIds = accessorValues(gltf, buffers, edgeMetadata.edgeSourceAccessor);
assert(edgeIndices.length === 24, "Expected 12 explicit edge segments.");
assert(edgeClasses.every((value) => value === 0), "Edges are not classified as boundary.");
assert(
  edgeSourceIds.length === 12 && edgeSourceIds.every((value) => value === 1),
  "Edge segments no longer map to IfcExtrudedAreaSolid#21.",
);

const triangleWireframe = new Set();
for (let index = 0; index < surfaceIndices.length; index += 3) {
  const triangle = surfaceIndices.slice(index, index + 3);
  triangleWireframe.add(edgeKey(triangle[0], triangle[1]));
  triangleWireframe.add(edgeKey(triangle[1], triangle[2]));
  triangleWireframe.add(edgeKey(triangle[2], triangle[0]));
}
const explicitEdges = new Set();
for (let index = 0; index < edgeIndices.length; index += 2) {
  explicitEdges.add(edgeKey(edgeIndices[index], edgeIndices[index + 1]));
}
assert(triangleWireframe.size === 18, "Fixture triangle-wireframe control changed.");
assert(explicitEdges.size === 12, "Explicit boundary edge set changed.");
assert(
  [...explicitEdges].every((edge) => triangleWireframe.has(edge)),
  "Explicit edge is not a surface boundary.",
);
assert(
  [...triangleWireframe].filter((edge) => !explicitEdges.has(edge)).length === 6,
  "Triangle face diagonals leaked into explicit edges.",
);

const officialValidation = await validateBytes(new Uint8Array(gltfBytes), {
  uri: "scene.gltf",
  format: "gltf",
  writeTimestamp: false,
  maxIssues: 100,
  externalResourceFunction: async (uri) => {
    const bytes = bytesByName.get(uri);
    if (bytes) return new Uint8Array(bytes);
    throw new TypeError(`Unexpected glTF resource ${uri}.`);
  },
});
assert(
  officialValidation.issues.numErrors === 0 &&
    officialValidation.issues.numWarnings === 0,
  "Khronos glTF validation found errors or warnings.",
);

console.log(
  `[ifc-explicit-edges] verified package ${compiler.output.packageDigest.slice(0, 12)} ` +
    `(12 boundary segments, 6 triangle diagonals excluded; ` +
    `Khronos ${gltfValidatorVersion()} 0 errors / 0 warnings)`,
);
