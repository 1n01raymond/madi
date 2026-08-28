import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const assert = (condition, message) => {
  if (!condition) throw new Error(`[demand-priority] ${message}`);
};

/** The Studio's shipped residency budget, which the sixty5 federation saturates. */
const RESIDENCY_BUDGET_BYTES = 67_108_864;
const REFERENCE_BUDGET_BYTES = 201_326_592;

/**
 * The sixty5 package this host compiled with the leaf-anchor payload order.
 * It is the same host-local digest the localized trace pins: the IFC adapter
 * emits a platform-dependent Scene IR, so this pin stands on its own and must
 * not be retargeted silently to make a re-record pass.
 */
const PACKAGE_DIGEST = "1fdbb5a88ad7b44dd7c616c2d23475fc86f6108eb34978be9afa1ebd958f1636";
const TARGET_CHUNK_COUNT = 234;

/**
 * Counters that three runs per view reproduced exactly are pinned exactly.
 * The scheduler request and skip totals race with residency eviction, so they
 * are bounded; the pixel scores move with the reference render, which is not
 * byte-stable at this scene size, so they are bounded too -- but the gap
 * between the two policies is far larger than that wobble.
 */
const records = [
  {
    directory: "artifacts/spatial-demand/sixty5-demand-priority/close-view",
    cameraMove: { wheelDelta: -5000, panX: 400, panY: -300 },
    demandedChunkCount: 152,
    reference: {
      residentChunkCount: 234,
      residentDecodedBytes: 136_659_624,
      residentGpuBytes: 136_846_980,
      triangleCount: 4_866_398,
      status: "Compiled glTF ready · 46840 surface batches · 78173 renderable occurrences",
    },
    policies: {
      "screen-distance": {
        residentChunkCount: 103,
        residentDecodedBytes: 67_027_692,
        residentGpuBytes: 67_103_956,
        triangleCount: 2_178_547,
        status:
          "Residency budget reached · 19067 surface batches retained · 78173 renderable occurrences",
        requests: { atLeast: 120, atMost: 135 },
        differingPixels: { atLeast: 180_000, atMost: 240_000 },
      },
      "screen-coverage": {
        residentChunkCount: 104,
        residentDecodedBytes: 66_886_380,
        residentGpuBytes: 66_962_280,
        triangleCount: 2_174_307,
        status:
          "Residency budget reached · 18976 surface batches retained · 78173 renderable occurrences",
        requests: { atLeast: 138, atMost: 152 },
        differingPixels: { atLeast: 0, atMost: 20_000 },
      },
    },
    pixelCount: 614_259,
    heapBytesAtMost: 2_000_000_000,
    // A close-up is dominated by a few large near-field surfaces, which is the
    // case projected area was meant to catch.
    closerToReference: "screen-coverage",
  },
  {
    directory: "artifacts/spatial-demand/sixty5-demand-priority/mid-view",
    cameraMove: { wheelDelta: -1200, panX: 220, panY: -140 },
    demandedChunkCount: 207,
    reference: {
      residentChunkCount: 234,
      residentDecodedBytes: 136_659_624,
      residentGpuBytes: 136_846_980,
      triangleCount: 4_866_398,
      status: "Compiled glTF ready · 46840 surface batches · 78173 renderable occurrences",
    },
    policies: {
      "screen-distance": {
        residentChunkCount: 105,
        residentDecodedBytes: 67_029_684,
        residentGpuBytes: 67_104_600,
        triangleCount: 2_187_231,
        status:
          "Residency budget reached · 18730 surface batches retained · 78173 renderable occurrences",
        requests: { atLeast: 140, atMost: 160 },
        differingPixels: { atLeast: 10_000, atMost: 32_000 },
      },
      "screen-coverage": {
        residentChunkCount: 105,
        residentDecodedBytes: 67_031_604,
        residentGpuBytes: 67_108_692,
        triangleCount: 2_192_059,
        status:
          "Residency budget reached · 19273 surface batches retained · 78173 renderable occurrences",
        requests: { atLeast: 135, atMost: 155 },
        differingPixels: { atLeast: 25_000, atMost: 48_000 },
      },
    },
    pixelCount: 614_259,
    heapBytesAtMost: 2_000_000_000,
    // At a pose filled with similarly sized objects the crosshair is the better
    // predictor, and area ordering renders further from the reference. The
    // record keeps both directions rather than only the favorable one.
    closerToReference: "screen-distance",
  },
];

