/**
 * Validates what relocating mesh-less hierarchy nodes out of the compiled glTF
 * document costs and recovers.
 *
 * The byte counts and digests below are HOST-LOCAL: this Windows host's IFC
 * adapter emits a Scene IR split that differs from the macOS host's by a few
 * bytes, so a re-record on another machine will not reproduce them. Retarget
 * them only together with a deliberate re-record, never to make a failing run
 * pass.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const recordPath = resolve(
  repositoryRoot,
  "artifacts/compiler/hierarchy-relocation/hierarchy-relocation.json",
);

function assert(condition, message) {
  if (!condition) throw new TypeError(`[hierarchy-relocation] ${message}`);
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const recordText = await readFile(recordPath, "utf8");
const record = JSON.parse(recordText);

assert(
  record.schemaVersion === "naru.hierarchy-relocation.1",
  "Unknown evidence envelope.",
);
assert(
  record.mode === "relocated-hierarchy-package-comparison",
  "Evidence mode changed.",
);
assert(!/[A-Za-z]:[\\/]/u.test(recordText), "Evidence leaks a machine-local path.");
assert(record.host.platform === "win32", "Record was taken on another platform.");

/** Every counter the record must reproduce, per model. */
const EXPECTED = {
  "digital-hub": {
    structureBytes: 29_843_011,
    occurrenceCount: 13_681,
    baseline: {
      documentBytes: 20_562_117,
      packageBytes: 63_180_193,
      packageDigest: "39063c01ed7e",
      gltfNodeCount: 13_682,
      nodeArrayBytes: 7_546_566,
      meshlessNodeCount: 8_530,
    },
    relocated: {
      documentBytes: 15_871_835,
      packageBytes: 61_511_210,
      packageDigest: "fb182b5c1764",
      gltfNodeCount: 5_153,
      nodeArrayBytes: 2_831_416,
      hierarchyJsonBytes: 2_547,
      hierarchyBinaryBytes: 3_018_752,
    },
    delta: {
      documentBytes: -4_690_282,
      documentPercent: -22.81,
      packageBytes: -1_668_983,
      packagePercent: -2.64,
      sidecarBytes: 3_021_299,
      relocatedNodes: 8_529,
    },
    upperBoundBytes: 4_635_501,
  },
  "engineering-baseline": {
    structureBytes: 544_042_274,
    occurrenceCount: 268_001,
    baseline: {
      documentBytes: 405_570_167,
      packageBytes: 854_447_023,
      packageDigest: "04472c9ad292",
      gltfNodeCount: 268_002,
      nodeArrayBytes: 146_892_022,
      meshlessNodeCount: 163_665,
    },
    relocated: {
      documentBytes: 317_466_183,
      packageBytes: 831_168_277,
      packageDigest: "f908c7df6728",
      gltfNodeCount: 104_338,
      nodeArrayBytes: 58_168_565,
      hierarchyJsonBytes: 13_454,
      hierarchyBinaryBytes: 64_811_784,
    },
    delta: {
      documentBytes: -88_103_984,
      documentPercent: -21.72,
      packageBytes: -23_278_746,
      packagePercent: -2.72,
      sidecarBytes: 64_825_238,
      relocatedNodes: 163_664,
    },
    upperBoundBytes: 88_741_293,
  },
};

