import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(repositoryRoot, "artifacts/benchmarks/industrial-baseline");
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
  evidence.schemaVersion === "madi.industrial-browser-matrix.1",
  "Unknown industrial benchmark evidence schema.",
);
assert(
  evidence.status === "exploratory-not-adr-decision",
  "Exploratory evidence must not claim an ADR decision.",
);
assert(evidence.config.scale === "gate", "Committed evidence must use the 10k gate tier.");
assert(evidence.results.length === 4, "Expected two backends in two browser engines.");

const combinations = new Set();
const contracts = new Set();
const workloads = new Set();
for (const entry of evidence.results) {
  const result = entry.result;
  combinations.add(`${entry.browser}/${result.backend}`);
  assert(entry.consoleIssues.length === 0, `${entry.browser}/${result.backend} has browser issues.`);
  assert(
    entry.outboundRequests.length === 0,
    `${entry.browser}/${result.backend} made an outbound request.`,
  );
  assert(result.schemaVersion === "madi.industrial-browser-benchmark.1", "Unknown run schema.");
  assert(result.scale === "gate", "Run scale differs from the evidence config.");
  assert(result.workload.occurrenceCount === 10_000, "Gate occurrence count changed.");
  assert(result.workload.prototypeCount === 4, "Prototype count changed.");
  assert(
    result.renderer.logicalDrawCalls === result.workload.prototypeCount,
    "Logical surface draw count differs from the shared prototype count.",
  );
  assert(
    result.renderer.submittedTriangles === result.workload.submittedTriangleCount,
    "Triangle submission differs from the shared workload.",
  );
  assert(result.frameIntervals.samples === evidence.config.frames - 1, "Frame sample count changed.");
  assert(result.cpuSubmit.samples === evidence.config.frames, "CPU sample count changed.");
  assert(Number.isFinite(result.cpuSubmit.p95Ms), "CPU p95 is missing.");
  assert(Number.isFinite(result.frameIntervals.p95Ms), "Frame p95 is missing.");
  contracts.add(JSON.stringify(result.features));
  workloads.add(JSON.stringify(result.workload));

  const screenshot = await readFile(resolve(directory, entry.screenshot.path));
  assert(screenshot.byteLength === entry.screenshot.bytes, "Screenshot byte count changed.");
  assert(sha256(screenshot) === entry.screenshot.sha256, "Screenshot digest changed.");
}

for (const combination of ["chrome/madi", "chrome/three", "firefox/madi", "firefox/three"]) {
  assert(combinations.has(combination), `Missing ${combination} benchmark result.`);
}
assert(contracts.size === 1, "Backend feature contracts differ.");
assert(workloads.size === 1, "Backends did not receive identical workload statistics.");
assert(
  evidence.comparisonContract.explicitEdges === false &&
    evidence.comparisonContract.frustumCulling === "disabled" &&
    evidence.comparisonContract.lod === false &&
    evidence.comparisonContract.selfHostedStaticOrigin === true &&
    evidence.comparisonContract.outboundRequestCount === 0,
  "First evidence must retain its deliberately narrow comparison scope.",
);

console.log(
  `[industrial-benchmark] verified ${evidence.results.length} exploratory browser/backend runs ` +
    `at ${evidence.results[0].result.workload.occurrenceCount.toLocaleString("en-US")} occurrences`,
);
