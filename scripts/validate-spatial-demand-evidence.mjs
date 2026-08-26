import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(repositoryRoot, "artifacts/spatial-demand");
const evidence = JSON.parse(await readFile(resolve(directory, "evidence.json"), "utf8"));
const packing = JSON.parse(
  await readFile(resolve(directory, "digital-hub-packing.json"), "utf8"),
);
const sixty5Packing = JSON.parse(
  await readFile(resolve(directory, "sixty5-packing.json"), "utf8"),
);
const sixty5Browser = JSON.parse(
  await readFile(resolve(directory, "sixty5-browser-comparison.json"), "utf8"),
);
const digitalHubBrowser = JSON.parse(
  await readFile(resolve(directory, "digital-hub-browser-comparison.json"), "utf8"),
);
const assert = (condition, message) => {
  if (!condition) throw new Error(`[spatial-demand] ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert(evidence.schemaVersion === "naru.spatial-demand-evidence.1", "Unexpected schema.");
assert(evidence.host.platform === "darwin", "Expected the reviewed macOS host.");
assert(evidence.host.architecture === "arm64", "Expected the reviewed arm64 host.");
assert(evidence.compile.leafCapacity === 1, "Expected the focused leaf capacity.");
assert(evidence.compile.deterministic === true, "Determinism was not proven.");
assert(evidence.compile.historicalTargetUnchanged === true, "Target geometry changed.");
assert(evidence.compile.historicalCoarseUnchanged === true, "Coarse geometry changed.");
assert(
  evidence.compile.packageDigest ===
    "28386d787f075ad8836b7833a28f3509467c50f2387d74adfd09eb3c1f18f200",
  "Package digest changed.",
);
assert(
  evidence.compile.spatialIndex.schemaVersion === "naru.spatial-demand-index.1" &&
    evidence.compile.spatialIndex.byteLength === 1552 &&
    evidence.compile.spatialIndex.sha256 ===
      "44d1b9fc46985e2bf6658ea67263e81b821bd3b2605b41d086561d8e818be4a0",
  "Spatial index identity changed.",
);
assert(evidence.compile.targetChunkCount === 3, "Expected three target chunks.");
assert(evidence.compile.renderableOccurrenceCount === 10, "Expected ten occurrences.");

const expectedVersions = new Map([
  ["chrome", "151.0.7922.174"],
  ["firefox", "150.0.2"],
]);
assert(evidence.results.length === expectedVersions.size, "Expected two browser records.");
for (const result of evidence.results) {
  assert(expectedVersions.get(result.browser) === result.browserVersion, `${result.browser} version changed.`);
  assert(result.headless === false, `${result.browser} was not headed.`);
  assert(result.adapter.isFallbackAdapter === false, `${result.browser} used a fallback adapter.`);
  assert(result.spatialRequests === 1, `${result.browser} did not fetch spatial.bin exactly once.`);
  assert(result.consoleIssues.length === 0, `${result.browser} emitted console issues.`);
  assert(result.targetReady === "spatial-idle", `${result.browser} did not stop at spatial idle.`);
  assert(
    result.initial.nodesVisited === result.initial.nodesTotal &&
      result.initial.leavesVisible === result.initial.leavesTotal &&
      result.initial.occurrencesTested === result.initial.occurrencesTotal &&
      result.initial.candidateChunks === result.initial.targetChunksTotal,
    `${result.browser} initial fit did not cover the full scenario.`,
  );
  assert(
    result.localized.nodesVisited < result.localized.nodesTotal &&
      result.localized.leavesVisible < result.localized.leavesTotal &&
      result.localized.occurrencesTested < result.localized.occurrencesTotal &&
      result.localized.candidateChunks < result.localized.targetChunksTotal,
    `${result.browser} localized query did not reduce every work count.`,
  );
  assert(
    result.localized.leavesVisible === 1 &&
      result.localized.occurrencesTested === 1 &&
      result.localized.candidateChunks === 1,
    `${result.browser} localized oracle changed.`,
  );
  assert(
    Number.isFinite(result.initial.queryMilliseconds) &&
      result.initial.queryMilliseconds > 0 &&
      Number.isFinite(result.localized.queryMilliseconds) &&
      result.localized.queryMilliseconds > 0,
    `${result.browser} query timing is invalid.`,
  );
  assert(result.cancellationCount >= 1, `${result.browser} did not cancel obsolete work.`);
  assert(
    result.fulfilledRanges.length === 1 && result.abortedRanges.length >= 1,
    `${result.browser} delivered off-view target bytes.`,
  );
  const screenshot = await readFile(resolve(directory, result.screenshot.path));
  assert(screenshot.byteLength === result.screenshot.bytes, `${result.browser} screenshot size changed.`);
  assert(sha256(screenshot) === result.screenshot.sha256, `${result.browser} screenshot digest changed.`);
}

assert(
  packing.schemaVersion === "naru.spatial-ifc-packing-evidence.1",
  "Unexpected Digital Hub packing schema.",
);
assert(
  packing.source.sourceDigest ===
    "sha256:89fae107a28fc5f86494cb9ce788f62789b9f4ace46c42b1bb7a9e54265d4785",
  "Digital Hub source identity changed.",
);
assert(
  packing.options.targetChunkByteBudget === 524288 && packing.options.leafCapacity === 64,
  "Digital Hub packing options changed.",
);
assert(
  packing.counts.compiledPrototypeCount === 3383 &&
    packing.counts.renderableOccurrenceCount === 5152,
  "Digital Hub packing counts changed.",
);
assert(
  packing.deterministicRepeat === true && packing.coarseByteIdentical === true,
  "Digital Hub packing invariants were not proven.",
);
assert(
  packing.khronosValidation.version === "2.0.0-dev.3.10" &&
    packing.khronosValidation.compatibility.errors === 0 &&
    packing.khronosValidation.compatibility.warnings === 0 &&
    packing.khronosValidation.spatialLeafAnchor.errors === 0 &&
    packing.khronosValidation.spatialLeafAnchor.warnings === 0,
  "Digital Hub packing failed Khronos validation.",
);
const compatibility = packing.compatibility;
const leafAnchor = packing.spatialLeafAnchor;
for (const [label, result] of [["compatibility", compatibility], ["leaf-anchor", leafAnchor]]) {
  assert(
    Number.isFinite(result.compileMilliseconds) && result.compileMilliseconds > 0,
    `${label} compile timing is invalid.`,
  );
  assert(
    result.targetBytes === 35962344 && result.coarseBytes === 3085296,
    `${label} geometry byte counts changed.`,
  );
  assert(result.leafMetrics.leafCount === 128, `${label} leaf count changed.`);
}
assert(
  compatibility.packageDigest ===
    "4f25e08d68db184fde0ab8ec0081db30f3bb83f580be0813ff11bb1a7df542ba" &&
    compatibility.targetChunkCount === 71 &&
    compatibility.spatialBytes === 65472 &&
    compatibility.spatialSha256 ===
      "7e3be0ef5af702997f32fab7b62c1ed62d42078739ce38bab52b95742981041a",
  "Compatibility package identity changed.",
);
assert(
  leafAnchor.packageDigest ===
    "12ec70e83edc5ce917552abdf12fc81b9c70d9999cf35da61b9833f675bf379e" &&
    leafAnchor.targetChunkCount === 66 &&
    leafAnchor.spatialBytes === 63168 &&
    leafAnchor.spatialSha256 ===
      "86a09efba36818abc22a39be7167a2bf0ac9ade766196870b8f71a160e8fed24",
  "Leaf-anchor package identity changed.",
);
assert(
  compatibility.leafMetrics.summedUsefulBytes === 72874844 &&
    leafAnchor.leafMetrics.summedUsefulBytes === compatibility.leafMetrics.summedUsefulBytes,
  "Leaf useful-byte census changed.",
);
assert(
  compatibility.leafMetrics.summedOffViewBytes === 637689824 &&
    leafAnchor.leafMetrics.summedOffViewBytes === 383315164 &&
    leafAnchor.leafMetrics.summedOffViewBytes <
      compatibility.leafMetrics.summedOffViewBytes,
  "Leaf-anchor packing did not reduce off-view bytes.",
);
assert(
  compatibility.leafMetrics.chunksPerLeaf.p50 === 12 &&
    compatibility.leafMetrics.chunksPerLeaf.p95 === 16 &&
    leafAnchor.leafMetrics.chunksPerLeaf.p50 === 7 &&
    leafAnchor.leafMetrics.chunksPerLeaf.p95 === 12,
  "Digital Hub chunks-per-leaf distribution changed.",
);
assert(
  digitalHubBrowser.schemaVersion === "naru.spatial-ifc-browser-comparison.1" &&
    digitalHubBrowser.mode === "headed-single-run-diagnostic",
  "Unexpected Digital Hub browser-comparison schema.",
);
assert(
  digitalHubBrowser.browser.id === "chrome" &&
    digitalHubBrowser.browser.version === "151.0.7922.174" &&
    digitalHubBrowser.browser.headless === false &&
    digitalHubBrowser.host.platform === "darwin" &&
    digitalHubBrowser.host.architecture === "arm64",
  "Digital Hub browser host changed.",
);
const compatibilityBrowser = digitalHubBrowser.compatibility;
const leafAnchorBrowser = digitalHubBrowser.spatialLeafAnchor;
assert(
  compatibilityBrowser.packageDigest === compatibility.packageDigest &&
    leafAnchorBrowser.packageDigest === leafAnchor.packageDigest,
  "Digital Hub browser/package identity changed.",
);
assert(
  compatibilityBrowser.milestones.hierarchyReadyMs === 438 &&
    compatibilityBrowser.milestones.coarseFrameMs === 578 &&
    compatibilityBrowser.milestones.readyMs === 20766 &&
    leafAnchorBrowser.milestones.hierarchyReadyMs === 432 &&
    leafAnchorBrowser.milestones.coarseFrameMs === 569 &&
    leafAnchorBrowser.milestones.readyMs === 19346,
  "Digital Hub browser milestones changed.",
);
assert(
  compatibilityBrowser.targetChunkCount === 71 &&
    compatibilityBrowser.targetChunksReady === 71 &&
    compatibilityBrowser.targetRangeResponses === 71 &&
    leafAnchorBrowser.targetChunkCount === 66 &&
    leafAnchorBrowser.targetChunksReady === 66 &&
    leafAnchorBrowser.targetRangeResponses === 66,
  "Digital Hub browser Range census changed.",
);
assert(
  compatibilityBrowser.spatialNodesVisited === 255 &&
    compatibilityBrowser.spatialLeavesVisible === 128 &&
    compatibilityBrowser.spatialOccurrencesTested === 5152 &&
    compatibilityBrowser.spatialCandidateChunks === 71 &&
    leafAnchorBrowser.spatialNodesVisited === 255 &&
    leafAnchorBrowser.spatialLeavesVisible === 128 &&
    leafAnchorBrowser.spatialOccurrencesTested === 5152 &&
    leafAnchorBrowser.spatialCandidateChunks === 66,
  "Digital Hub initial-fit spatial census changed.",
);
assert(
  compatibilityBrowser.residentDecodedBytes === leafAnchorBrowser.residentDecodedBytes &&
    compatibilityBrowser.residentGpuBytes === leafAnchorBrowser.residentGpuBytes &&
    compatibilityBrowser.selectedObjectId === leafAnchorBrowser.selectedObjectId &&
    compatibilityBrowser.propertyEntryCount === 18 &&
    leafAnchorBrowser.propertyEntryCount === 18 &&
    digitalHubBrowser.consoleIssues.length === 0,
  "Digital Hub browser identity, residency, or property parity changed.",
);

assert(
  sixty5Packing.schemaVersion === "naru.spatial-ifc-packing-evidence.1",
  "Unexpected sixty5 packing schema.",
);
assert(
  sixty5Packing.source.sourceDigest ===
    "sha256:e334c6a9295a0adbf8ffbb15c61ea05c47b0135a319ee370f853bb9a36d21dec" &&
    sixty5Packing.source.structureBytes === 378291460 &&
    sixty5Packing.source.structureSha256 ===
      "5c01010cfeaaf5aa581ae4a2d8433f9a9dd63e5a4e05743e067a8a6e81c5d6a0" &&
    sixty5Packing.source.geometryBytes === 201062984 &&
    sixty5Packing.source.geometrySha256 ===
      "79086ade4a471433dba1b4605b3fe3e404dcd74c180a9124c84204f2616b9879",
  "sixty5 split.4 source identity changed.",
);
assert(
  sixty5Packing.options.targetChunkByteBudget === 524288 &&
    sixty5Packing.options.leafCapacity === 64 &&
    sixty5Packing.options.jsonFormatting === "compact" &&
    sixty5Packing.runtime.sequentialCompilation === true &&
    sixty5Packing.runtime.heapSizeLimitBytes === 8791261184,
  "sixty5 recording options changed.",
);
assert(
  sixty5Packing.counts.compiledPrototypeCount === 42435 &&
    sixty5Packing.counts.renderableOccurrenceCount === 78173 &&
    sixty5Packing.counts.triangleCount === 4866380 &&
    sixty5Packing.counts.edgeSegmentCount === 3771758,
  "sixty5 packing counts changed.",
);
assert(
  sixty5Packing.deterministicRepeat === true &&
    sixty5Packing.coarseByteIdentical === true &&
    sixty5Packing.khronosValidation.version === "2.0.0-dev.3.10" &&
    sixty5Packing.khronosValidation.compatibility.errors === 0 &&
    sixty5Packing.khronosValidation.compatibility.warnings === 0 &&
    sixty5Packing.khronosValidation.spatialLeafAnchor.errors === 0 &&
    sixty5Packing.khronosValidation.spatialLeafAnchor.warnings === 0,
  "sixty5 package invariants or Khronos validation changed.",
);
const sixty5Compatibility = sixty5Packing.compatibility;
const sixty5LeafAnchor = sixty5Packing.spatialLeafAnchor;
assert(
  sixty5Compatibility.packageDigest ===
    "72ee778e92fdce1f786f541366bd3912885711f099714ef9ccdae05301a945fa" &&
    sixty5Compatibility.targetChunkCount === 324 &&
    sixty5Compatibility.targetBytes === 169752048 &&
    sixty5Compatibility.coarseBytes === 38700720 &&
    sixty5Compatibility.spatialBytes === 1056956 &&
    sixty5Compatibility.spatialSha256 ===
      "3b1c5853853ecda980242a19e0041671b874f405ed44445a4a4501cda3875b30",
  "sixty5 compatibility package identity changed.",
);
assert(
  sixty5LeafAnchor.packageDigest ===
    "01a7f3fa61f953a57764fcb0a0b0f5ceddf8b56f4ddee8332a5a456492a8afb7" &&
    sixty5LeafAnchor.targetChunkCount === 325 &&
    sixty5LeafAnchor.targetBytes === 169752048 &&
    sixty5LeafAnchor.coarseBytes === 38700720 &&
    sixty5LeafAnchor.spatialBytes === 1005272 &&
    sixty5LeafAnchor.spatialSha256 ===
      "f1d40a5d1a1b9cf9afa05932a479639a4016289c30bef34ac37aa90d864d0fa1",
  "sixty5 leaf-anchor package identity changed.",
);
assert(
  sixty5Compatibility.leafMetrics.leafCount === 2048 &&
    sixty5LeafAnchor.leafMetrics.leafCount === 2048 &&
    sixty5Compatibility.leafMetrics.chunkReferences === 34167 &&
    sixty5LeafAnchor.leafMetrics.chunkReferences === 21246 &&
    sixty5Compatibility.leafMetrics.chunksPerLeaf.p50 === 17 &&
    sixty5Compatibility.leafMetrics.chunksPerLeaf.p95 === 23 &&
    sixty5LeafAnchor.leafMetrics.chunksPerLeaf.p50 === 10 &&
    sixty5LeafAnchor.leafMetrics.chunksPerLeaf.p95 === 17,
  "sixty5 leaf chunk distribution changed.",
);
assert(
  sixty5Compatibility.leafMetrics.requestedBytesPerLeaf.p50 === 8376048 &&
    sixty5Compatibility.leafMetrics.requestedBytesPerLeaf.p95 === 11771888 &&
    sixty5LeafAnchor.leafMetrics.requestedBytesPerLeaf.p50 === 5341128 &&
    sixty5LeafAnchor.leafMetrics.requestedBytesPerLeaf.p95 === 8578584 &&
    sixty5Compatibility.leafMetrics.summedUsefulBytes === 1245817332 &&
    sixty5LeafAnchor.leafMetrics.summedUsefulBytes === 1245817332 &&
    sixty5Compatibility.leafMetrics.summedOffViewBytes === 15972343228 &&
    sixty5LeafAnchor.leafMetrics.summedOffViewBytes === 9668115064,
  "sixty5 requested/useful/off-view byte census changed.",
);
assert(
  sixty5Browser.schemaVersion === "naru.spatial-ifc-browser-comparison.1" &&
    sixty5Browser.mode === "headed-single-run-diagnostic" &&
    sixty5Browser.browser.id === "chrome" &&
    sixty5Browser.browser.version === "151.0.7922.174" &&
    sixty5Browser.browser.headless === false &&
    sixty5Browser.host.platform === "darwin" &&
    sixty5Browser.host.architecture === "arm64",
  "Unexpected sixty5 browser-comparison environment.",
);
const sixty5CompatibilityBrowser = sixty5Browser.compatibility;
const sixty5LeafAnchorBrowser = sixty5Browser.spatialLeafAnchor;
assert(
  sixty5CompatibilityBrowser.packageDigest === sixty5Compatibility.packageDigest &&
    sixty5LeafAnchorBrowser.packageDigest === sixty5LeafAnchor.packageDigest,
  "sixty5 browser/package identity changed.",
);
assert(
  sixty5CompatibilityBrowser.milestones.hierarchyReadyMs === 2051 &&
    sixty5CompatibilityBrowser.milestones.coarseFrameMs === 6417 &&
    sixty5CompatibilityBrowser.milestones.readyMs === 20899 &&
    sixty5LeafAnchorBrowser.milestones.hierarchyReadyMs === 2120 &&
    sixty5LeafAnchorBrowser.milestones.coarseFrameMs === 6503 &&
    sixty5LeafAnchorBrowser.milestones.readyMs === 21369 &&
    sixty5CompatibilityBrowser.milestones.coarseFrameMs <= 15000 &&
    sixty5LeafAnchorBrowser.milestones.coarseFrameMs <= 15000,
  "sixty5 browser milestones changed or exceeded the coarse-frame ceiling.",
);
assert(
  sixty5CompatibilityBrowser.targetChunkCount === 324 &&
    sixty5CompatibilityBrowser.targetChunksReady === 41 &&
    sixty5CompatibilityBrowser.targetSchedulerRequests === 43 &&
    sixty5CompatibilityBrowser.targetRangeResponses === 45 &&
    sixty5LeafAnchorBrowser.targetChunkCount === 325 &&
    sixty5LeafAnchorBrowser.targetChunksReady === 42 &&
    sixty5LeafAnchorBrowser.targetSchedulerRequests === 44 &&
    sixty5LeafAnchorBrowser.targetRangeResponses === 46,
  "sixty5 browser target residency census changed.",
);
assert(
  sixty5CompatibilityBrowser.spatialNodesVisited === 4095 &&
    sixty5CompatibilityBrowser.spatialLeavesVisible === 2048 &&
    sixty5CompatibilityBrowser.spatialOccurrencesTested === 78173 &&
    sixty5CompatibilityBrowser.spatialCandidateChunks === 324 &&
    sixty5LeafAnchorBrowser.spatialNodesVisited === 4095 &&
    sixty5LeafAnchorBrowser.spatialLeavesVisible === 2048 &&
    sixty5LeafAnchorBrowser.spatialOccurrencesTested === 78173 &&
    sixty5LeafAnchorBrowser.spatialCandidateChunks === 325,
  "sixty5 initial-fit spatial census changed.",
);
assert(
  sixty5CompatibilityBrowser.selectedObjectId === sixty5LeafAnchorBrowser.selectedObjectId &&
    sixty5CompatibilityBrowser.propertyEntryCount === 6 &&
    sixty5LeafAnchorBrowser.propertyEntryCount === 6 &&
    sixty5Browser.consoleIssues.length === 0,
  "sixty5 browser picking, properties, or console parity changed.",
);

console.log(
  "[spatial-demand] verified headed Chrome/Firefox: " +
    "localized 1/3 chunks and 1/10 occurrences with obsolete Range cancellation; " +
    "Digital Hub leaf-anchor off-view bytes 637689824 -> 383315164 and headed Ranges 71 -> 66; " +
    "sixty5 off-view bytes 15972343228 -> 9668115064 and headed coarse frames 6417/6503 ms",
);
