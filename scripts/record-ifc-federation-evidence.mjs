import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";

const repositoryRoot = resolve(import.meta.dirname, "..");
const inputDirectory = resolve(repositoryRoot, process.argv[2] ?? "output/ifc/digital-hub");
const artifactDirectory = resolve(
  repositoryRoot,
  process.argv[3] ?? "artifacts/ifc/digital-hub",
);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const [gltfBytes, binary, coarseBinary, adapterReportBytes, buildReportBytes] =
  await Promise.all([
    readFile(resolve(inputDirectory, "scene.gltf")),
    readFile(resolve(inputDirectory, "scene.bin")),
    readFile(resolve(inputDirectory, "coarse.bin")),
    readFile(resolve(inputDirectory, "adapter-report.json")),
    readFile(resolve(inputDirectory, "build-report.json")),
  ]);
const adapterReport = JSON.parse(adapterReportBytes.toString("utf8"));
const buildReport = JSON.parse(buildReportBytes.toString("utf8"));
const resources = new Map(
  buildReport.output.resources.map((resource) => [resource.path, resource]),
);
const resourceBytes = new Map([
  ["scene.gltf", gltfBytes],
  ["scene.bin", binary],
  ["coarse.bin", coarseBinary],
]);

for (const [resourcePath, bytes] of resourceBytes) {
  const resource = resources.get(resourcePath);
  assert(resource, `Build report is missing ${resourcePath}.`);
  assert(resource.bytes === bytes.byteLength, `${resourcePath} byte count changed.`);
  assert(resource.sha256 === sha256(bytes), `${resourcePath} digest changed.`);
}

const packageHash = createHash("sha256")
  .update(gltfBytes)
  .update(binary)
  .update(coarseBinary)
  .digest("hex");
assert(packageHash === buildReport.output.packageDigest, "Package digest changed.");

const officialValidation = await validateBytes(new Uint8Array(gltfBytes), {
  uri: "scene.gltf",
  format: "gltf",
  writeTimestamp: false,
  maxIssues: 100,
  externalResourceFunction: async (uri) => {
    const bytes = resourceBytes.get(uri);
    if (bytes) return new Uint8Array(bytes);
    throw new TypeError(`Unexpected glTF resource ${uri}.`);
  },
});
assert(
  officialValidation.issues.numErrors === 0 &&
    officialValidation.issues.numWarnings === 0,
  "Khronos glTF validation found errors or warnings.",
);
const issueCodes = Object.entries(
  officialValidation.issues.messages.reduce((counts, { code }) => {
    counts[code] = (counts[code] ?? 0) + 1;
    return counts;
  }, {}),
).map(([code, capturedCount]) => ({ code, capturedCount }));

const evidence = {
  schemaVersion: "madi.ifc-federation-evidence.1",
  dataset: {
    id: "ifc-bench-digital-hub",
    revision: "4b37e5d77f12f30dfd7cb7375e15278e1037c808",
    sourceDigest: adapterReport.federation.sourceDigest,
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
    digest: buildReport.output.packageDigest,
    resources: buildReport.output.resources,
  },
  khronosValidation: {
    validator: "Khronos glTF Validator",
    version: gltfValidatorVersion(),
    issues: {
      numErrors: officialValidation.issues.numErrors,
      numWarnings: officialValidation.issues.numWarnings,
      numInfos: officialValidation.issues.numInfos,
      numHints: officialValidation.issues.numHints,
      capturedMessageCount: officialValidation.issues.messages.length,
      codes: issueCodes,
    },
  },
};

await mkdir(artifactDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(artifactDirectory, "adapter-report.json"), adapterReportBytes),
  writeFile(resolve(artifactDirectory, "build-report.json"), buildReportBytes),
  writeFile(
    resolve(artifactDirectory, "validation-report.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  ),
]);

console.log(
  `[ifc-federation] recorded ${adapterReport.counts.documentCount} documents, ` +
    `${buildReport.counts.renderableOccurrenceCount.toLocaleString("en-US")} renderable ` +
    `occurrences, ${buildReport.counts.triangleCount.toLocaleString("en-US")} unique triangles`,
);
console.log(
  `[ifc-federation] Khronos glTF Validator ${gltfValidatorVersion()} ` +
    `(${officialValidation.issues.numErrors} errors / ` +
    `${officialValidation.issues.numWarnings} warnings)`,
);
console.log(`[ifc-federation] package ${buildReport.output.packageDigest}`);