assert(record.models.length === 2, "The record must cover both models.");
for (const model of record.models) {
  const expected = EXPECTED[model.label];
  assert(expected, `Unknown model ${model.label}.`);
  const where = model.label;
  assert(
    model.sourceStructure.byteLength === expected.structureBytes &&
      sha256Pattern.test(model.sourceStructure.sha256),
    `${where} compiled from another Scene IR split.`,
  );
  assert(
    model.occurrenceCount === expected.occurrenceCount,
    `${where} carries a different occurrence count.`,
  );

  for (const variant of ["baseline", "relocated"]) {
    const pins = expected[variant];
    const measured = model[variant];
    assert(
      measured.documentBytes === pins.documentBytes,
      `${where}/${variant} document is ${measured.documentBytes} B, expected ${pins.documentBytes} B.`,
    );
    assert(
      measured.packageBytes === pins.packageBytes &&
        measured.packageDigest.startsWith(pins.packageDigest),
      `${where}/${variant} package changed.`,
    );
    assert(
      measured.gltfNodeCount === pins.gltfNodeCount &&
        measured.nodeSplit.nodeArrayBytes === pins.nodeArrayBytes,
      `${where}/${variant} node array changed.`,
    );
    assert(sha256Pattern.test(measured.documentSha256), `${where}/${variant} digest is malformed.`);
    // Both variants must compile under the same option policy, or the byte
    // comparison below is measuring more than one change.
    assert(
      measured.options.jsonFormatting === "compact" &&
        measured.options.resourceNames === "omitted" &&
        measured.options.targetPayloadOrder === "spatial-leaf-anchor-v1",
      `${where}/${variant} did not compile with the shared option policy.`,
    );
  }
  assert(
    model.baseline.options.hierarchyNodes === undefined &&
      model.relocated.options.hierarchyNodes === "relocated",
    `${where} variants no longer differ by exactly the relocation option.`,
  );

  // The default output still carries the whole tree, and the relocated one
  // keeps only the drawing nodes: one mesh-less node survives as the scene's
  // own root placeholder, and no node keeps children.
  assert(
    model.baseline.nodeSplit.meshlessNodeCount === expected.baseline.meshlessNodeCount &&
      model.baseline.nodeSplit.childrenBytes > 0,
    `${where} default document no longer holds the mesh-less tree.`,
  );
  assert(
    model.relocated.nodeSplit.meshlessNodeCount <= 1 &&
      model.relocated.nodeSplit.childrenBytes === 0,
    `${where} relocated document still holds mesh-less nodes or child lists.`,
  );

  const sidecar = model.relocated.sidecar;
  assert(
    sidecar.json?.path === "hierarchy.json" && sidecar.columns?.path === "hierarchy.bin",
    `${where} sidecar resources are not the two the option declares.`,
  );
  assert(
    sidecar.json.bytes === expected.relocated.hierarchyJsonBytes &&
      sidecar.columns.bytes === expected.relocated.hierarchyBinaryBytes &&
      sidecar.totalBytes === expected.delta.sidecarBytes,
    `${where} sidecar cost changed.`,
  );

  const delta = model.delta;
  assert(
    delta.documentBytes === expected.delta.documentBytes &&
      delta.documentPercent === expected.delta.documentPercent,
    `${where} document delta changed.`,
  );
  assert(
    delta.packageBytes === expected.delta.packageBytes &&
      delta.packagePercent === expected.delta.packagePercent,
    `${where} package delta changed.`,
  );
  assert(
    delta.relocatedNodes === expected.delta.relocatedNodes &&
      delta.relocatedNodes === model.baseline.gltfNodeCount - model.relocated.gltfNodeCount,
    `${where} relocated a different number of nodes.`,
  );
  // The sidecar is charged against the bytes it removes: what the document
  // shed minus what the sidecar costs must be exactly what the package shed,
  // or some other resource moved and the comparison is not about relocation.
  assert(
    delta.netBytes === delta.packageBytes && delta.netMatchesPackage === true,
    `${where} package delta is not the document saving less the sidecar.`,
  );
  assert(
    delta.documentBytes + delta.sidecarBytes === delta.packageBytes,
    `${where} sidecar cost does not reconcile the document and package deltas.`,
  );

  // Where the document's change came from. The remainder is the pointer the
  // document gains; a ledger that does not close means something else moved.
  const ledger = model.documentLedger;
  assert(
    ledger.nodeArrayBytes ===
      model.relocated.nodeSplit.nodeArrayBytes - model.baseline.nodeSplit.nodeArrayBytes &&
      ledger.sceneArrayBytes ===
        model.relocated.nodeSplit.sceneArrayBytes - model.baseline.nodeSplit.sceneArrayBytes,
    `${where} document ledger disagrees with the measured byte split.`,
  );
  assert(
    ledger.nodeArrayBytes + ledger.sceneArrayBytes + ledger.remainderBytes ===
      delta.documentBytes,
    `${where} document ledger does not close.`,
  );
  // Relocation flattens the tree, so every retained node becomes a scene root:
  // the scene list grows while the node array shrinks by far more.
  assert(
    ledger.nodeArrayBytes < 0 && ledger.sceneArrayBytes > 0 && ledger.remainderBytes > 0,
    `${where} document ledger no longer has the shape relocation produces.`,
  );
  assert(
    ledger.remainderBytes < 1_000,
    `${where} document gained ${ledger.remainderBytes} B beyond the sidecar pointer.`,
  );

  // The lever was ranked by an upper bound -- every byte of every mesh-less
  // node. The document lands within a few percent of it in both directions:
  // relocation also deletes every child list, which pays for the larger scene
  // list. What the package keeps is a small fraction of the same bound,
  // because the sidecar has to be carried. Both facts stay visible.
  assert(
    model.upperBound.available === true &&
      model.upperBound.upperBoundBytes === expected.upperBoundBytes,
    `${where} no longer cites the ranking record's upper bound.`,
  );
  assert(
    Math.abs(-delta.documentBytes - expected.upperBoundBytes) <
      expected.upperBoundBytes * 0.05,
    `${where} document saving parted from the mesh-less node bound.`,
  );
  assert(
    -delta.packageBytes < expected.upperBoundBytes * 0.4,
    `${where} package saving is no longer a fraction of the upper bound; ` +
      "the sidecar may have stopped being charged.",
  );

  assert(
    model.determinism.identical === true && model.determinism.repeats === 2,
    `${where} repeat compile was not byte-identical.`,
  );
  assert(
    model.determinism.documentDigests[0] === model.relocated.documentSha256 &&
      model.determinism.packageDigests[0] === model.relocated.packageDigest &&
      model.determinism.sidecarDigests[0] === sidecar.columns.sha256,
    `${where} determinism run compiled a different variant.`,
  );
}

