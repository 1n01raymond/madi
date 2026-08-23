import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(repositoryRoot, "artifacts/benchmarks/heterogeneous-repeatability");
const evidence = JSON.parse(
  await readFile(resolve(directory, "industrial-benchmark.json"), "utf8"),
);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? null;
}

function close(left, right) {
  return Math.abs(left - right) <= 1e-9;
}

assert(
  evidence.schemaVersion === "madi.industrial-browser-matrix.3",
  "Unknown repeatability evidence schema.",
);
assert(
  evidence.status === "exploratory-not-adr-decision",
  "Repeatability evidence must not claim an ADR decision.",
);
assert(evidence.config.scale === "target", "Repeatability evidence must use the 100k tier.");
assert(evidence.config.profile === "heterogeneous", "Repeatability profile changed.");
assert(evidence.config.culling === "frustum", "Repeatability evidence must enable culling.");
assert(evidence.config.frames === 90 && evidence.config.warmup === 30, "Frame contract changed.");
assert(evidence.config.repeats === 3, "Committed evidence must contain three clean repeats.");
assert(evidence.config.memory === "scene-delta", "Scene delta measurement is required.");
assert(evidence.results.length === 12, "Expected twelve fresh-process runs.");

const workloads = new Set();
const paths = new Set();
const paired = new Map();
let screenshotCount = 0;
for (const entry of evidence.results) {
  const result = entry.result;
  const key = `${entry.browser}/${result.backend}/repeat-${entry.repeat}`;
  assert(entry.repeat >= 1 && entry.repeat <= 3, `${key} has an invalid repeat.`);
  assert(!paths.has(key), `Duplicate ${key}.`);
  paths.add(key);
  assert(entry.consoleIssues.length === 0, `${key} has browser issues.`);
  assert(entry.outboundRequests.length === 0, `${key} made an outbound request.`);
  assert(result.schemaVersion === "madi.industrial-browser-benchmark.3", `${key} schema changed.`);
  assert(result.scale === "target" && result.profile === "heterogeneous", `${key} workload changed.`);
  assert(result.config.memoryMode === "scene-delta", `${key} memory mode changed.`);
  assert(result.workload.occurrenceCount === 100_000, `${key} occurrence count changed.`);
  assert(result.workload.prototypeCount === 256, `${key} prototype count changed.`);
  assert(result.workload.submittedTriangleCount >= 10_000_000, `${key} triangle floor changed.`);
  assert(result.renderer.visibleOccurrences > 0, `${key} culled every occurrence.`);
  assert(
    result.renderer.visibleOccurrences < result.workload.occurrenceCount * 0.75,
    `${key} does not exercise material culling.`,
  );
  assert(result.cpuSubmit.samples === 90, `${key} CPU sample count changed.`);
  assert(result.frameIntervals.samples === 89, `${key} frame sample count changed.`);
  assert(Number.isFinite(result.cpuSubmit.p95Ms), `${key} CPU p95 is missing.`);
  assert(Number.isFinite(result.frameIntervals.p95Ms), `${key} frame p95 is missing.`);
  assert(
    result.memory.measurementScope === "diagnostic-backend-scene-activation-delta",
    `${key} memory scope changed.`,
  );
  assert(
    Number.isFinite(result.memory.measurementOverheadMs) &&
      result.memory.measurementOverheadMs >= 0,
    `${key} memory overhead is invalid.`,
  );
  if (entry.browser === "chrome") {
    assert(Number.isFinite(result.memory.backendCoreReadyBytes), `${key} core memory is missing.`);
    assert(Number.isFinite(result.memory.sceneActivatedBytes), `${key} scene memory is missing.`);
    assert(
      Number.isFinite(result.memory.sceneActivationDeltaBytes) &&
        result.memory.sceneActivationDeltaBytes > 0,
      `${key} scene activation delta is invalid.`,
    );
  }
  workloads.add(JSON.stringify(result.workload));
  const pairKey = `${entry.browser}/repeat-${entry.repeat}`;
  const pair = paired.get(pairKey) ?? [];
  pair.push(result);
  paired.set(pairKey, pair);

  if (entry.repeat === 1) {
    assert(entry.screenshot, `${key} must retain a reviewed screenshot.`);
    const screenshot = await readFile(resolve(directory, entry.screenshot.path));
    assert(screenshot.byteLength === entry.screenshot.bytes, `${key} screenshot size changed.`);
    assert(sha256(screenshot) === entry.screenshot.sha256, `${key} screenshot digest changed.`);
    screenshotCount += 1;
  } else {
    assert(entry.screenshot === null, `${key} should not duplicate a screenshot.`);
  }
}

