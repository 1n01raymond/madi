/**
 * Validates the compiled-document byte split and the two opt-in node-size
 * levers recorded for issue #85.
 *
 * The digests and byte counts below are HOST-LOCAL: this Windows host's IFC
 * adapter emits a split that differs from the macOS host's by a few bytes, so
 * a re-record on another machine will not reproduce them. Retarget them only
 * together with a deliberate re-record, never to make a failing run pass.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const recordPath = resolve(
  repositoryRoot,
  "artifacts/compiler/node-field-elision/node-field-elision.json",
);

function assert(condition, message) {
  if (!condition) throw new TypeError(`[node-fields] ${message}`);
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const recordText = await readFile(recordPath, "utf8");
const record = JSON.parse(recordText);

assert(
  record.schemaVersion === "naru.node-field-elision.1",
  "Unknown evidence envelope.",
);
assert(record.mode === "compiled-document-byte-split", "Evidence mode changed.");
assert(!/[A-Za-z]:[\\/]/u.test(recordText), "Evidence leaks a machine-local path.");
assert(record.host.platform === "win32", "Record was taken on another platform.");

/** Every counter the record must reproduce, per model. */
const EXPECTED = {
  "digital-hub": {
    structureBytes: 29_843_011,
    documentBytes: 20_562_117,
    nodeCount: 13_682,
    nodeArrayBytes: 7_519_193,
    meshless: { count: 8_530, bytes: 4_635_501 },
    variants: {
      baseline: { bytes: 20_562_117, digest: "39063c01ed7e" },
      identifiers: { bytes: 19_525_631, digest: "28e8542bebc8" },
      transforms: { bytes: 20_499_918, digest: "08f8772d4fcd" },
      both: { bytes: 19_463_432, digest: "26d5465bc2cf" },
    },
    pipelineComparable: false,
  },
  "engineering-baseline": {
    structureBytes: 544_042_274,
    documentBytes: 405_570_167,
    nodeCount: 268_002,
    nodeArrayBytes: 146_356_009,
    meshless: { count: 163_665, bytes: 88_741_293 },
    variants: {
      baseline: { bytes: 405_570_167, digest: "04472c9ad292" },
      identifiers: { bytes: 384_342_202, digest: "e17c132d383e" },
      transforms: { bytes: 403_338_759, digest: "ae2231ac2ea9" },
      both: { bytes: 382_110_794, digest: "0a9fbb2ddb8a" },
    },
    pipelineComparable: true,
  },
};

/** The ranking order the measurement produced, on both models. */
const EXPECTED_ORDER = [
  "hierarchy-node-relocation",
  "identifiers",
  "tag-set-interning",
  "node-name-elision",
  "default-visibility-elision",
  "transforms",
];

