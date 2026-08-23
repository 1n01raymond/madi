import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(repositoryRoot, "artifacts/benchmarks/heterogeneous-culling");
const evidence = JSON.parse(
  await readFile(resolve(directory, "industrial-benchmark.json"), "utf8"),
);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

assert(
  evidence.schemaVersion === "madi.industrial-browser-matrix.2",
  "Unknown heterogeneous benchmark evidence schema.",
);
assert(
  evidence.status === "exploratory-not-adr-decision",
  "Heterogeneous evidence must not claim an ADR decision.",
);
assert(evidence.config.scale === "target", "Committed evidence must use the 100k target tier.");
assert(evidence.config.profile === "heterogeneous", "Committed evidence profile changed.");
assert(evidence.config.culling === "frustum", "Committed evidence must enable frustum culling.");
assert(evidence.results.length === 4, "Expected two backends in two browser engines.");

const combinations = new Set();
const workloads = new Set();
const resultsByBrowser = new Map();
for (const entry of evidence.results) {
  const result = entry.result;
  const key = `${entry.browser}/${result.backend}`;
  combinations.add(key);
  assert(entry.consoleIssues.length === 0, `${key} has browser issues.`);
  assert(entry.outboundRequests.length === 0, `${key} made an outbound request.`);
  assert(result.schemaVersion === "madi.industrial-browser-benchmark.2", "Unknown run schema.");
  assert(result.scale === "target" && result.profile === "heterogeneous", `${key} changed workload.`);
  assert(result.workload.occurrenceCount === 100_000, `${key} changed target occurrence count.`);
  assert(result.workload.prototypeCount === 256, `${key} changed heterogeneous prototype count.`);
  assert(
    result.workload.submittedTriangleCount >= 10_000_000,
    `${key} no longer reaches the triangle floor.`,
  );
  assert(result.features.frustumCulling === "frustum", `${key} disabled culling.`);
  assert(result.features.cameraTrace === "local-review", `${key} changed the camera trace.`);
  assert(result.renderer.visibleOccurrences > 0, `${key} culled every occurrence.`);
  assert(
    result.renderer.visibleOccurrences < result.workload.occurrenceCount * 0.75,
    `${key} does not exercise material culling.`,
  );
  assert(result.frameIntervals.samples === evidence.config.frames - 1, `${key} frame count changed.`);
  assert(result.cpuSubmit.samples === evidence.config.frames, `${key} CPU sample count changed.`);
  assert(Number.isFinite(result.cpuSubmit.p95Ms), `${key} CPU p95 is missing.`);
  assert(Number.isFinite(result.frameIntervals.p95Ms), `${key} frame p95 is missing.`);
  if (result.backend === "madi") {
    assert(result.renderer.logicalDrawCalls === 256, "MADI prototype draw contract changed.");
    assert(result.renderer.visibleSubdraws <= 256, "MADI visible draw count changed.");
    assert(
      result.renderer.cullingImplementation === "dense-cpu-compaction",
      "MADI culling implementation changed.",
    );
  } else {
    assert(result.renderer.logicalDrawCalls === 1, "Three.js BatchedMesh contract changed.");
    assert(
      result.renderer.visibleSubdraws === result.renderer.visibleOccurrences,
      "Three.js BatchedMesh subdraw count differs from visible occurrences.",
    );
    assert(
      result.renderer.cullingImplementation === "three-batched-mesh",
      "Three.js culling implementation changed.",
    );
  }
  workloads.add(JSON.stringify(result.workload));
  const browserResults = resultsByBrowser.get(entry.browser) ?? [];
  browserResults.push(result);
  resultsByBrowser.set(entry.browser, browserResults);

  const screenshot = await readFile(resolve(directory, entry.screenshot.path));
  assert(screenshot.byteLength === entry.screenshot.bytes, `${key} screenshot size changed.`);
  assert(sha256(screenshot) === entry.screenshot.sha256, `${key} screenshot digest changed.`);
}

for (const combination of ["chrome/madi", "chrome/three", "firefox/madi", "firefox/three"]) {
  assert(combinations.has(combination), `Missing ${combination} benchmark result.`);
}
for (const [browser, results] of resultsByBrowser) {
  assert(results.length === 2, `${browser} backend pair is incomplete.`);
  assert(
    results[0].renderer.visibleOccurrences === results[1].renderer.visibleOccurrences &&
      results[0].renderer.visibleTriangles === results[1].renderer.visibleTriangles,
    `${browser} backends disagree on final-camera visibility.`,
  );
}
assert(workloads.size === 1, "Backends did not receive identical workload statistics.");
assert(
  evidence.comparisonContract.sameWorkload === true &&
    evidence.comparisonContract.sameCameraTrace === true &&
    evidence.comparisonContract.frustumCulling === "frustum" &&
    evidence.comparisonContract.selfHostedStaticOrigin === true &&
    evidence.comparisonContract.outboundRequestCount === 0,
  "Heterogeneous comparison contract changed.",
);

console.log(
  `[heterogeneous-culling] verified ${evidence.results.length} exploratory browser/backend runs ` +
    `at ${evidence.results[0].result.workload.occurrenceCount.toLocaleString("en-US")} occurrences`,
);
