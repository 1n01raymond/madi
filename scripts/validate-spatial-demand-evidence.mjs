import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(repositoryRoot, "artifacts/spatial-demand");
const evidence = JSON.parse(await readFile(resolve(directory, "evidence.json"), "utf8"));
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

console.log(
  "[spatial-demand] verified headed Chrome/Firefox: " +
    "localized 1/3 chunks and 1/10 occurrences with obsolete Range cancellation",
);