assert(record.models.length === 2, "The record must cover both models.");
for (const model of record.models) {
  const expected = EXPECTED[model.label];
  assert(expected, `Unknown model ${model.label}.`);
  const where = `${model.label}`;
  assert(
    model.sourceStructure.byteLength === expected.structureBytes,
    `${where} compiled from another Scene IR split.`,
  );
  assert(sha256Pattern.test(model.sourceStructure.sha256), `${where} split digest is malformed.`);
  assert(
    model.document.bytes === expected.documentBytes &&
      model.document.nodeCount === expected.nodeCount &&
      model.document.nodeArrayBytes === expected.nodeArrayBytes,
    `${where} document byte split changed.`,
  );

  const topLevel = model.document.topLevel;
  assert(topLevel[0].member === "nodes", `${where} nodes is no longer the largest member.`);
  // Every byte is charged to exactly one member except the document's own
  // closing brace, which belongs to no member.
  assert(
    topLevel.reduce((total, entry) => total + entry.bytes, 0) === model.document.bytes - 1,
    `${where} top-level split does not add up to the document.`,
  );
  const fieldBytes = model.document.nodeFields.reduce((total, entry) => total + entry.bytes, 0);
  const classBytes =
    model.document.nodeClasses.meshed.bytes + model.document.nodeClasses.meshless.bytes;
  assert(
    fieldBytes === model.document.nodeArrayBytes && classBytes === model.document.nodeArrayBytes,
    `${where} per-field and per-class splits disagree with the node array.`,
  );

  assert(
    model.document.nodeClasses.meshless.count === expected.meshless.count &&
      model.document.nodeClasses.meshless.bytes === expected.meshless.bytes,
    `${where} mesh-less node accounting changed.`,
  );
  // The semanticId half of the identifier lever never fires on an IFC
  // federation; the saving is entirely sourceRef derived from semanticId.
  assert(
    model.document.nodeFacts.semanticIdFromPrototypeId === 0,
    `${where} now has prototype-derived semanticIds; the record's claim is stale.`,
  );
  assert(
    model.document.nodeFacts.sourceRefFromSemanticId === model.counts.occurrenceCount,
    `${where} no longer derives every sourceRef from its semanticId.`,
  );

  for (const [variant, pins] of Object.entries(expected.variants)) {
    const measured = model.variants[variant];
    assert(measured, `${where} is missing the ${variant} variant.`);
    assert(
      measured.documentBytes === pins.bytes,
      `${where}/${variant} document is ${measured.documentBytes} B, expected ${pins.bytes} B.`,
    );
    assert(
      measured.packageDigest.startsWith(pins.digest),
      `${where}/${variant} package digest changed.`,
    );
    assert(
      measured.options.jsonFormatting === "compact" &&
        measured.options.resourceNames === "omitted" &&
        measured.options.targetPayloadOrder === "spatial-leaf-anchor-v1",
      `${where}/${variant} did not compile with the shared option policy.`,
    );
  }

  assert(model.determinism.identical === true, `${where} repeat compile was not byte-identical.`);
  assert(
    model.determinism.packageDigests[0] === model.variants.both.packageDigest,
    `${where} determinism run compiled a different variant.`,
  );
  assert(
    model.combined.additive === true &&
      model.combined.savedBytes ===
        model.document.bytes - model.variants.both.documentBytes,
    `${where} combined saving is not the sum of its two levers.`,
  );

  assert(
    model.ranking.map((entry) => entry.lever).join() === EXPECTED_ORDER.join(),
    `${where} lever ranking changed: ${model.ranking.map((entry) => entry.lever).join(", ")}`,
  );
  assert(
    model.ranking[0].kind === "candidate-upper-bound" &&
      model.ranking[0].upperBoundBytes === expected.meshless.bytes,
    `${where} top lever is no longer the mesh-less node bound.`,
  );
  for (const entry of model.ranking) {
    assert(
      entry.kind === "measured" ? entry.implemented === true : entry.implemented === false,
      `${where} lever ${entry.lever} mixes a measured saving with an unimplemented one.`,
    );
  }
}

const byLabel = new Map(record.models.map((model) => [model.label, model]));
// The engineering baseline's split directory carries a package the sanctioned
// pipeline wrote under the same options, so the default variant must reproduce
// it exactly -- that is what "the default output is unchanged" means at
// federation scale. Digital Hub's directory was compiled under another option
// policy and is reported as not comparable rather than quietly skipped.
const baselinePipeline = byLabel.get("engineering-baseline").pipelinePackage;
assert(
  baselinePipeline.available === true && baselinePipeline.matchesDefaultVariant === true,
  "The default variant no longer reproduces the pipeline's engineering-baseline package.",
);
assert(
  byLabel.get("digital-hub").pipelinePackage.available === false,
  "Digital Hub's package became comparable; the record's reasoning is stale.",
);

const roundTrip = record.roundTrip;
assert(roundTrip.label === "digital-hub", "Round trip moved to another model.");
assert(
  roundTrip.occurrencesCompared === 5_152 &&
    roundTrip.hierarchyEntriesCompared === 13_681 &&
    roundTrip.instancesCompared === 5_152,
  "Round trip compared a different number of occurrences.",
);
assert(
  roundTrip.mismatchCount === 0 && roundTrip.mismatches.length === 0,
  "Elided identifiers and transforms no longer round-trip exactly.",
);
assert(roundTrip.identical === true, "The two decoded scenes are no longer identical.");
assert(
  roundTrip.baseline.triangles === roundTrip.elided.triangles &&
    roundTrip.baseline.binaryBytes === roundTrip.elided.binaryBytes,
  "Eliding node fields changed the decoded geometry.",
);

for (const model of record.models) {
  const measured = model.ranking.filter((entry) => entry.kind === "measured");
  console.log(
    `[node-fields] ${model.label}: document ${model.document.bytes} B, ` +
      `nodes ${model.document.nodeArrayPercent}% ` +
      `(mesh-less ${model.document.nodeClasses.meshless.bytes} B), ` +
      measured
        .map((entry) => `${entry.lever} -${entry.savedBytes} B (${entry.savedPercent}%)`)
        .join(", "),
  );
}
console.log(
  `[node-fields] round trip ${roundTrip.occurrencesCompared} occurrences, ` +
    `${roundTrip.mismatchCount} mismatches; default output reproduces ` +
    `${baselinePipeline.packageDigest.slice(0, 12)}`,
);