for (const record of records) {
  const directory = resolve(repositoryRoot, record.directory);
  const evidence = JSON.parse(
    await readFile(resolve(directory, "demand-priority.json"), "utf8"),
  );
  const where = record.directory.slice(record.directory.lastIndexOf("/") + 1);

  assert(
    evidence.schemaVersion === "naru.demand-priority-evidence.1" &&
      evidence.mode === "headed-budget-bound-policy-comparison",
    `${where}: unexpected schema or capture mode.`,
  );
  assert(
    evidence.browser.id === "chrome" &&
      evidence.browser.version === "151.0.7922.139" &&
      evidence.browser.headless === false &&
      evidence.browser.viewport.width === 1320 &&
      evidence.browser.viewport.height === 1000 &&
      evidence.host.platform === "win32" &&
      evidence.host.architecture === "x64",
    `${where}: recording environment changed.`,
  );
  assert(
    evidence.capture.residencyMiB * 1024 * 1024 === RESIDENCY_BUDGET_BYTES &&
      evidence.capture.referenceResidencyMiB * 1024 * 1024 === REFERENCE_BUDGET_BYTES &&
      evidence.capture.cameraMove.wheelDelta === record.cameraMove.wheelDelta &&
      evidence.capture.cameraMove.panX === record.cameraMove.panX &&
      evidence.capture.cameraMove.panY === record.cameraMove.panY,
    `${where}: the budget or the camera pose that defines the comparison changed.`,
  );
  assert(
    evidence.source.packageDigest === PACKAGE_DIGEST,
    `${where}: package digest ${evidence.source.packageDigest} is not the recorded build.`,
  );
  assert(evidence.consoleIssues.length === 0, `${where}: the browser reported issues.`);

  const runs = [evidence.reference, ...evidence.policies];
  for (const run of runs) {
    assert(
      run.schedulerMode === "spatial-bvh-v1" && run.targetChunkCount === TARGET_CHUNK_COUNT,
      `${where}/${run.name}: the spatial scheduler or the chunk census changed.`,
    );
    assert(
      run.demandedChunkCount === record.demandedChunkCount,
      `${where}/${run.name}: demanded ${run.demandedChunkCount} chunks, not ` +
        `${record.demandedChunkCount}; the three runs must share one view.`,
    );
    // One admitted chunk is one Range request: the estimate gate refuses the
    // rest before they reach the network.
    assert(
      run.targetRangeResponses === run.schedulerRequests,
      `${where}/${run.name}: ${run.schedulerRequests} requests produced ` +
        `${run.targetRangeResponses} Range responses.`,
    );
    assert(
      run.usedJsHeapBytes !== null && run.usedJsHeapBytes <= record.heapBytesAtMost,
      `${where}/${run.name}: peak heap ${run.usedJsHeapBytes} exceeds the recorded bound.`,
    );
    const digest = createHash("sha256")
      .update(await readFile(resolve(directory, run.screenshot.path)))
      .digest("hex");
    assert(
      digest === run.screenshot.sha256,
      `${where}/${run.name}: ${run.screenshot.path} does not match its recorded digest.`,
    );
  }

  const { reference } = evidence;
  assert(
    reference.residencyMiB * 1024 * 1024 === REFERENCE_BUDGET_BYTES &&
      reference.residentChunkCount === record.reference.residentChunkCount &&
      reference.residentDecodedBytes === record.reference.residentDecodedBytes &&
      reference.residentGpuBytes === record.reference.residentGpuBytes &&
      reference.triangleCount === record.reference.triangleCount &&
      reference.status === record.reference.status,
    `${where}: the unbudgeted reference render changed.`,
  );
  assert(
    reference.residentChunkCount === TARGET_CHUNK_COUNT && reference.schedulerSkips === 0,
    `${where}: the reference budget no longer admits every demanded chunk.`,
  );

  const byPriority = new Map(evidence.policies.map((run) => [run.priority, run]));
  assert(
    byPriority.size === 2 &&
      byPriority.has("screen-distance") &&
      byPriority.has("screen-coverage"),
    `${where}: the record must compare both ordering policies.`,
  );
  for (const [priority, pins] of Object.entries(record.policies)) {
    const run = byPriority.get(priority);
    const at = `${where}/${priority}`;
    assert(
      run.residencyMiB * 1024 * 1024 === RESIDENCY_BUDGET_BYTES &&
        run.residentGpuBytes <= RESIDENCY_BUDGET_BYTES,
      `${at}: the run did not hold to the residency budget.`,
    );
    assert(
      run.residentChunkCount === pins.residentChunkCount &&
        run.residentDecodedBytes === pins.residentDecodedBytes &&
        run.residentGpuBytes === pins.residentGpuBytes &&
        run.triangleCount === pins.triangleCount &&
        run.status === pins.status,
      `${at}: the admitted set changed.`,
    );
    assert(
      run.schedulerRequests >= pins.requests.atLeast &&
        run.schedulerRequests <= pins.requests.atMost,
      `${at}: ${run.schedulerRequests} requests fall outside the recorded ` +
        `${pins.requests.atLeast}-${pins.requests.atMost} band.`,
    );
    const agreement = run.agreementWithReference;
    assert(
      agreement.pixelCount === record.pixelCount &&
        agreement.width * agreement.height === record.pixelCount,
      `${at}: the scored canvas is no longer ${record.pixelCount} pixels.`,
    );
    assert(
      agreement.differingPixels >= pins.differingPixels.atLeast &&
        agreement.differingPixels <= pins.differingPixels.atMost,
      `${at}: ${agreement.differingPixels} differing pixels fall outside the recorded ` +
        `${pins.differingPixels.atLeast}-${pins.differingPixels.atMost} band.`,
    );
    assert(
      Math.abs(
        agreement.agreementRatio -
          (record.pixelCount - agreement.differingPixels) / record.pixelCount,
      ) < 1e-12,
      `${at}: the agreement ratio does not follow from the differing pixel count.`,
    );
  }

  // The claim the record exists to carry: at one budget and one pose the two
  // policies hold different geometry, and which of them renders closer to the
  // unbudgeted reference depends on the view -- so the pinned winner is
  // per-record, and neither direction may flip silently.
  const distance = byPriority.get("screen-distance");
  const coverage = byPriority.get("screen-coverage");
  const closer =
    coverage.agreementWithReference.differingPixels <
    distance.agreementWithReference.differingPixels
      ? "screen-coverage"
      : "screen-distance";
  assert(
    closer === record.closerToReference,
    `${where}: ${closer} now renders closer to the reference, not ${record.closerToReference}.`,
  );
  assert(
    evidence.comparison.differingPixelDelta ===
      coverage.agreementWithReference.differingPixels -
        distance.agreementWithReference.differingPixels &&
      evidence.comparison.residentChunkDelta ===
        coverage.residentChunkCount - distance.residentChunkCount &&
      evidence.comparison.triangleDelta === coverage.triangleCount - distance.triangleCount,
    `${where}: the published comparison does not follow from the two runs.`,
  );
  console.log(
    `[demand-priority] ${where}: distance ${distance.agreementWithReference.differingPixels} vs ` +
      `coverage ${coverage.agreementWithReference.differingPixels} differing pixels; ` +
      `${record.closerToReference} is closer to the reference`,
  );
}
console.log(`[demand-priority] ${records.length} record(s) verified`);