for (const browser of ["chrome", "firefox"]) {
  for (const backend of ["madi", "three"]) {
    for (let repeat = 1; repeat <= 3; repeat += 1) {
      assert(paths.has(`${browser}/${backend}/repeat-${repeat}`), `Missing ${browser}/${backend}/${repeat}.`);
    }
  }
}
for (const [key, pair] of paired) {
  assert(pair.length === 2, `${key} backend pair is incomplete.`);
  assert(
    pair[0].renderer.visibleOccurrences === pair[1].renderer.visibleOccurrences &&
      pair[0].renderer.visibleTriangles === pair[1].renderer.visibleTriangles,
    `${key} backends disagree on visibility.`,
  );
}
assert(screenshotCount === 4, "Expected one reviewed screenshot per browser/backend path.");
assert(workloads.size === 1, "Repeated runs did not receive identical workload statistics.");
assert(evidence.aggregates.byPath.length === 4, "Per-path aggregates are incomplete.");
assert(evidence.aggregates.pairedComparisons.length === 2, "Paired aggregates are incomplete.");
for (const aggregate of evidence.aggregates.byPath) {
  assert(aggregate.runs === 3, `${aggregate.browser}/${aggregate.backend} aggregate is incomplete.`);
  assert(aggregate.cpuSubmitP95Ms.samples === 3, "CPU aggregate sample count changed.");
  assert(aggregate.frameIntervalP95Ms.samples === 3, "Frame aggregate sample count changed.");
}
for (const comparison of evidence.aggregates.pairedComparisons) {
  assert(comparison.pairs === 3, `${comparison.browser} paired comparison is incomplete.`);
  assert(comparison.cpuP95ReductionPercent.samples === 3, "CPU pair count changed.");
  assert(comparison.frameP95RegressionPercent.samples === 3, "Frame pair count changed.");
  const cpuReductions = [];
  const frameRegressions = [];
  const memoryReductions = [];
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    const pair = paired.get(`${comparison.browser}/repeat-${repeat}`);
    const madi = pair?.find((result) => result.backend === "madi");
    const three = pair?.find((result) => result.backend === "three");
    assert(madi && three, `${comparison.browser}/${repeat} aggregate source is missing.`);
    cpuReductions.push(
      ((three.cpuSubmit.p95Ms - madi.cpuSubmit.p95Ms) / three.cpuSubmit.p95Ms) * 100,
    );
    frameRegressions.push(
      ((madi.frameIntervals.p95Ms - three.frameIntervals.p95Ms) /
        three.frameIntervals.p95Ms) * 100,
    );
    if (
      Number.isFinite(madi.memory.sceneActivationDeltaBytes) &&
      Number.isFinite(three.memory.sceneActivationDeltaBytes) &&
      three.memory.sceneActivationDeltaBytes > 0
    ) {
      memoryReductions.push(
        ((three.memory.sceneActivationDeltaBytes - madi.memory.sceneActivationDeltaBytes) /
          three.memory.sceneActivationDeltaBytes) * 100,
      );
    }
  }
  assert(
    close(comparison.cpuP95ReductionPercent.median, median(cpuReductions)),
    `${comparison.browser} CPU aggregate changed.`,
  );
  assert(
    close(comparison.frameP95RegressionPercent.median, median(frameRegressions)),
    `${comparison.browser} frame aggregate changed.`,
  );
  if (memoryReductions.length > 0) {
    assert(
      close(comparison.sceneDeltaReductionPercent.median, median(memoryReductions)),
      `${comparison.browser} memory aggregate changed.`,
    );
  }
  assert(
    comparison.continueThresholdCounts.cpuP95AtLeast25Percent ===
      cpuReductions.filter((value) => value >= 25).length,
    `${comparison.browser} CPU threshold count changed.`,
  );
  assert(
    comparison.continueThresholdCounts.frameP95NoMoreThan10PercentWorse ===
      frameRegressions.filter((value) => value <= 10).length,
    `${comparison.browser} frame threshold count changed.`,
  );
  assert(
    comparison.continueThresholdCounts.sceneDeltaAtLeast30Percent ===
      memoryReductions.filter((value) => value >= 30).length,
    `${comparison.browser} memory threshold count changed.`,
  );
}
assert(
  evidence.comparisonContract.freshBrowserProcessPerRun === true &&
    evidence.comparisonContract.alternatingBackendOrder === true &&
    evidence.comparisonContract.sceneMemoryDelta === true &&
    evidence.comparisonContract.selfHostedStaticOrigin === true &&
    evidence.comparisonContract.outboundRequestCount === 0,
  "Repeatability comparison contract changed.",
);

console.log(
  `[heterogeneous-repeatability] verified ${evidence.results.length} fresh-process runs ` +
    `across ${evidence.config.repeats} repeats`,
);
