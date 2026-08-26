import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const insideRepository = (value, label) => {
  const path = resolve(repositoryRoot, value);
  const fromRoot = relative(repositoryRoot, path);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new TypeError(`${label} must remain inside the repository.`);
  }
  return path;
};
const compatibilityPath = insideRepository(
  argument(
    "--compatibility",
    "output/browser-digital-hub-spatial-compatibility/browser-residency.json",
  ),
  "Compatibility browser record",
);
const leafAnchorPath = insideRepository(
  argument(
    "--leaf-anchor",
    "output/browser-digital-hub-spatial-leaf-anchor/browser-residency.json",
  ),
  "Leaf-anchor browser record",
);
const packingPath = insideRepository(
  argument("--packing", "artifacts/spatial-demand/digital-hub-packing.json"),
  "Packing evidence",
);
const outputPath = insideRepository(
  argument("--output", "output/ifc/digital-hub-spatial-analysis/browser-comparison.json"),
  "Browser comparison output",
);
const [compatibility, leafAnchor, packing] = await Promise.all([
  readFile(compatibilityPath, "utf8").then(JSON.parse),
  readFile(leafAnchorPath, "utf8").then(JSON.parse),
  readFile(packingPath, "utf8").then(JSON.parse),
]);
const assert = (condition, message) => {
  if (!condition) throw new Error(`[spatial-ifc-browser] ${message}`);
};
for (const [label, record] of [["compatibility", compatibility], ["leaf-anchor", leafAnchor]]) {
  assert(record.schemaVersion === "madi.ifc-browser-residency.2", `${label} schema changed.`);
  assert(record.browser.id === "chrome" && record.browser.headless === false, `${label} was not headed Chrome.`);
  assert(record.host.platform === "darwin" && record.host.architecture === "arm64", `${label} host changed.`);
  assert(record.consoleIssues.length === 0, `${label} emitted browser issues.`);
  assert(record.snapshot.statusState === "ready", `${label} did not reach ready.`);
  assert(record.snapshot.dataset.targetSchedulerMode === "spatial-bvh-v1", `${label} did not use the spatial scheduler.`);
  assert(record.semanticProperties.state === "resolved", `${label} did not resolve properties.`);
}
assert(
  compatibility.source.packageDigest === packing.compatibility.packageDigest,
  "Compatibility browser/package digest mismatch.",
);
assert(
  leafAnchor.source.packageDigest === packing.spatialLeafAnchor.packageDigest,
  "Leaf-anchor browser/package digest mismatch.",
);
assert(
  compatibility.picking.selectedObjectId === leafAnchor.picking.selectedObjectId,
  "Browser comparison picked different objects.",
);
const summarize = (record) => {
  const dataset = record.snapshot.dataset;
  return {
    capturedAt: record.capturedAt,
    packageDigest: record.source.packageDigest,
    milestones: record.milestones,
    targetChunkCount: Number(dataset.targetChunksTotal),
    targetChunksReady: Number(dataset.targetChunksReady),
    targetSchedulerRequests: Number(dataset.targetSchedulerRequests),
    targetRangeResponses: record.binaryRequests.filter(
      ({ resource, status, range }) => resource === "scene.bin" && status === 206 && range,
    ).length,
    spatialNodesVisited: Number(dataset.spatialNodesVisited),
    spatialLeavesVisible: Number(dataset.spatialLeavesVisible),
    spatialOccurrencesTested: Number(dataset.spatialOccurrencesTested),
    spatialCandidateChunks: Number(dataset.spatialCandidateChunks),
    decodeTime: record.snapshot.decodeTime,
    residentDecodedBytes: Number(dataset.residentDecodedBytes),
    residentGpuBytes: Number(dataset.residentGpuBytes),
    selectedObjectId: record.picking.selectedObjectId,
    propertyEntryCount: record.semanticProperties.entryCount,
  };
};
const comparison = {
  schemaVersion: "naru.spatial-ifc-browser-comparison.1",
  browser: compatibility.browser,
  host: compatibility.host,
  mode: "headed-single-run-diagnostic",
  compatibility: summarize(compatibility),
  spatialLeafAnchor: summarize(leafAnchor),
  consoleIssues: [],
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
console.log(
  `[spatial-ifc-browser] ready ${comparison.compatibility.milestones.readyMs} -> ` +
  `${comparison.spatialLeafAnchor.milestones.readyMs} ms; Range requests ` +
  `${comparison.compatibility.targetRangeResponses} -> ` +
  `${comparison.spatialLeafAnchor.targetRangeResponses}`,
);
console.log(`[spatial-ifc-browser] evidence: ${outputPath}`);
