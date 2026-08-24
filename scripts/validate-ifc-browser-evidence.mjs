import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDirectory = fileURLToPath(
  new URL("../artifacts/ifc/sixty5-browser", import.meta.url),
);
const evidence = JSON.parse(
  await readFile(resolve(evidenceDirectory, "browser-residency.json"), "utf8"),
);
const buildReport = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../artifacts/ifc/sixty5/build-report.json", import.meta.url)),
    "utf8",
  ),
);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

assert(
  evidence.schemaVersion === "madi.ifc-browser-residency.2",
  "Unsupported IFC browser evidence schema.",
);
assert(
  evidence.source.packageDigest === buildReport.output.packageDigest,
  "Browser evidence and sixty5 compile evidence must reference the same package digest.",
);
assert(
  JSON.stringify(evidence.source.resources) === JSON.stringify(buildReport.output.resources),
  "Browser evidence must carry the exact served resource digests from the build report.",
);
assert(
  evidence.browser.id === "chrome" && evidence.browser.engine === "Blink",
  "The real-large record is a headed Chrome/Blink result.",
);
assert(evidence.browser.headless === false, "The record must come from a headed browser.");

// Milestones are measured wall-clock values; the deterministic claim is their
// order, not their duration.
const { hierarchyReadyMs, coarseFrameMs, readyMs } = evidence.milestones;
assert(
  Number.isFinite(hierarchyReadyMs) &&
    Number.isFinite(coarseFrameMs) &&
    Number.isFinite(readyMs) &&
    0 < hierarchyReadyMs &&
    hierarchyReadyMs < coarseFrameMs &&
    coarseFrameMs < readyMs,
  "Milestones must record hierarchy before the coarse frame before the ready state.",
);

const { dataset } = evidence.snapshot;
assert(
  dataset.hierarchyReady === "true" && dataset.coarseReady === "true",
  "The hierarchy and a coarse WebGPU frame must both be recorded.",
);
assert(
  dataset.targetChunksTotal === "234",
  "The sixty5 package coalesces into 234 target chunks.",
);
assert(
  dataset.residencyBudgetBytes === "67108864",
  "The record must run under the default 64 MiB residency budget.",
);
assert(
  dataset.residencyBudgetReached === "true" && dataset.targetReady === "limited",
  "The real-large package must exhaust the fixed budget and stay budget-limited.",
);
// Promotion order and chunk sizes are deterministic, so the budget-limited
// resident set is an exact expectation, not a range.
const budgetBytes = Number(dataset.residencyBudgetBytes);
assert(
  dataset.targetChunksReady === "26",
  "The 64 MiB budget admits exactly 26 of the 234 sixty5 target chunks.",
);
assert(
  dataset.residentDecodedBytes === "66951636" &&
    Number(dataset.residentDecodedBytes) <= budgetBytes,
  "Resident decoded bytes must equal the deterministic 66,951,636-byte set within budget.",
);
assert(
  dataset.residentGpuBytes === "60644136" && Number(dataset.residentGpuBytes) <= budgetBytes,
  "Resident GPU bytes must equal the deterministic 60,644,136-byte set within budget.",
);
const chunksReady = Number(dataset.targetChunksReady);

assert(
  evidence.snapshot.occurrenceCount === "78173",
  "The record must render all 78,173 renderable sixty5 occurrences.",
);
assert(
  evidence.snapshot.prototypeCount === "42435",
  "The record must retain all 42,435 shared sixty5 prototypes.",
);
assert(
  evidence.snapshot.triangleCount === "975,013" &&
    evidence.snapshot.edgeCount === "466,452",
  "The budget-limited frame renders 975,013 triangles and 466,452 coarse edge segments.",
);
assert(
  evidence.snapshot.statusState === "ready" && evidence.snapshot.statusStage === "rendered",
  "The scene must reach the rendered ready state.",
);
assert(
  typeof evidence.snapshot.status === "string" &&
    evidence.snapshot.status.startsWith("Residency budget reached"),
  "The status line must state the budget-limited outcome.",
);
assert(
  typeof evidence.snapshot.usedJsHeapBytes === "number" &&
    evidence.snapshot.usedJsHeapBytes > 0,
  "The Chrome JS heap measurement must be present.",
);

assert(
  /node \d+ · ID \d+/u.test(evidence.picking?.selection ?? ""),
  "Picking must resolve one occurrence to its glTF node and object ID.",
);
assert(
  Number(evidence.picking.selectedObjectId) > 0,
  "Picking must record a non-zero selected object ID.",
);

const properties = evidence.semanticProperties;
assert(
  properties?.state === "resolved" &&
    Number.isInteger(properties.entryCount) &&
    properties.entryCount > 0,
  "The picked occurrence must resolve property entries from the package sidecar.",
);
assert(
  Array.isArray(properties.sampleEntries) &&
    properties.sampleEntries.length > 0 &&
    properties.sampleEntries.every(
      (entry) =>
        typeof entry.key === "string" && entry.key.length > 0 && typeof entry.value === "string",
    ),
  "The recorded property entries must carry key/value text.",
);
// The center-canvas pick is deterministic, so the resolved entry set is an
// exact expectation, like the resident chunk set above.
assert(
  properties.entryCount === 6 &&
    properties.sampleEntries.some(
      (entry) => entry.key === "ifc.globalId" && entry.value === "21a09V0k97ORkNuf1$cKaV",
    ),
  "The picked foundation beam must resolve its 6 recorded property entries.",
);
assert(
  evidence.binaryRequests.some(
    (request) => request.resource.startsWith("properties.bin") && request.status === 200,
  ),
  "The lazy sidecar fetch of properties.bin must appear in the request record.",
);

const rangeResponses = evidence.binaryRequests.filter(
  (request) => request.resource.startsWith("scene.bin") && request.range !== null,
);
assert(
  rangeResponses.length >= chunksReady,
  "Every promoted chunk must come from an HTTP Range request over scene.bin.",
);
assert(
  rangeResponses.every(
    (request) => request.status === 206 && /^bytes=\d+-\d+$/u.test(request.range),
  ),
  "Every scene.bin request must be a satisfied bytes Range (206).",
);

assert(
  Array.isArray(evidence.consoleIssues) && evidence.consoleIssues.length === 0,
  "The record must be free of console warnings, errors, and page errors.",
);

for (const [label, screenshot] of Object.entries(evidence.screenshots)) {
  const bytes = await readFile(resolve(evidenceDirectory, screenshot.path));
  assert(
    bytes.byteLength === screenshot.bytes &&
      createHash("sha256").update(bytes).digest("hex") === screenshot.sha256,
    `Screenshot ${label} (${screenshot.path}) does not match its recorded digest.`,
  );
}

console.log(
  `[ifc-browser] validated: package ${evidence.source.packageDigest.slice(0, 12)} · ` +
    `${dataset.targetChunksReady}/${dataset.targetChunksTotal} chunks resident under ` +
    `${budgetBytes} bytes · coarse frame at ${(coarseFrameMs / 1000).toFixed(1)}s`,
);
