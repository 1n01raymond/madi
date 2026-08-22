import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";

const fixtures = [
  {
    id: "repeated-fasteners",
    counts: {
      compiledPrototypeCount: 3,
      occurrenceCount: 12,
      renderableOccurrenceCount: 10,
      gltfNodeCount: 13,
      gltfMeshCount: 3,
      triangleCount: 2076,
      edgeSegmentCount: 181,
    },
    reuse: [{ prototypeId: "prototype:part:fastener-01", occurrenceCount: 8 }],
  },
  {
    id: "adafruit-pygamer",
    counts: {
      compiledPrototypeCount: 34,
      occurrenceCount: 87,
      renderableOccurrenceCount: 85,
      gltfNodeCount: 88,
      gltfMeshCount: 34,
      triangleCount: 162838,
      edgeSegmentCount: 13897,
    },
    reuse: [
      { prototypeId: "prototype:part:0603-no-c7", occurrenceCount: 26 },
      { prototypeId: "prototype:part:0805-no-c8", occurrenceCount: 11 },
      { prototypeId: "prototype:part:led3535-led1", occurrenceCount: 5 },
      { prototypeId: "prototype:part:6mm-smt-6mmcap-start", occurrenceCount: 4 },
    ],
  },
];

function path(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function validateFixture(definition) {
  const artifact = (name) => path(`artifacts/phase1/${definition.id}/${name}`);
  const [gltfBytes, binary, report, occtReport, sourceBytes] = await Promise.all([
    readFile(artifact("scene.gltf")),
    readFile(artifact("scene.bin")),
    readFile(artifact("build-report.json"), "utf8").then(JSON.parse),
    readFile(path(`artifacts/occt/${definition.id}.report.json`), "utf8").then(JSON.parse),
    readFile(path(`fixtures/step/${definition.id}.step`)),
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

  const label = `[${definition.id}]`;
  assert(
    report.schemaVersion === "madi.phase1.compiler-report.1",
    `${label} unknown report schema.`,
  );
  assert(report.profile === "madi.experimental.gltf.1", `${label} unknown compiler profile.`);
  assert(
    report.status === "experimental-not-interchange",
    `${label} profile status is not explicit.`,
  );
  assert(
    report.compiler.name === "@madi/compiler" && report.compiler.version === "0.0.0",
    `${label} compiler identity changed.`,
  );
  assert(
    report.options.coordinateSystem === "right-handed-y-up-meters" &&
      report.options.geometryEncoding === "gltf-f32",
    `${label} compiler options changed.`,
  );
  assert(gltf.asset.version === "2.0", `${label} compiled geometry is not glTF 2.0.`);
  assert(!gltf.extensionsRequired, `${label} must not require a custom glTF extension.`);
  assert(
    officialValidation.issues.numErrors === 0 && officialValidation.issues.numWarnings === 0,
    `${label} Khronos validation found errors or warnings.`,
  );
  assert(
    gltf.extras?.madi?.profile === report.profile,
    `${label} glTF and report profiles differ.`,
  );

  const sourceDigest = sha256(sourceBytes);
  assert(occtReport.source.sha256 === sourceDigest, `${label} OCCT source digest changed.`);
  assert(
    report.source.sourceDigest === `sha256:${sourceDigest}`,
    `${label} compiler source digest changed.`,
  );

  const resources = new Map(report.output.resources.map((resource) => [resource.path, resource]));
  const gltfResource = resources.get("scene.gltf");
  const binaryResource = resources.get("scene.bin");
  assert(gltfResource?.bytes === gltfBytes.byteLength, `${label} glTF byte count changed.`);
  assert(gltfResource?.sha256 === sha256(gltfBytes), `${label} glTF digest changed.`);
  assert(binaryResource?.bytes === binary.byteLength, `${label} binary byte count changed.`);
  assert(binaryResource?.sha256 === sha256(binary), `${label} binary digest changed.`);
  const packageDigest = createHash("sha256").update(gltfBytes).update(binary).digest("hex");
  assert(packageDigest === report.output.packageDigest, `${label} package digest changed.`);

  assert(gltf.buffers.length === 1, `${label} expected one external glTF buffer.`);
  assert(gltf.buffers[0].uri === "scene.bin", `${label} glTF buffer must remain external.`);
  assert(gltf.buffers[0].byteLength === binary.byteLength, `${label} glTF buffer length changed.`);
  for (const [index, bufferView] of gltf.bufferViews.entries()) {
    assert(bufferView.buffer === 0, `${label} bufferViews[${index}] references another buffer.`);
    assert(bufferView.byteOffset % 4 === 0, `${label} bufferViews[${index}] is not aligned.`);
    assert(
      bufferView.byteOffset + bufferView.byteLength <= binary.byteLength,
      `${label} bufferViews[${index}] exceeds scene.bin.`,
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
      accessor.count *
      componentBytes.get(accessor.componentType) *
      typeComponents.get(accessor.type);
    assert(
      bufferView && byteLength <= bufferView.byteLength,
      `${label} accessors[${index}] is out of range.`,
    );
  }

  const parents = new Map();
  for (const [nodeIndex, node] of gltf.nodes.entries()) {
    assert(
      !node.matrix || node.matrix.length === 16,
      `${label} nodes[${nodeIndex}] matrix is invalid.`,
    );
    for (const child of node.children ?? []) {
      assert(gltf.nodes[child], `${label} nodes[${nodeIndex}] has an unknown child.`);
      assert(!parents.has(child), `${label} nodes[${child}] has multiple parents.`);
      parents.set(child, nodeIndex);
    }
  }
  const visited = new Set();
  const visit = (nodeIndex) => {
    assert(
      !visited.has(nodeIndex),
      `${label} nodes[${nodeIndex}] is cyclic or multiply referenced.`,
    );
    visited.add(nodeIndex);
    for (const child of gltf.nodes[nodeIndex].children ?? []) visit(child);
  };
  for (const root of gltf.scenes[gltf.scene].nodes) visit(root);
  assert(visited.size === gltf.nodes.length, `${label} not every node is reachable.`);

  for (const expectedReuse of definition.reuse) {
    const nodes = gltf.nodes.filter(
      (node) => node.extras?.madi?.prototypeId === expectedReuse.prototypeId,
    );
    assert(
      nodes.length === expectedReuse.occurrenceCount,
      `${label} ${expectedReuse.prototypeId} occurrence count changed.`,
    );
    assert(
      new Set(nodes.map(({ mesh }) => mesh)).size === 1,
      `${label} ${expectedReuse.prototypeId} does not reuse one mesh.`,
    );
  }
  for (const mesh of gltf.meshes) {
    assert(mesh.primitives.some(({ mode }) => mode === 4), `${label} mesh is missing triangles.`);
    assert(mesh.primitives.some(({ mode }) => mode === 1), `${label} mesh is missing edges.`);
  }

  const triangleCount = gltf.meshes
    .flatMap(({ primitives }) => primitives)
    .filter(({ mode }) => mode === 4)
    .reduce((total, { indices }) => total + gltf.accessors[indices].count / 3, 0);
  const edgeSegmentCount = gltf.meshes
    .flatMap(({ primitives }) => primitives)
    .filter(({ mode }) => mode === 1)
    .reduce((total, { indices }) => total + gltf.accessors[indices].count / 2, 0);
  const observedCounts = { ...report.counts, triangleCount, edgeSegmentCount };
  for (const [key, value] of Object.entries(definition.counts)) {
    assert(observedCounts[key] === value, `${label} ${key} changed.`);
  }

  console.log(
    `[phase1-compiler] verified ${definition.id} ${packageDigest.slice(0, 12)} ` +
      `(${triangleCount.toLocaleString("en-US")} triangles, ` +
      `${edgeSegmentCount.toLocaleString("en-US")} CAD edge segments)`,
  );
}

for (const fixture of fixtures) await validateFixture(fixture);
console.log(
  `[phase1-compiler] Khronos glTF Validator ${gltfValidatorVersion()} ` +
    `(0 errors / 0 warnings across ${fixtures.length} packages)`,
);
