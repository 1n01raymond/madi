import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";

const artifact = (name) =>
  fileURLToPath(new URL(`../artifacts/phase1/repeated-fasteners/${name}`, import.meta.url));
const [gltfBytes, binary, report, occtReport] = await Promise.all([
  readFile(artifact("scene.gltf")),
  readFile(artifact("scene.bin")),
  readFile(artifact("build-report.json"), "utf8").then(JSON.parse),
  readFile(
    fileURLToPath(
      new URL("../artifacts/occt/repeated-fasteners.report.json", import.meta.url),
    ),
    "utf8",
  ).then(JSON.parse),
]);
const gltf = JSON.parse(gltfBytes.toString("utf8"));
const officialValidation = await validateBytes(new Uint8Array(gltfBytes), {
  uri: "scene.gltf",
  format: "gltf",
  writeTimestamp: false,
  maxIssues: 100,
  externalResourceFunction: async (uri) => {
    if (uri !== "scene.bin") throw new TypeError(`Unexpected glTF resource ${uri}.`);
    return new Uint8Array(binary);
  },
});

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

assert(report.schemaVersion === "madi.phase1.compiler-report.1", "Unknown report schema.");
assert(report.profile === "madi.experimental.gltf.1", "Unknown compiler profile.");
assert(report.status === "experimental-not-interchange", "Profile status is not explicit.");
assert(
  report.compiler.name === "@madi/compiler" && report.compiler.version === "0.0.0",
  "Compiler identity changed.",
);
assert(
  report.options.coordinateSystem === "right-handed-y-up-meters" &&
    report.options.geometryEncoding === "gltf-f32",
  "Compiler options changed.",
);
assert(gltf.asset.version === "2.0", "Compiled geometry is not glTF 2.0.");
assert(!gltf.extensionsRequired, "The first slice must not require a custom glTF extension.");
assert(
  officialValidation.issues.numErrors === 0,
  `Khronos glTF Validator found ${officialValidation.issues.numErrors} errors.`,
);
assert(gltf.extras?.madi?.profile === report.profile, "glTF and report profiles differ.");
assert(
  report.source.sourceDigest === `sha256:${occtReport.source.sha256}`,
  "Compiler and OCCT source digests differ.",
);

const resources = new Map(report.output.resources.map((resource) => [resource.path, resource]));
const gltfResource = resources.get("scene.gltf");
const binaryResource = resources.get("scene.bin");
assert(gltfResource?.bytes === gltfBytes.byteLength, "glTF byte count changed.");
assert(gltfResource?.sha256 === sha256(gltfBytes), "glTF digest changed.");
assert(binaryResource?.bytes === binary.byteLength, "Binary byte count changed.");
assert(binaryResource?.sha256 === sha256(binary), "Binary digest changed.");
const packageDigest = createHash("sha256").update(gltfBytes).update(binary).digest("hex");
assert(packageDigest === report.output.packageDigest, "Package digest changed.");

assert(gltf.buffers.length === 1, "Expected one external glTF buffer.");
assert(gltf.buffers[0].uri === "scene.bin", "glTF buffer must remain external.");
assert(gltf.buffers[0].byteLength === binary.byteLength, "glTF buffer length changed.");
for (const [index, bufferView] of gltf.bufferViews.entries()) {
  assert(bufferView.buffer === 0, `bufferViews[${index}] references another buffer.`);
  assert(bufferView.byteOffset % 4 === 0, `bufferViews[${index}] is not aligned.`);
  assert(
    bufferView.byteOffset + bufferView.byteLength <= binary.byteLength,
    `bufferViews[${index}] exceeds scene.bin.`,
  );
}

const componentBytes = new Map([
  [5121, 1],
  [5125, 4],
  [5126, 4],
]);
const typeComponents = new Map([
  ["SCALAR", 1],
  ["VEC3", 3],
]);
for (const [index, accessor] of gltf.accessors.entries()) {
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const byteLength =
    accessor.count * componentBytes.get(accessor.componentType) * typeComponents.get(accessor.type);
  assert(bufferView && byteLength <= bufferView.byteLength, `accessors[${index}] is out of range.`);
}

const parents = new Map();
for (const [nodeIndex, node] of gltf.nodes.entries()) {
  assert(!node.matrix || node.matrix.length === 16, `nodes[${nodeIndex}] matrix is invalid.`);
  for (const child of node.children ?? []) {
    assert(gltf.nodes[child], `nodes[${nodeIndex}] has an unknown child.`);
    assert(!parents.has(child), `nodes[${child}] has multiple parents.`);
    parents.set(child, nodeIndex);
  }
}
const visited = new Set();
const visit = (nodeIndex) => {
  assert(!visited.has(nodeIndex), `nodes[${nodeIndex}] is cyclic or multiply referenced.`);
  visited.add(nodeIndex);
  for (const child of gltf.nodes[nodeIndex].children ?? []) visit(child);
};
for (const root of gltf.scenes[gltf.scene].nodes) visit(root);
assert(visited.size === gltf.nodes.length, "Not every node is reachable from the scene.");

const fasteners = gltf.nodes.filter(
  (node) => node.extras?.madi?.prototypeId === "prototype:part:fastener-01",
);
assert(fasteners.length === 8, "Expected eight fastener occurrences.");
assert(new Set(fasteners.map(({ mesh }) => mesh)).size === 1, "Fasteners do not reuse a mesh.");
for (const mesh of gltf.meshes) {
  assert(mesh.primitives.some(({ mode }) => mode === 4), "Mesh is missing triangles.");
  assert(mesh.primitives.some(({ mode }) => mode === 1), "Mesh is missing explicit edges.");
}

const triangleCount = gltf.meshes
  .flatMap(({ primitives }) => primitives)
  .filter(({ mode }) => mode === 4)
  .reduce((total, { indices }) => total + gltf.accessors[indices].count / 3, 0);
const edgeSegmentCount = gltf.meshes
  .flatMap(({ primitives }) => primitives)
  .filter(({ mode }) => mode === 1)
  .reduce((total, { indices }) => total + gltf.accessors[indices].count / 2, 0);
assert(triangleCount === report.counts.triangleCount, "Triangle count differs from report.");
assert(edgeSegmentCount === report.counts.edgeSegmentCount, "Edge count differs from report.");
assert(gltf.nodes.length === report.counts.gltfNodeCount, "Node count differs from report.");
assert(gltf.meshes.length === report.counts.gltfMeshCount, "Mesh count differs from report.");

console.log(
  `[phase1-compiler] verified glTF 2.0 package ${packageDigest.slice(0, 12)} ` +
    `(${triangleCount} triangles, ${edgeSegmentCount} CAD edge segments)`,
);
console.log(
  `[phase1-compiler] Khronos glTF Validator ${gltfValidatorVersion()} ` +
    `(${officialValidation.issues.numWarnings} warnings)`,
);
