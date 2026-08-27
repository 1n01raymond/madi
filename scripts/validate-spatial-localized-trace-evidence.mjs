import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(repositoryRoot, "artifacts/spatial-demand/digital-hub-localized");
const assert = (condition, message) => {
  if (!condition) throw new Error(`[spatial-localized] ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readTrace = async (label) =>
  JSON.parse(await readFile(resolve(directory, label, "localized-trace.json"), "utf8"));

const compatibility = await readTrace("compatibility");
const leafAnchor = await readTrace("spatial-leaf-anchor");

/**
 * Package identities of the two Digital Hub builds this host compiled. They are
 * not the macOS digests in digital-hub-packing.json: the IFC adapter emits a
 * platform-dependent Scene IR (see the record README), so these pins stand on
 * their own and must not be retargeted silently to make a re-record pass.
 */
const expected = new Map([
  ["compatibility", {
    trace: compatibility,
    packageDigest: "0a68506da1610e47a5e06a040ce45f5166a2e175671b6cc052fa3b3178d8dd91",
    targetChunkCount: 71,
    localizedChunkCount: 52,
    localizedBytes: 23_065_180,
  }],
  ["spatial-leaf-anchor", {
    trace: leafAnchor,
    packageDigest: "56f813e12527dd8de335df304c8fa651db2697ea77421af53c2c3da0378e86b4",
    targetChunkCount: 66,
    localizedChunkCount: 42,
    localizedBytes: 20_111_204,
  }],
]);

for (const [label, pins] of expected) {
  const trace = pins.trace;
  assert(
    trace.schemaVersion === "naru.spatial-localized-trace.1" &&
      trace.mode === "headed-localized-camera-trace" &&
      trace.payloadOrder === label,
    `${label}: unexpected schema, mode, or payload order.`,
  );
  assert(
    trace.browser.id === "chrome" &&
      trace.browser.version === "151.0.7922.139" &&
      trace.browser.headless === false &&
      trace.browser.viewport.width === 1320 &&
      trace.browser.viewport.height === 1000 &&
      trace.host.platform === "win32" &&
      trace.host.architecture === "x64",
    `${label}: recording environment changed.`,
  );
  assert(
    trace.capture.cameraMove.wheelDelta === -2600 &&
      trace.capture.cameraMove.panX === 300 &&
      trace.capture.cameraMove.panY === -200,
    `${label}: the camera move that defines the localized view changed.`,
  );
  assert(trace.schedulerMode === "spatial-bvh-v1", `${label}: the BVH scheduler was not used.`);
  assert(
    trace.source.packageDigest === pins.packageDigest &&
      trace.totals.targetChunkCount === pins.targetChunkCount &&
      trace.totals.spatialNodeCount === 255 &&
      trace.totals.spatialLeafCount === 128 &&
      trace.totals.spatialOccurrenceCount === 5152 &&
      trace.totals.totalTargetBytes === 35_962_344,
    `${label}: package identity or scene census changed.`,
  );

  const { fitted, localized, navigation } = trace;
  assert(
    fitted.visitedNodeCount === trace.totals.spatialNodeCount &&
      fitted.visibleLeafCount === trace.totals.spatialLeafCount &&
      fitted.testedOccurrenceCount === trace.totals.spatialOccurrenceCount &&
      fitted.candidateChunkCount === trace.totals.targetChunkCount &&
      fitted.demandedBytes === trace.totals.totalTargetBytes,
    `${label}: the fitted view no longer demands the whole model.`,
  );
  assert(
    fitted.targetChunksReady === trace.totals.targetChunkCount &&
      fitted.targetRangeResponses === trace.totals.targetChunkCount &&
      fitted.schedulerSkips === 0 &&
      fitted.schedulerCancellations === 0,
    `${label}: the fitted Range census changed.`,
  );
  assert(
    localized.visitedNodeCount === 109 &&
      localized.visibleLeafCount === 28 &&
      localized.testedOccurrenceCount === 1129 &&
      localized.candidateChunkCount === pins.localizedChunkCount &&
      localized.demandedBytes === pins.localizedBytes,
    `${label}: the localized demand changed.`,
  );
  assert(
    localized.targetRangeResponses === 0 && localized.schedulerCancellations === 0,
    `${label}: the localized view refetched target bytes it already held.`,
  );
  assert(
    trace.reductions.visitedNodes === 146 &&
      trace.reductions.visibleLeaves === 100 &&
      trace.reductions.testedOccurrences === 4023 &&
      trace.reductions.candidateChunks === trace.totals.targetChunkCount - pins.localizedChunkCount &&
      trace.reductions.demandedBytes === trace.totals.totalTargetBytes - pins.localizedBytes,
    `${label}: the localized reduction changed.`,
  );
  assert(
    navigation.samples.length === 48 &&
      navigation.queryMilliseconds.sampleCount === 48 &&
      navigation.queryMilliseconds.minimum > 0 &&
      navigation.queryMilliseconds.p95 <= 0.5,
    `${label}: the navigation query distribution changed or exceeded 0.5 ms at p95.`,
  );
  assert(
    navigation.samples.every(
      (sample) => sample.testedOccurrences < trace.totals.spatialOccurrenceCount,
    ),
    `${label}: a navigation frame fell back to testing every occurrence.`,
  );
  assert(
    fitted.residentDecodedBytes === 48_494_280 &&
      fitted.residentGpuBytes === 48_495_284 &&
      localized.residentDecodedBytes === fitted.residentDecodedBytes &&
      navigation.residentDecodedBytes === fitted.residentDecodedBytes,
    `${label}: residency changed while the camera moved.`,
  );
  assert(trace.consoleIssues.length === 0, `${label}: the browser emitted console issues.`);
  for (const [name, screenshot] of Object.entries(trace.screenshots)) {
    const bytes = await readFile(resolve(directory, label, screenshot.path));
    assert(
      bytes.byteLength === screenshot.bytes && sha256(bytes) === screenshot.sha256,
      `${label}: the ${name} screenshot changed.`,
    );
  }
}

// Both orders pack the same target bytes into different chunks, so the same
// localized view is the controlled comparison ADR-0008 asks for.
assert(
  compatibility.totals.totalTargetBytes === leafAnchor.totals.totalTargetBytes &&
    compatibility.localized.visibleLeafCount === leafAnchor.localized.visibleLeafCount &&
    compatibility.localized.testedOccurrenceCount === leafAnchor.localized.testedOccurrenceCount,
  "The two payload orders no longer describe the same localized view.",
);
assert(
  leafAnchor.localized.candidateChunkCount < compatibility.localized.candidateChunkCount &&
    leafAnchor.localized.demandedBytes < compatibility.localized.demandedBytes,
  "Leaf-anchor ordering no longer reduces the localized demand.",
);
assert(
  compatibility.snapshot.triangleCount === leafAnchor.snapshot.triangleCount &&
    compatibility.snapshot.edgeCount === leafAnchor.snapshot.edgeCount &&
    compatibility.snapshot.triangleCount === "913,532" &&
    compatibility.snapshot.edgeCount === "1,042,404",
  "The two payload orders no longer render the same geometry.",
);

console.log(
  "[spatial-localized] verified headed Chrome 151 on Windows over Digital Hub: " +
    "fitted 128/128 leaves and 5152/5152 occurrences; localized 28 leaves and 1129 occurrences; " +
    `candidate chunks 71 -> ${compatibility.localized.candidateChunkCount} (compatibility) and ` +
    `66 -> ${leafAnchor.localized.candidateChunkCount} (leaf-anchor); ` +
    `demanded bytes ${compatibility.localized.demandedBytes} vs ${leafAnchor.localized.demandedBytes} ` +
    `of ${compatibility.totals.totalTargetBytes}; ` +
    `48 navigation queries at p95 ${compatibility.navigation.queryMilliseconds.p95.toFixed(3)} ms / ` +
    `${leafAnchor.navigation.queryMilliseconds.p95.toFixed(3)} ms`,
);
