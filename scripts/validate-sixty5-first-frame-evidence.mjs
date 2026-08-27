import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDirectory = fileURLToPath(
  new URL("../artifacts/ifc/sixty5-first-frame", import.meta.url),
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
  evidence.source.packageDigest === buildReport.output.packageDigest &&
    JSON.stringify(evidence.source.resources) === JSON.stringify(buildReport.output.resources),
  "First-frame evidence must use the digest-pinned sixty5 package.",
);
assert(
  evidence.browser.id === "chrome" &&
    evidence.browser.engine === "Blink" &&
    evidence.browser.headless === false,
  "The first-frame record must come from headed Chrome/Blink.",
);

const { hierarchyReadyMs, coarseFrameMs, readyMs } = evidence.milestones;
assert(
  Number.isFinite(hierarchyReadyMs) &&
    Number.isFinite(coarseFrameMs) &&
    Number.isFinite(readyMs) &&
    0 < hierarchyReadyMs &&
    hierarchyReadyMs < coarseFrameMs &&
    coarseFrameMs < readyMs,
  "Milestones must record hierarchy before coarse before ready.",
);
// Ratcheted from 15 s / 10 s once the assembly list stopped materializing one
// element per hierarchy entry; the record itself presents at 4.340 s.
assert(
  coarseFrameMs <= 8_000 && coarseFrameMs - hierarchyReadyMs <= 4_000,
  "The shared-coarse record must present its first frame within 8 s overall and 4 s of hierarchy.",
);
// The drain no longer stops at the first rejected chunk, the ready state is
// stamped only once the scheduler is idle, and unadmittable chunks are never
// fetched, so the record settles at 8.277 s (median of three runs: 7.669 s,
// 8.277 s, 8.459 s) instead of admitting past its own ready stamp.
assert(readyMs <= 20_000, "The settled record must reach its ready state within 20 s.");

const { dataset } = evidence.snapshot;
const budgetBytes = Number(dataset.residencyBudgetBytes);
assert(
  dataset.hierarchyReady === "true" &&
    dataset.coarseReady === "true" &&
    dataset.targetReady === "limited" &&
    dataset.residencyBudgetReached === "true",
  "The optimized record must reach a budget-limited rendered state through coarse residency.",
);
assert(
  dataset.targetChunksReady === "93" && dataset.targetChunksTotal === "234",
  "Skip-and-continue admission must admit the recorded 93/234 target chunk set.",
);
// Estimate-gated prefetch: every demanded chunk is still considered exactly
// once per demand signature, but the 141 the budget cannot take are refused
// from their measured cost, so they cost neither a range request nor a decode.
assert(
  dataset.targetSchedulerRequests === "93" &&
    dataset.targetSchedulerSkips === "141" &&
    Number(dataset.targetSchedulerRequests) + Number(dataset.targetSchedulerSkips) ===
      Number(dataset.targetChunksTotal),
  "The gate must skip the 141 unadmittable chunks and request only the 93 it admits.",
);
assert(
  dataset.residentDecodedBytes === "66927984" &&
    dataset.residentGpuBytes === "67011312" &&
    Number(dataset.residentDecodedBytes) <= budgetBytes &&
    Number(dataset.residentGpuBytes) <= budgetBytes,
  "The deterministic optimized resident set must remain inside both 64 MiB budgets.",
);
assert(
  evidence.snapshot.occurrenceCount === "78173" &&
    dataset.visibleOccurrences === "78173" &&
    evidence.snapshot.prototypeCount === "42435",
  "The optimized record must retain every sixty5 occurrence and prototype identity.",
);
assert(
  evidence.snapshot.triangleCount === "1,849,190" && evidence.snapshot.edgeCount === "12",
  "The optimized resident frame must report its deterministic shared-coarse geometry counts.",
);
assert(
  evidence.snapshot.statusState === "ready" &&
    evidence.snapshot.statusStage === "rendered" &&
    evidence.snapshot.status ===
      "Residency budget reached · 20833 surface batches retained · 78173 renderable occurrences",
  "The optimized scene must reach its deterministic rendered ready state.",
);
assert(
  Number(evidence.picking?.selectedObjectId) === 148736 &&
    /node 148735 · ID 148736/u.test(evidence.picking?.selection ?? ""),
  "Picking must resolve the same concrete foundation beam.",
);
assert(
  evidence.semanticProperties?.state === "resolved" &&
    evidence.semanticProperties.entryCount === 6 &&
    evidence.semanticProperties.sampleEntries.some(
      (entry) => entry.key === "ifc.globalId" && entry.value === "21a09V0k97ORkNuf1$cKaV",
    ),
  "The picked beam must resolve its six IFC2X3 property entries.",
);

const rangeResponses = evidence.binaryRequests.filter(
  (request) => request.resource.startsWith("scene.bin") && request.range !== null,
);
// 94 = the 93 admitted chunks plus the one the selection path pins after
// picking. Fetching every demanded chunk cost 245 responses before the gate.
assert(
  rangeResponses.length === 94 &&
    rangeResponses.every(
      (request) => request.status === 206 && /^bytes=\d+-\d+$/u.test(request.range),
    ),
  "Every promoted target chunk must come from a satisfied HTTP Range request.",
);
// Decoding 141 chunks the budget then rejected peaked at 1.788 GB, including a
// single ~75 MB chunk no 64 MiB budget can ever admit.
assert(
  evidence.snapshot.usedJsHeapBytes <= 1_600_000_000,
  "The gated record must stay below the heap the fetch-everything drain reached.",
);
assert(
  Array.isArray(evidence.consoleIssues) && evidence.consoleIssues.length === 0,
  "The first-frame record must be free of console and page errors.",
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
  `[sixty5-first-frame] validated: ${(coarseFrameMs / 1000).toFixed(3)}s coarse frame · ` +
    `${dataset.targetChunksReady}/${dataset.targetChunksTotal} target chunks · ` +
    `${dataset.targetSchedulerRequests} requested, ${dataset.targetSchedulerSkips} skipped · ` +
    `${dataset.visibleOccurrences} visible occurrences`,
);
