/**
 * Validates the embedder override record that closes ADR-0011's open gate.
 *
 * Two claims are checked. First, every committed package still opens under the
 * reviewed defaults through a consumer that shares no code with the Studio --
 * the check-chain regression docs/PHASE_2.md asks for. Second, each override
 * axis is exercised and refuses with the message a host would actually see;
 * the messages are pinned because they are the surface an embedder debugs
 * against, so a reworded refusal is a decision to record, not to absorb.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/security/embedder-overrides");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[embedder-overrides] ${message}`);
}

const evidenceText = await readFile(
  resolve(artifactDirectory, "embedder-override-evidence.json"),
  "utf8",
);
const evidence = JSON.parse(evidenceText);

assert(
  evidence.schemaVersion === "naru.embedder-override-evidence.1",
  "Unknown evidence envelope.",
);
assert(
  evidence.mode === "second-consumer-transfer-policy-matrix",
  "Unexpected recording mode.",
);
assert(
  // A letter followed by a separator is only a drive path when a letter does not
  // precede it; every URL in this record contains "p://".
  !/(^|[^A-Za-z])[A-Za-z]:[\\/]/u.test(evidenceText),
  "Evidence leaks a machine-local path.",
);
assert(
  Number.isFinite(Date.parse(evidence.recordedAt)),
  "Evidence is missing its recording timestamp.",
);
assert(
  !/127\.0\.0\.1|localhost/u.test(evidenceText),
  "Evidence carries a per-run address instead of a stable origin label.",
);

// The reviewed defaults, restated here so a widened ceiling has to be argued in
// a pull request rather than inherited by re-recording.
assert(
  JSON.stringify(evidence.defaults.transfer) ===
    JSON.stringify({
      documentBytes: 1_073_741_824,
      resourceBytes: 2_147_483_648,
      packageBytes: 8_589_934_592,
      resourceCount: 256,
    }),
  "The reviewed transfer ceilings changed.",
);
assert(
  evidence.defaults.structural.nodes === 2_000_000 &&
    evidence.defaults.structural.meshes === 1_000_000 &&
    evidence.defaults.structural.accessors === 4_000_000 &&
    evidence.defaults.structural.bufferViews === 4_000_000 &&
    evidence.defaults.structural.targetChunks === 65_536 &&
    evidence.defaults.structural.traversalDepth === 64,
  "The reviewed structural ceilings changed.",
);

// The record must have opened the packages this repository actually committed.
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const corpus of evidence.corpora) {
  const documentBytes = await readFile(
    resolve(repositoryRoot, corpus.directory, "scene.gltf"),
  );
  assert(
    documentBytes.byteLength === corpus.documentByteLength &&
      sha256(documentBytes) === corpus.documentSha256,
    `${corpus.id} no longer matches the committed ${corpus.directory}/scene.gltf.`,
  );
  for (const resource of corpus.resources) {
    const bytes = await readFile(resolve(repositoryRoot, corpus.directory, resource.uri));
    assert(
      bytes.byteLength === resource.byteLength && sha256(bytes) === resource.sha256,
      `${corpus.id} no longer matches the committed ${corpus.directory}/${resource.uri}.`,
    );
  }
}
assert(
  JSON.stringify(evidence.corpora.map((corpus) => corpus.id)) ===
    JSON.stringify([
      "ifc-explicit-edges",
      "step-repeated-fasteners",
      "step-repeated-fasteners-ap242",
    ]),
  "The corpus set changed.",
);

/**
 * The scenario matrix, pinned. `opened` rows carry the decoded totals, so an
 * override that quietly changed what a package yields fails here; `refused`
 * rows carry the exact message, because that message is what tells a host which
 * of its own numbers stopped the load.
 */
