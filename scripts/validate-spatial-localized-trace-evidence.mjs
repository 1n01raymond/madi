import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const assert = (condition, message) => {
  if (!condition) throw new Error(`[spatial-localized] ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The Studio's residency budget, which sixty5 saturates and Digital Hub never reaches. */
const RESIDENCY_BUDGET_BYTES = 67_108_864;

/**
 * Package identities of the four builds this host compiled. They are not the
 * macOS digests in digital-hub-packing.json: the IFC adapter emits a
 * platform-dependent Scene IR (see the record READMEs), so these pins stand on
 * their own and must not be retargeted silently to make a re-record pass.
 *
 * Counts that a run-to-run residency race moves -- Range responses, scheduler
 * requests, cancellations -- are bounded rather than pinned; everything that
 * three runs per order reproduced exactly is pinned exactly.
 */
const records = [
  {
    directory: "artifacts/spatial-demand/digital-hub-localized",
    model: "Digital Hub",
    cameraMove: { wheelDelta: -2600, panX: 300, panY: -200 },
    totals: {
      spatialNodeCount: 255,
      spatialLeafCount: 128,
      spatialOccurrenceCount: 5152,
      totalTargetBytes: 35_962_344,
    },
    localizedView: { visitedNodeCount: 109, visibleLeafCount: 28, testedOccurrenceCount: 1129 },
    navigationP95Ms: 0.5,
    sameResidentGeometry: true,
    orders: {
      compatibility: {
        packageDigest: "0a68506da1610e47a5e06a040ce45f5166a2e175671b6cc052fa3b3178d8dd91",
        targetChunkCount: 71,
        localizedChunkCount: 52,
        localizedBytes: 23_065_180,
        fitted: { chunksReady: 71, rangeResponses: 71, schedulerSkips: 0 },
        residency: { decodedBytes: 48_494_280, gpuBytes: 48_495_284 },
        localizedRangeResponses: { atLeast: 0, atMost: 0 },
        navigation: { candidateChunkCount: 35, demandedBytes: 15_570_320 },
        snapshot: { triangleCount: "913,532", edgeCount: "1,042,404" },
      },
      "spatial-leaf-anchor": {
        packageDigest: "56f813e12527dd8de335df304c8fa651db2697ea77421af53c2c3da0378e86b4",
        targetChunkCount: 66,
        localizedChunkCount: 42,
        localizedBytes: 20_111_204,
        fitted: { chunksReady: 66, rangeResponses: 66, schedulerSkips: 0 },
        residency: { decodedBytes: 48_494_280, gpuBytes: 48_495_284 },
        localizedRangeResponses: { atLeast: 0, atMost: 0 },
        navigation: { candidateChunkCount: 31, demandedBytes: 14_950_124 },
        snapshot: { triangleCount: "913,532", edgeCount: "1,042,404" },
      },
    },
  },
  {
    directory: "artifacts/spatial-demand/sixty5-localized",
    model: "sixty5",
    cameraMove: { wheelDelta: -5000, panX: 400, panY: -300 },
    totals: {
      spatialNodeCount: 4095,
      spatialLeafCount: 2048,
      spatialOccurrenceCount: 78173,
      totalTargetBytes: 120_707_064,
    },
    localizedView: { visitedNodeCount: 889, visibleLeafCount: 184, testedOccurrenceCount: 7026 },
    navigationP95Ms: 2,
    // The budget binds here, so the two orders admit different chunk sets and
    // therefore render different triangle counts from the same demand.
    sameResidentGeometry: false,
    orders: {
      compatibility: {
        packageDigest: "4fa4c67c4071c5337d667c2b1a503c043c4957e1d68d62009f47bc7ac1096bb2",
        targetChunkCount: 234,
        localizedChunkCount: 209,
        localizedBytes: 107_337_264,
        fitted: { chunksReady: 108, rangeResponses: 108, schedulerSkips: 126 },
        residency: {
          decodedBytes: 66_943_668,
          gpuBytes: 67_020_600,
          localizedDecodedBytes: 67_026_048,
          localizedGpuBytes: 67_106_272,
          navigationDecodedBytes: 67_018_440,
          navigationGpuBytes: 67_107_396,
        },
        localizedRangeResponses: { atLeast: 10, atMost: 90 },
        navigation: { candidateChunkCount: 217, demandedBytes: 111_897_972 },
        snapshot: { triangleCount: "2,180,160", edgeCount: "12" },
      },
      "spatial-leaf-anchor": {
        packageDigest: "1fdbb5a88ad7b44dd7c616c2d23475fc86f6108eb34978be9afa1ebd958f1636",
        targetChunkCount: 234,
        localizedChunkCount: 152,
        localizedBytes: 78_875_544,
        fitted: { chunksReady: 106, rangeResponses: 106, schedulerSkips: 128 },
        residency: {
          decodedBytes: 66_999_984,
          gpuBytes: 67_078_424,
          localizedDecodedBytes: 67_027_692,
          localizedGpuBytes: 67_103_956,
          navigationDecodedBytes: 67_022_880,
          navigationGpuBytes: 67_103_200,
        },
        localizedRangeResponses: { atLeast: 10, atMost: 90 },
        navigation: { candidateChunkCount: 182, demandedBytes: 94_150_116 },
        snapshot: { triangleCount: "2,182,636", edgeCount: "12" },
      },
    },
  },
];

for (const record of records) {
  const directory = resolve(repositoryRoot, record.directory);
  const traces = new Map();

  for (const [label, pins] of Object.entries(record.orders)) {
    const trace = JSON.parse(
      await readFile(resolve(directory, label, "localized-trace.json"), "utf8"),
    );
    traces.set(label, trace);
    const where = `${record.model}/${label}`;

    assert(
      trace.schemaVersion === "naru.spatial-localized-trace.1" &&
        trace.mode === "headed-localized-camera-trace" &&
        trace.payloadOrder === label,
      `${where}: unexpected schema, mode, or payload order.`,
    );
    assert(
      trace.browser.id === "chrome" &&
        trace.browser.version === "151.0.7922.139" &&
        trace.browser.headless === false &&
        trace.browser.viewport.width === 1320 &&
        trace.browser.viewport.height === 1000 &&
        trace.host.platform === "win32" &&
        trace.host.architecture === "x64",
      `${where}: recording environment changed.`,
    );
    assert(
      trace.capture.cameraMove.wheelDelta === record.cameraMove.wheelDelta &&
        trace.capture.cameraMove.panX === record.cameraMove.panX &&
        trace.capture.cameraMove.panY === record.cameraMove.panY,
      `${where}: the camera move that defines the localized view changed.`,
    );
    assert(trace.schedulerMode === "spatial-bvh-v1", `${where}: the BVH scheduler was not used.`);
    assert(
      trace.source.packageDigest === pins.packageDigest &&
        trace.totals.targetChunkCount === pins.targetChunkCount &&
        trace.totals.spatialNodeCount === record.totals.spatialNodeCount &&
        trace.totals.spatialLeafCount === record.totals.spatialLeafCount &&
        trace.totals.spatialOccurrenceCount === record.totals.spatialOccurrenceCount &&
        trace.totals.totalTargetBytes === record.totals.totalTargetBytes,
      `${where}: package identity or scene census changed.`,
    );

    const { fitted, localized, navigation } = trace;
    assert(
      fitted.visitedNodeCount === trace.totals.spatialNodeCount &&
        fitted.visibleLeafCount === trace.totals.spatialLeafCount &&
        fitted.testedOccurrenceCount === trace.totals.spatialOccurrenceCount &&
        fitted.candidateChunkCount === trace.totals.targetChunkCount &&
        fitted.demandedBytes === trace.totals.totalTargetBytes,
      `${where}: the fitted view no longer demands the whole model.`,
    );
    // What the fitted view demands and what the budget lets it hold are two
    // different numbers as soon as a model outgrows the budget; both are pinned.
    assert(
      fitted.targetChunksReady === pins.fitted.chunksReady &&
        fitted.targetRangeResponses === pins.fitted.rangeResponses &&
        fitted.schedulerSkips === pins.fitted.schedulerSkips &&
        fitted.schedulerRequests + fitted.schedulerSkips === trace.totals.targetChunkCount &&
        fitted.schedulerCancellations === 0,
      `${where}: the fitted admission census changed.`,
    );
    assert(
      localized.visitedNodeCount === record.localizedView.visitedNodeCount &&
        localized.visibleLeafCount === record.localizedView.visibleLeafCount &&
        localized.testedOccurrenceCount === record.localizedView.testedOccurrenceCount &&
        localized.candidateChunkCount === pins.localizedChunkCount &&
        localized.demandedBytes === pins.localizedBytes,
      `${where}: the localized demand changed.`,
    );
    assert(
      localized.targetRangeResponses >= pins.localizedRangeResponses.atLeast &&
        localized.targetRangeResponses <= pins.localizedRangeResponses.atMost,
      `${where}: the localized window fetched ${localized.targetRangeResponses} ranges, ` +
        `outside the recorded ${pins.localizedRangeResponses.atLeast}-` +
        `${pins.localizedRangeResponses.atMost} band.`,
    );
    assert(
      trace.reductions.visitedNodes ===
          trace.totals.spatialNodeCount - record.localizedView.visitedNodeCount &&
        trace.reductions.visibleLeaves ===
          trace.totals.spatialLeafCount - record.localizedView.visibleLeafCount &&
        trace.reductions.testedOccurrences ===
          trace.totals.spatialOccurrenceCount - record.localizedView.testedOccurrenceCount &&
        trace.reductions.candidateChunks ===
          trace.totals.targetChunkCount - pins.localizedChunkCount &&
        trace.reductions.demandedBytes === trace.totals.totalTargetBytes - pins.localizedBytes,
      `${where}: the localized reduction changed.`,
    );
    assert(
      navigation.samples.length === 48 &&
        navigation.queryMilliseconds.sampleCount === 48 &&
        navigation.queryMilliseconds.minimum > 0 &&
        navigation.queryMilliseconds.p95 <= record.navigationP95Ms,
      `${where}: the navigation query distribution changed or exceeded ` +
        `${record.navigationP95Ms} ms at p95.`,
    );
    assert(
      navigation.samples.every(
        (sample) => sample.testedOccurrences < trace.totals.spatialOccurrenceCount,
      ),
      `${where}: a navigation frame fell back to testing every occurrence.`,
    );
    assert(
      navigation.candidateChunkCount === pins.navigation.candidateChunkCount &&
        navigation.demandedBytes === pins.navigation.demandedBytes,
      `${where}: the pose the navigation window ends on changed.`,
    );
    const residency = pins.residency;
    assert(
      fitted.residentDecodedBytes === residency.decodedBytes &&
        fitted.residentGpuBytes === residency.gpuBytes &&
        localized.residentDecodedBytes ===
          (residency.localizedDecodedBytes ?? residency.decodedBytes) &&
        localized.residentGpuBytes === (residency.localizedGpuBytes ?? residency.gpuBytes) &&
        navigation.residentDecodedBytes ===
          (residency.navigationDecodedBytes ?? residency.decodedBytes) &&
        navigation.residentGpuBytes === (residency.navigationGpuBytes ?? residency.gpuBytes),
      `${where}: residency changed while the camera moved.`,
    );
    for (const window of [fitted, localized, navigation]) {
      assert(
        window.residentGpuBytes <= RESIDENCY_BUDGET_BYTES,
        `${where}: a window held more than the ${RESIDENCY_BUDGET_BYTES}-byte residency budget.`,
      );
    }
    assert(trace.consoleIssues.length === 0, `${where}: the browser emitted console issues.`);
    for (const [name, screenshot] of Object.entries(trace.screenshots)) {
      const bytes = await readFile(resolve(directory, label, screenshot.path));
      assert(
        bytes.byteLength === screenshot.bytes && sha256(bytes) === screenshot.sha256,
        `${where}: the ${name} screenshot changed.`,
      );
    }
  }

  // Both orders pack the same target bytes into different chunks, so the same
  // localized view is the controlled comparison ADR-0008 asks for.
  const compatibility = traces.get("compatibility");
  const leafAnchor = traces.get("spatial-leaf-anchor");
  assert(
    compatibility.totals.totalTargetBytes === leafAnchor.totals.totalTargetBytes &&
      compatibility.localized.visibleLeafCount === leafAnchor.localized.visibleLeafCount &&
      compatibility.localized.testedOccurrenceCount === leafAnchor.localized.testedOccurrenceCount,
    `${record.model}: the two payload orders no longer describe the same localized view.`,
  );
  assert(
    leafAnchor.localized.candidateChunkCount < compatibility.localized.candidateChunkCount &&
      leafAnchor.localized.demandedBytes < compatibility.localized.demandedBytes,
    `${record.model}: leaf-anchor ordering no longer reduces the localized demand.`,
  );
  for (const [label, pins] of Object.entries(record.orders)) {
    const { snapshot } = traces.get(label);
    assert(
      snapshot.triangleCount === pins.snapshot.triangleCount &&
        snapshot.edgeCount === pins.snapshot.edgeCount,
      `${record.model}/${label}: the rendered geometry changed.`,
    );
  }
  assert(
    record.sameResidentGeometry ===
      (compatibility.snapshot.triangleCount === leafAnchor.snapshot.triangleCount),
    record.sameResidentGeometry
      ? `${record.model}: the two payload orders no longer render the same geometry.`
      : `${record.model}: the budget no longer decides which order renders more.`,
  );

  console.log(
    `[spatial-localized] verified headed Chrome 151 on Windows over ${record.model}: ` +
      `fitted ${compatibility.totals.spatialLeafCount} leaves and ` +
      `${compatibility.totals.spatialOccurrenceCount} occurrences; localized ` +
      `${compatibility.localized.visibleLeafCount} leaves and ` +
      `${compatibility.localized.testedOccurrenceCount} occurrences; candidate chunks ` +
      `${compatibility.totals.targetChunkCount} -> ${compatibility.localized.candidateChunkCount} ` +
      `(compatibility) and ${leafAnchor.totals.targetChunkCount} -> ` +
      `${leafAnchor.localized.candidateChunkCount} (leaf-anchor); demanded bytes ` +
      `${compatibility.localized.demandedBytes} vs ${leafAnchor.localized.demandedBytes} of ` +
      `${compatibility.totals.totalTargetBytes}; 48 navigation queries at p95 ` +
      `${compatibility.navigation.queryMilliseconds.p95.toFixed(3)} ms / ` +
      `${leafAnchor.navigation.queryMilliseconds.p95.toFixed(3)} ms`,
  );
}
