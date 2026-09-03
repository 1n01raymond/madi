/**
 * Validates artifacts/import/structure-first-emission: the ADR-0021 gate 1
 * record -- the adapter publishing one document's assembly tree before it
 * tessellates that document, watched from outside the process.
 *
 * Pins are deliberate. Node counts, root counts, source bytes, emission order
 * and the four output digests are functions of the fixture and of the code
 * that reads it, so they are pinned exactly. They must not be retargeted to
 * absorb a re-record: a moved node count means the tree changed, and a moved
 * output digest means staging stopped being free. The digests are HOST-LOCAL
 * (this repository has recorded a cross-host eight-byte drift in the IFC
 * adapter's split Scene IR), so a different host reproduces the counts but not
 * necessarily the digests; that is a documented limit of the record, not a
 * licence to loosen the check.
 *
 * Timings are host-dependent and are bounded rather than pinned. What is
 * enforced is the reading the slice rests on: every document publishes its
 * tree before its own extraction finishes, every published node count equals
 * the Scene IR occurrence count for the same document, both arms wrote the
 * same bytes, and the record's verdicts follow from its own seconds against
 * the product target quoted from issue #73, which may not be widened here.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const recordDirectory = resolve(repositoryRoot, "artifacts/import/structure-first-emission");

const schemaVersion = "naru.structure-first-emission.1";
const mode = "fresh-process-staged-adapter-emission";
const previewSchemaVersion = "naru.ifc-structure-preview.1";
const indexSchemaVersion = "naru.ifc-structure-preview-index.1";
const manifestSha256 = "77d7d587d6b32938a371325e281a4584e10c2ff3118a59f300a9da097eb2f478";
/** The product target of issue #73, restated so a record cannot widen it. */
const productTarget = { lowerSeconds: 5, upperSeconds: 15 };
/** Publishing a tree is a write, not a computation; it may not grow into one. */
const publishCeilingMilliseconds = 2000;