const roundTrip = record.roundTrip;
assert(roundTrip.label === "digital-hub", "Round trip moved to another model.");
assert(
  roundTrip.hierarchyEntriesCompared === 13_681 &&
    roundTrip.instancesCompared === 5_152 &&
    roundTrip.relocatedCount === 8_529,
  "Round trip compared a different tree.",
);
assert(
  roundTrip.mismatchCount === 0 && roundTrip.mismatches.length === 0 && roundTrip.identical === true,
  "The relocated assembly tree no longer round-trips exactly.",
);
// Relocation moves where the tree is stored, not what the scene draws.
assert(
  roundTrip.baseline.triangles === roundTrip.relocated.triangles &&
    roundTrip.baseline.binaryBytes === roundTrip.relocated.binaryBytes &&
    roundTrip.baseline.prototypeBatches === roundTrip.relocated.prototypeBatches,
  "Relocating hierarchy nodes changed the decoded geometry.",
);
assert(
  roundTrip.baseline.hierarchyEntries === roundTrip.relocated.hierarchyEntries &&
    roundTrip.baseline.renderableOccurrences === roundTrip.relocated.renderableOccurrences,
  "The relocated package reports a different tree size than the default one.",
);
// The point of the lever: the document the client parses holds only the nodes
// that draw, while the tree it can still read is the whole one.
assert(
  roundTrip.relocated.documentNodes < roundTrip.baseline.documentNodes &&
    roundTrip.relocated.documentNodes === roundTrip.relocated.renderableOccurrences + 1,
  "The relocated document no longer holds exactly the drawing nodes.",
);

for (const model of record.models) {
  console.log(
    `[hierarchy-relocation] ${model.label}: document ${model.delta.documentPercent}% ` +
      `(${model.delta.documentBytes} B), package ${model.delta.packagePercent}% ` +
      `(${model.delta.packageBytes} B) after a ${model.delta.sidecarBytes} B sidecar, ` +
      `${model.delta.relocatedNodes} of ${model.baseline.gltfNodeCount} nodes relocated`,
  );
}
console.log(
  `[hierarchy-relocation] round trip ${roundTrip.hierarchyEntriesCompared} entries, ` +
    `${roundTrip.instancesCompared} transforms, ${roundTrip.mismatchCount} mismatches`,
);
