/**
 * Validates the malformed-package campaign recorded for ADR-0011.
 *
 * The record's whole claim is one invariant: a reader either accepts a mutated
 * package or refuses it through a declared error class, and nothing else
 * escapes. Counts are pinned rather than bounded because the campaign is
 * seeded -- a moved count means reader acceptance changed, which is a thing to
 * explain in a pull request, not to re-pin quietly.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/security/package-fuzz");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[package-fuzz] ${message}`);
}

const evidenceText = await readFile(
  resolve(artifactDirectory, "package-fuzz-evidence.json"),
  "utf8",
);
const evidence = JSON.parse(evidenceText);

assert(
  evidence.schemaVersion === "naru.package-fuzz-evidence.1",
  "Unknown evidence envelope.",
);
assert(
  evidence.mode === "seeded-malformed-package-campaign",
  "Unexpected recording mode.",
);
assert(!/[A-Za-z]:[\\/]/u.test(evidenceText), "Evidence leaks a machine-local path.");
assert(
  Number.isFinite(Date.parse(evidence.recordedAt)),
  "Evidence is missing its recording timestamp.",
);

// The declared contract. Widening this set would let a new error class count as
// a controlled rejection without anyone deciding that it should.
assert(
  JSON.stringify(evidence.contract.controlledErrorNames) ===
    JSON.stringify(["CompiledGltfError", "SpatialDemandIndexError"]),
  "The controlled error classes changed.",
);
assert(
  JSON.stringify(evidence.campaign.controlledErrorNames) ===
    JSON.stringify(evidence.contract.controlledErrorNames),
  "The campaign ran against a different contract than the record declares.",
);
for (const reader of [
  "parseCompiledGltf",
  "inspectCompiledHierarchy",
  "prepareCompiledGltfDecoder",
  "decodeCompiledGltf",
  "decodeSpatialDemandIndex",
  "querySpatialDemandIndex",
]) {
  assert(evidence.contract.readers.includes(reader), `Reader ${reader} left the contract.`);
}

// The corpora are committed packages, so the record is reproducible from the
// repository alone; a moved digest means the campaign no longer describes what
// is checked in.
const expectedCorpora = {
  "explicit-edges": {
    directory: "artifacts/ifc/explicit-edges",
    document: "bbabcfdf2108516dfcedecacea9dadb3e8d2c5beea8c14d2444a4fcf249aaa22",
    target: "c2e7f0e7bcd4d28eb51018f75bd20b38b9382f1760cec8c42303819796b2ff3f",
  },
  "repeated-fasteners": {
    directory: "artifacts/phase1/repeated-fasteners",
    document: "ffaad9710d56f5aed13d9a9a746ad3c59f6444630334ffa947d079c3b9a45c87",
    target: "3c4d9dde02c117343e4013a675d40d41a61c2f59eb5d3b1959774b434883d395",
  },
  "repeated-fasteners-ap242": {
    directory: "artifacts/phase1/repeated-fasteners-ap242",
    document: "e2f52189091431ce9c0ff94a939c52dee89d9b3ce2b8b9fdb41a0a21a8e1499b",
    target: "3c4d9dde02c117343e4013a675d40d41a61c2f59eb5d3b1959774b434883d395",
  },
};

assert(evidence.corpora.length === 3, "Expected exactly three fuzz corpora.");
for (const corpus of evidence.corpora) {
  const expected = expectedCorpora[corpus.id];
  assert(expected, `Unknown fuzz corpus ${corpus.id}.`);
  assert(
    corpus.directory === expected.directory,
    `${corpus.id} moved away from ${expected.directory}.`,
  );
  assert(
    corpus.document.sha256 === expected.document,
    `${corpus.id} document digest changed.`,
  );
  assert(
    corpus.targetBuffer.sha256 === expected.target,
    `${corpus.id} target buffer digest changed.`,
  );
  const [documentBytes, targetBytes] = await Promise.all([
    readFile(resolve(repositoryRoot, corpus.directory, "scene.gltf")),
    readFile(resolve(repositoryRoot, corpus.directory, "scene.bin")),
  ]);
  assert(
    createHash("sha256").update(documentBytes).digest("hex") === corpus.document.sha256 &&
      documentBytes.byteLength === corpus.document.byteLength,
    `${corpus.id} no longer matches the committed scene.gltf.`,
  );
  assert(
    createHash("sha256").update(targetBytes).digest("hex") === corpus.targetBuffer.sha256 &&
      targetBytes.byteLength === corpus.targetBuffer.byteLength,
    `${corpus.id} no longer matches the committed scene.bin.`,
  );
}

assert(
  evidence.spatialSeed.sha256 ===
    "383fac870e811cebf207076a66842a5838177edeb3cbd5ededb189f9e804617c" &&
    evidence.spatialSeed.byteLength === 3832,
  "The spatial demand seed changed; the encoder no longer produces the fuzzed bytes.",
);

// Per-target ledger. `accepted` is pinned alongside `rejected` because a
// package the reader used to serve and now refuses is as much a behaviour
// change as the reverse.
const expectedTargets = {
  "explicit-edges/target": { accepted: 6120, rejected: 13_880 },
  "explicit-edges/coarse": { accepted: 3791, rejected: 16_209 },
  "repeated-fasteners/target": { accepted: 4427, rejected: 15_573 },
  "repeated-fasteners-ap242/target": { accepted: 11_866, rejected: 8134 },
  "repeated-fasteners-ap242/coarse": { accepted: 4055, rejected: 15_945 },
  "spatial-demand-index": { accepted: 5086, rejected: 14_914 },
};
const gltfCodes = new Set([
  "INVALID_GLTF",
  "UNSUPPORTED_PROFILE",
  "UNSUPPORTED_GEOMETRY",
  "INVALID_BINARY",
]);

assert(evidence.campaign.seed === 20_260_829, "The campaign seed changed.");
assert(
  evidence.campaign.iterationsPerTarget === 20_000,
  "The campaign no longer runs 20,000 iterations per target.",
);
assert(
  evidence.campaign.targets.length === Object.keys(expectedTargets).length,
  "The fuzz target set changed.",
);
for (const target of evidence.campaign.targets) {
  const expected = expectedTargets[target.id];
  assert(expected, `Unknown fuzz target ${target.id}.`);
  assert(
    target.executions === evidence.campaign.iterationsPerTarget,
    `${target.id} did not run the declared iteration count.`,
  );
  assert(
    target.uncontrolled === 0 && Object.keys(target.uncontrolledByKind).length === 0,
    `${target.id} left a reader through an undeclared error.`,
  );
  assert(
    target.accepted === expected.accepted && target.rejected === expected.rejected,
    `${target.id} acceptance moved to ${target.accepted}/${target.rejected}; ` +
      "explain the reader change before re-pinning.",
  );
  assert(
    target.accepted + target.rejected + target.uncontrolled === target.executions,
    `${target.id} ledger does not balance.`,
  );
  const codes = Object.keys(target.rejectionsByCode);
  assert(codes.length > 0, `${target.id} rejected nothing.`);
  for (const code of codes) {
    assert(
      target.id === "spatial-demand-index"
        ? code === "SpatialDemandIndexError"
        : gltfCodes.has(code),
      `${target.id} reported an undeclared rejection code ${code}.`,
    );
  }
  // Every mutation operator has to stay represented, or the campaign narrowed
  // without a count moving far enough to notice. The demand sidecar is bytes
  // alone, so it carries binary operators and no document ones.
  const documentMutated = target.id !== "spatial-demand-index";
  assert(
    Object.keys(target.documentOperators).length > 0 === documentMutated,
    `${target.id} mutated the wrong half of its input.`,
  );
  if (documentMutated) {
    for (const operator of ["chain", "delete", "replace", "retype", "scale"]) {
      assert(
        target.documentOperators[operator] > 0,
        `${target.id} never applied the ${operator} operator.`,
      );
    }
  }
  for (const operator of ["intact", "truncate", "flip", "grow"]) {
    assert(
      target.binaryOperators[operator] > 0,
      `${target.id} never applied the ${operator} binary operator.`,
    );
  }
}

const totals = evidence.campaign.totals;
assert(totals.executions === 120_000, "The campaign no longer runs 120,000 executions.");
assert(totals.uncontrolled === 0, "A reader crashed outside its declared error classes.");
assert(
  evidence.campaign.uncontrolledSamples.length === 0,
  "The record carries uncontrolled samples.",
);
assert(
  totals.accepted + totals.rejected === totals.executions &&
    totals.accepted ===
      evidence.campaign.targets.reduce((sum, target) => sum + target.accepted, 0),
  "Campaign totals do not match the per-target ledger.",
);

console.log(
  `[package-fuzz] verified ${totals.executions} executions over ` +
    `${evidence.campaign.targets.length} targets: ${totals.accepted} accepted, ` +
    `${totals.rejected} rejected through a declared error class, ` +
    `${totals.uncontrolled} uncontrolled`,
);