const models = {
  "digital-hub": {
    datasetId: "ifc-bench-digital-hub",
    sampleCount: 5,
    emissionOrder: ["architecture", "ventilation", "heating", "plumbing"],
    firstTreeWithinUpperBound: true,
    wholeFederationWithinUpperBound: false,
    digests: {
      "scene-ir.json": "b8ec9c532231a9e464e1ee0d27e26444df16556b11a36d81b180703bb1a214bf",
      "scene-ir-geometry.bin": "4f6ddbe99c15e0976bc097b978d0c54cbdc9a2ea0c67663ce8dac8ab21ce232b",
      "scene-ir-properties.bin": "712fea65ca4b9de75683a01ee79f4fff5ae6f89b0c29cbd0b38a83bb586d07c1",
      "adapter-report.json": "54aeea7049e213d29b1cf7e94e3aeac832742223bd132a179f0af20277db43b8",
    },
    documents: {
      architecture: { sourceBytes: 9022255, emissionRank: 0, nodeCount: 1027, readinessStructureEntries: 783 },
      ventilation: { sourceBytes: 12737833, emissionRank: 1, nodeCount: 3972, readinessStructureEntries: 1316 },
      heating: { sourceBytes: 20890415, emissionRank: 2, nodeCount: 5561, readinessStructureEntries: 1801 },
      plumbing: { sourceBytes: 25178864, emissionRank: 3, nodeCount: 3121, readinessStructureEntries: 1016 },
    },
  },
  sixty5: {
    datasetId: "ifc-bench-sixty5",
    sampleCount: 5,
    emissionOrder: ["facade", "structure", "kitchen", "electrical", "ventilation", "plumbing", "architecture"],
    firstTreeWithinUpperBound: true,
    wholeFederationWithinUpperBound: false,
    digests: {
      "scene-ir.json": "27e70a663cf190d1dd32b359ff6ba7533fced31f16235072c0502c4ffe47bbfa",
      "scene-ir-geometry.bin": "cdac45ab02f9ddb8546e72c5af5e75510c7b32113231e8a55d20764cc09ea774",
      "scene-ir-properties.bin": "dad8d98909c738df930569c4b907c29e64cda2b65d84917936c1c4d86d3dd8c4",
      "adapter-report.json": "eb7bce474a38470a7cfe8e0a339592963c151a05dde1780b25fd2f7f3f3b5554",
    },
    documents: {
      architecture: { sourceBytes: 342657851, emissionRank: 6, nodeCount: 16785, readinessStructureEntries: 16534 },
      electrical: { sourceBytes: 97058912, emissionRank: 3, nodeCount: 56979, readinessStructureEntries: 19897 },
      facade: { sourceBytes: 6067026, emissionRank: 0, nodeCount: 1076, readinessStructureEntries: 1076 },
      kitchen: { sourceBytes: 49670229, emissionRank: 2, nodeCount: 3118, readinessStructureEntries: 3118 },
      plumbing: { sourceBytes: 222099255, emissionRank: 5, nodeCount: 70183, readinessStructureEntries: 22725 },
      structure: { sourceBytes: 7422441, emissionRank: 1, nodeCount: 2688, readinessStructureEntries: 1404 },
      ventilation: { sourceBytes: 114891068, emissionRank: 4, nodeCount: 37490, readinessStructureEntries: 12056 },
    },
  },
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const isDistribution = (value) =>
  value !== null &&
  typeof value === "object" &&
  Array.isArray(value.values) &&
  ["median", "p95", "minimum", "maximum"].every((key) => typeof value[key] === "number");

for (const [modelId, expected] of Object.entries(models)) {
  const label = `[structure-first-emission] ${modelId}`;
  const record = JSON.parse(await readFile(resolve(recordDirectory, `${modelId}.json`), "utf8"));
  check(record.schemaVersion === schemaVersion, `${label}: schemaVersion ${record.schemaVersion}`);
  check(record.mode === mode, `${label}: mode ${record.mode}`);
  check(record.model === modelId, `${label}: model ${record.model}`);
  check(record.fixture?.datasetId === expected.datasetId, `${label}: dataset ${record.fixture?.datasetId}`);
  check(record.fixture?.manifest?.sha256 === manifestSha256, `${label}: manifest sha256 ${record.fixture?.manifest?.sha256}`);
  check(typeof record.commit?.head === "string" && record.commit.head.length === 40, `${label}: commit head missing`);
  check(typeof record.adapter?.fingerprint === "string" && record.adapter.fingerprint.length === 64, `${label}: adapter identity missing`);
  check(record.tool?.previewSchema === previewSchemaVersion, `${label}: preview schema ${record.tool?.previewSchema}`);
  check(record.tool?.previewIndexSchema === indexSchemaVersion, `${label}: index schema ${record.tool?.previewIndexSchema}`);

  const disciplines = Object.keys(expected.documents);
  check(record.protocol?.sampleCount === expected.sampleCount, `${label}: sampleCount ${record.protocol?.sampleCount}, pinned ${expected.sampleCount}`);
  check(record.protocol?.discardedSamples === 0, `${label}: discardedSamples ${record.protocol?.discardedSamples}`);
  check(record.protocol?.warmUpRuns >= 1, `${label}: no warm-up declared`);
  check(Array.isArray(record.protocol?.caveats) && record.protocol.caveats.length >= 3, `${label}: protocol caveats missing`);
  check(
    record.samples?.length === expected.sampleCount * 2,
    `${label}: ${record.samples?.length} samples for ${expected.sampleCount} per arm`,
  );

  // Both arms ran, interleaved, and wrote the same bytes as each other.
  const arms = record.samples?.map((sample) => sample.arm) ?? [];
  check(arms.filter((arm) => arm === "staged").length === expected.sampleCount, `${label}: ${arms.filter((a) => a === "staged").length} staged samples`);
  check(arms.filter((arm) => arm === "plain").length === expected.sampleCount, `${label}: ${arms.filter((a) => a === "plain").length} plain samples`);
  check(
    arms.every((arm, index) => arm === (index % 2 === 0 ? "staged" : "plain")),
    `${label}: arms are not interleaved: ${arms.join(",")}`,
  );
  const identity = record.outputIdentity ?? {};
  check(Array.isArray(identity.exclusions) && identity.exclusions.length === 0, `${label}: outputIdentity excludes ${identity.exclusions?.length} field(s)`);
  check(
    identity.comparisons === (expected.sampleCount * 2 - 1) * Object.keys(expected.digests).length,
    `${label}: ${identity.comparisons} identity comparisons`,
  );
  for (const [name, digest] of Object.entries(expected.digests)) {
    check(identity.digests?.[name] === digest, `${label}: ${name} ${identity.digests?.[name]}, pinned ${digest}`);
  }
  // Every staged sample published a verified tree for every document, and the
  // index it named them in reached its complete state.
  for (const sample of (record.samples ?? []).filter((entry) => entry.arm === "staged")) {
    const preview = sample.preview ?? {};
    check(preview.complete === true, `${label}: staged sample ${sample.index} left the index incomplete`);
    check(
      preview.observations?.length === disciplines.length,
      `${label}: staged sample ${sample.index} verified ${preview.observations?.length} of ${disciplines.length} trees`,
    );
    check(
      JSON.stringify(preview.observations?.map((entry) => entry.discipline)) ===
        JSON.stringify(expected.emissionOrder),
      `${label}: staged sample ${sample.index} observed ${preview.observations?.map((e) => e.discipline).join(",")}`,
    );
    check(Number.isSafeInteger(preview.contendedReads) && preview.contendedReads >= 0, `${label}: staged sample ${sample.index} contendedReads ${preview.contendedReads}`);
    for (const observation of preview.observations ?? []) {
      const pinned = expected.documents[observation.discipline];
      check(observation.nodeCount === pinned?.nodeCount, `${label}: sample ${sample.index} ${observation.discipline} nodeCount ${observation.nodeCount}, pinned ${pinned?.nodeCount}`);
      check(observation.rootCount >= 1, `${label}: sample ${sample.index} ${observation.discipline} rootCount ${observation.rootCount}`);
      check(observation.parentedNodes === observation.nodeCount - observation.rootCount, `${label}: sample ${sample.index} ${observation.discipline} parented nodes do not account for its roots`);
      check(typeof observation.sha256 === "string" && observation.sha256.length === 64, `${label}: sample ${sample.index} ${observation.discipline} sha256 missing`);
    }
  }

  // Per document: the pinned tree, the Scene IR count it must equal, and gate 0's
  // different count carried beside it so the two trees stay distinguishable.
  for (const discipline of disciplines) {
    const pinned = expected.documents[discipline];
    const entry = record.documents?.find((row) => row.discipline === discipline);
    if (!entry) {
      failures.push(`${label}: ${discipline} missing from documents`);
      continue;
    }
    check(entry.sourceBytes === pinned.sourceBytes, `${label}: ${discipline} sourceBytes ${entry.sourceBytes}, pinned ${pinned.sourceBytes}`);
    check(entry.emissionRank === pinned.emissionRank, `${label}: ${discipline} emissionRank ${entry.emissionRank}, pinned ${pinned.emissionRank}`);
    check(entry.nodeCount === pinned.nodeCount, `${label}: ${discipline} nodeCount ${entry.nodeCount}, pinned ${pinned.nodeCount}`);
    check(entry.sceneIrOccurrenceCount === pinned.nodeCount, `${label}: ${discipline} Scene IR occurrences ${entry.sceneIrOccurrenceCount}, pinned ${pinned.nodeCount}`);
    check(entry.nodeCountMatchesSceneIr === true, `${label}: ${discipline} tree does not match the Scene IR it was extracted beside`);
    check(
      entry.readinessStructureEntries === pinned.readinessStructureEntries,
      `${label}: ${discipline} gate 0 entries ${entry.readinessStructureEntries}, pinned ${pinned.readinessStructureEntries}`,
    );
    for (const [name, value] of Object.entries(entry.milliseconds ?? {})) {
      check(isDistribution(value), `${label}: ${discipline}.${name} is not a distribution`);
      check(value.values?.length === expected.sampleCount, `${label}: ${discipline}.${name} has ${value.values?.length} values`);
    }
    check(
      entry.milliseconds?.structureReady?.maximum < entry.milliseconds?.extractStaged?.minimum,
      `${label}: ${discipline} published its tree no earlier than its extraction finished`,
    );
    check(
      entry.milliseconds?.structurePublish?.maximum <= publishCeilingMilliseconds,
      `${label}: ${discipline} spent ${entry.milliseconds?.structurePublish?.maximum} ms publishing, over the ${publishCeilingMilliseconds} ms ceiling`,
    );
  }

  // The readings the slice rests on, and the verdicts against issue #73.
  const findings = record.findings ?? {};
  const order = findings.emissionOrder ?? {};
  check(JSON.stringify(order.expected) === JSON.stringify(expected.emissionOrder), `${label}: expected order ${order.expected?.join(",")}`);
  check(JSON.stringify(order.declared) === JSON.stringify(expected.emissionOrder), `${label}: declared order ${order.declared?.join(",")}`);
  check(JSON.stringify(order.observed) === JSON.stringify(expected.emissionOrder), `${label}: observed order ${order.observed?.join(",")}`);
  check(order.matchesSourceSize === true, `${label}: emission order no longer follows source size`);
  check(order.stableAcrossSamples === true, `${label}: emission order moved between samples`);
  check(findings.countsAgreeWithSceneIr === true, `${label}: published counts disagree with the Scene IR`);
  check(findings.structureBeforeTessellation?.holds === true, `${label}: a document tessellated before it published its tree`);
  check(
    findings.firstTree?.discipline === expected.emissionOrder[0],
    `${label}: first tree is ${findings.firstTree?.discipline}, pinned ${expected.emissionOrder[0]}`,
  );
  check(
    findings.firstTree?.nodeCount === expected.documents[expected.emissionOrder[0]]?.nodeCount,
    `${label}: first tree carries ${findings.firstTree?.nodeCount} nodes`,
  );
  const cost = findings.stagingCost ?? {};
  check(
    cost.stagedBytes === (record.documents ?? []).reduce((total, entry) => total + entry.byteLength, 0),
    `${label}: staged bytes ${cost.stagedBytes} is not the sum of the published trees`,
  );
  check(cost.publishMilliseconds <= publishCeilingMilliseconds, `${label}: publishing cost ${cost.publishMilliseconds} ms over the whole federation`);
  const completion = findings.federationCompletion ?? {};
  check(
    completion.lastTreeObservedSeconds >= findings.firstTree?.observedSeconds,
    `${label}: the last tree is not published after the first`,
  );
  check(completion.structureOnlyPassSeconds > 0, `${label}: the alternative structure-only pass is unpriced`);

  const target = findings.productTarget ?? {};
  check(
    target.lowerSeconds === productTarget.lowerSeconds && target.upperSeconds === productTarget.upperSeconds,
    `${label}: product target ${target.lowerSeconds}-${target.upperSeconds} s does not match issue #73`,
  );
  const against = findings.againstProductTarget ?? {};
  const verdict = (seconds) => seconds <= productTarget.upperSeconds;
  check(against.firstTreeWithinUpperBound === verdict(against.firstTreeSeconds), `${label}: first-tree verdict does not follow from its seconds`);
  check(against.wholeFederationWithinUpperBound === verdict(against.wholeFederationSeconds), `${label}: federation verdict does not follow from its seconds`);
  check(against.firstTreeWithinUpperBound === expected.firstTreeWithinUpperBound, `${label}: first-tree verdict ${against.firstTreeWithinUpperBound}, pinned ${expected.firstTreeWithinUpperBound}`);
  check(against.wholeFederationWithinUpperBound === expected.wholeFederationWithinUpperBound, `${label}: federation verdict ${against.wholeFederationWithinUpperBound}, pinned ${expected.wholeFederationWithinUpperBound}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `  ${failure}`).join("\n"));
  console.error(`[structure-first-emission] ${failures.length} failure(s).`);
  process.exit(1);
}
console.log(
  `[structure-first-emission] ${Object.keys(models).length} records: ` +
    Object.entries(models)
      .map(([id, model]) => `${id} ${Object.keys(model.documents).length} documents, first tree ${model.emissionOrder[0]}, whole federation ${model.wholeFederationWithinUpperBound ? "within" : "outside"} the 5-15 s target`)
      .join("; "),
);