const expected = new Map([
  ["defaults-ifc-explicit-edges", {
    axis: "reviewed-defaults", outcome: "opened", representation: "target",
    prototypeBatches: 1, partOccurrences: 1, triangles: 12, edgeSegments: 12,
    binaryByteLength: 492, resources: 3, transfers: 2, servedRequests: 2,
  }],
  ["defaults-coarse-ifc-explicit-edges", {
    axis: "reviewed-defaults", outcome: "opened", representation: "coarse",
    prototypeBatches: 1, partOccurrences: 1, triangles: 12, edgeSegments: 12,
    binaryByteLength: 912, resources: 3, transfers: 2, servedRequests: 2,
  }],
  ["defaults-step-repeated-fasteners", {
    axis: "reviewed-defaults", outcome: "opened", representation: "target",
    prototypeBatches: 3, partOccurrences: 10, triangles: 2_076, edgeSegments: 181,
    binaryByteLength: 188_044, resources: 1, transfers: 2, servedRequests: 2,
  }],
  ["defaults-step-repeated-fasteners-ap242", {
    axis: "reviewed-defaults", outcome: "opened", representation: "target",
    prototypeBatches: 3, partOccurrences: 10, triangles: 2_076, edgeSegments: 181,
    binaryByteLength: 188_044, resources: 2, transfers: 2, servedRequests: 2,
  }],
  ["defaults-coarse-step-repeated-fasteners-ap242", {
    axis: "reviewed-defaults", outcome: "opened", representation: "coarse",
    prototypeBatches: 3, partOccurrences: 10, triangles: 36, edgeSegments: 36,
    binaryByteLength: 2_736, resources: 2, transfers: 2, servedRequests: 2,
  }],
  ["document-ceiling", {
    axis: "transfer-limits", outcome: "refused", errorName: "RangeError",
    errorMessage:
      "http://origin-a/step-repeated-fasteners-ap242/scene.gltf declares 65815 bytes; the limit is 65814.",
  }],
  ["resource-ceiling", {
    axis: "transfer-limits", outcome: "refused", errorName: "RangeError",
    errorMessage: "scene.bin declares 188044 bytes; the limit is 188043.",
  }],
  ["package-ceiling", {
    axis: "transfer-limits", outcome: "refused", errorName: "RangeError",
    errorMessage: "The package declares more than 4096 bytes across its resources.",
  }],
  ["resource-count-ceiling", {
    axis: "transfer-limits", outcome: "refused", errorName: "RangeError",
    errorMessage: "The package declares 3 external resources; the limit is 1.",
  }],
  ["structural-node-ceiling", {
    axis: "structural-limits", outcome: "refused", errorName: "CompiledGltfError",
    errorMessage: "The package declares 13 nodes; the limit is 2.",
  }],
  ["structural-depth-ceiling", {
    axis: "structural-limits", outcome: "refused", errorName: "CompiledGltfError",
    errorMessage: "The active scene nests deeper than 1 nodes at nodes[1].",
  }],
  ["split-host-default", {
    axis: "origins", outcome: "refused", errorName: "TypeError",
    errorMessage:
      "http://origin-b/step-repeated-fasteners-ap242/scene.bin points at http://origin-b; " +
      "package resources must stay on http://origin-a.",
  }],
  ["split-host-announced", {
    axis: "origins", outcome: "opened", representation: "target",
    prototypeBatches: 3, partOccurrences: 10, triangles: 2_076, edgeSegments: 181,
    binaryByteLength: 188_044, resources: 2, transfers: 2, servedRequests: 2,
  }],
  ["injected-transfer", {
    axis: "transfer", outcome: "opened", representation: "target",
    prototypeBatches: 3, partOccurrences: 10, triangles: 2_076, edgeSegments: 181,
    binaryByteLength: 188_044, resources: 2, transfers: 2, servedRequests: 0,
  }],
  ["injected-transfer-bounded", {
    axis: "transfer", outcome: "refused", errorName: "RangeError",
    errorMessage: "scene.bin declares 188044 bytes; the limit is 4096.",
  }],
]);

assert(
  evidence.scenarios.length === expected.size,
  `The record carries ${String(evidence.scenarios.length)} scenarios; ${String(expected.size)} are pinned.`,
);
const seen = new Set();
for (const scenario of evidence.scenarios) {
  const pinned = expected.get(scenario.id);
  assert(pinned !== undefined, `Unpinned scenario ${scenario.id}.`);
  assert(!seen.has(scenario.id), `Scenario ${scenario.id} appears twice.`);
  seen.add(scenario.id);
  assert(scenario.axis === pinned.axis, `${scenario.id} moved to a different axis.`);
  assert(
    scenario.outcome === pinned.outcome,
    `${scenario.id} is ${scenario.outcome}; the record pins ${pinned.outcome}.`,
  );
  if (pinned.outcome === "refused") {
    assert(
      scenario.errorName === pinned.errorName && scenario.errorMessage === pinned.errorMessage,
      `${scenario.id} refused with "${scenario.errorName}: ${scenario.errorMessage}".`,
    );
    continue;
  }
  assert(
    scenario.representation === pinned.representation &&
      scenario.prototypeBatches === pinned.prototypeBatches &&
      scenario.partOccurrences === pinned.partOccurrences &&
      scenario.triangles === pinned.triangles &&
      scenario.edgeSegments === pinned.edgeSegments &&
      scenario.binaryByteLength === pinned.binaryByteLength &&
      scenario.resources.length === pinned.resources &&
      scenario.transfers.length === pinned.transfers &&
      scenario.servedRequests === pinned.servedRequests,
    `${scenario.id} opened to different totals than the record pins.`,
  );
  // A default open must not have inherited a widened ceiling from somewhere.
  if (scenario.axis === "reviewed-defaults") {
    assert(
      JSON.stringify(scenario.transferLimits) === JSON.stringify(evidence.defaults.transfer) &&
        JSON.stringify(scenario.origins) === JSON.stringify(["http://origin-a"]),
      `${scenario.id} did not run on the reviewed defaults.`,
    );
  }
}

const announced = evidence.scenarios.find((scenario) => scenario.id === "split-host-announced");
assert(
  JSON.stringify(announced.origins) === JSON.stringify(["http://origin-a", "http://origin-b"]) &&
    announced.resources.every((resource) => resource.origin === "http://origin-b") &&
    announced.transfers[1].startsWith("http://origin-b/"),
  "The announced-origin scenario did not actually transfer across hosts.",
);
const injected = evidence.scenarios.find((scenario) => scenario.id === "injected-transfer");
assert(
  injected.servedRequests === 0,
  "The injected transfer still reached the servers, so it proves nothing about the axis.",
);
for (const axis of ["reviewed-defaults", "transfer-limits", "structural-limits", "origins", "transfer"]) {
  assert(
    evidence.scenarios.some((scenario) => scenario.axis === axis),
    `No scenario exercises the ${axis} axis.`,
  );
}
assert(
  evidence.summary.defaultOpens === 5 &&
    evidence.summary.opened === 7 &&
    evidence.summary.refused === 8 &&
    evidence.summary.opened + evidence.summary.refused === evidence.summary.scenarios,
  "The summary does not match the scenario ledger.",
);

console.log(
  `[embedder-overrides] verified ${String(evidence.summary.scenarios)} scenarios over ` +
    `${String(evidence.corpora.length)} committed packages: ` +
    `${String(evidence.summary.defaultOpens)} open on the reviewed defaults, ` +
    `${String(evidence.summary.refused)} refused through a stated limit`,
);
