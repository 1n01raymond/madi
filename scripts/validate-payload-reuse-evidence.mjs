/**
 * Validates the ADR-0018 acceptance evidence under artifacts/cache/payload-reuse:
 * one record per model, each a fresh-process changed-discipline rebuild with
 * the content-addressed payload store disabled (oracle) and enabled.
 *
 * Digests below are HOST-LOCAL: the IFC adapter's split Scene IR differs by a
 * few bytes across hosts (see artifacts/spatial-demand), so a re-record on
 * another machine must be reviewed and re-pinned deliberately, never silently
 * retargeted to make this pass. Counts, decisions, and the gate verdicts are
 * pinned exactly.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/cache/payload-reuse");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[payload-reuse] ${message}`);
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const machinePathPattern = new RegExp(`[A-Za-z]:[${String.fromCharCode(92, 92)}/]`, "u");
const manifestSha256 = "77d7d587d6b32938a371325e281a4584e10c2ff3118a59f300a9da097eb2f478";
const payloadEntrySchema = "naru.compiled-payload-entry.1";
const semanticExclusions = [
  "adapter-report.json:documentArtifactCache",
  "build-report.json:compiledPayloadCache",
];
const packageResources = [
  "adapter-report.json",
  "build-report.json",
  "coarse.bin",
  "hierarchy.bin",
  "hierarchy.json",
  "incremental-dependencies.json",
  "properties.bin",
  "properties.json",
  "scene.bin",
  "scene.gltf",
  "spatial.bin",
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function close(a, b) {
  return Math.abs(a - b) <= 0.06;
}

const decisions = (hits, misses, published, outcomes) => ({ hits, misses, published, outcomes });

/**
 * Per-model pins. `oracles` are the clean-compile package digests this host
 * produces; `scenarios` lists the fresh-process scenarios in the order the
 * recorder runs them, with the exact payload-store decisions each must report.
 * `gate4Met` is the verdict ADR-0018's fourth gate reached on that model and is
 * pinned so a re-record that flips it is reviewed rather than absorbed.
 */
const pins = {
  "digital-hub": {
    datasetId: "ifc-bench-digital-hub",
    documents: 4,
    compactJson: false,
    samples: 5,
    changedDiscipline: "architecture",
    ownership: { prototypes: 3405, changedDocumentPrototypes: 726, payloadPrototypes: 3383 },
    oracles: {
      "clean-original": "ef31b9c6175ba83b338a2965c91ae5cb3cda0d500252face3804d97bb29d0ba5",
      "clean-changed": "c4b151e5f5d762e4f431c5f647aaec8a53a43d7bbf9737917e4874a1f022b3bb",
      "clean-relabelled": "ef31b9c6175ba83b338a2965c91ae5cb3cda0d500252face3804d97bb29d0ba5",
      "clean-deleted": "c9b15c51a6ad2096491403eb9acc31f7a770e152460a9bc3b56d556b6ede4812",
    },
    scenarios: [
      ["clean-original", null, null],
      ["store-cold-original", "clean-original", decisions(0, 3383, 3383, { hit: 0, absent: 3383, "corrupt-entry": 0, "restore-failed": 0 })],
      ["store-warm-original", "clean-original", decisions(3383, 0, 0, { hit: 3383, absent: 0, "corrupt-entry": 0, "restore-failed": 0 })],
      ["clean-changed", null, null],
      ["store-warm-changed", "clean-changed", decisions(2664, 719, 719, { hit: 2664, absent: 719, "corrupt-entry": 0, "restore-failed": 0 })],
      ["store-corrupt-entry-changed", "clean-changed", decisions(3382, 1, 0, { hit: 3382, absent: 0, "corrupt-entry": 1, "restore-failed": 0 })],
      ["clean-relabelled", null, null],
      ["store-warm-relabelled", "clean-relabelled", decisions(3383, 0, 0, { hit: 3383, absent: 0, "corrupt-entry": 0, "restore-failed": 0 })],
      ["clean-deleted", null, null],
      ["store-warm-deleted", "clean-deleted", decisions(2507, 0, 0, { hit: 2507, absent: 0, "corrupt-entry": 0, "restore-failed": 0 })],
    ],
    gate4Met: false,
  },
  sixty5: {
    datasetId: "ifc-bench-sixty5",
    documents: 7,
    compactJson: true,
    samples: 3,
    changedDiscipline: "structure",
    ownership: { prototypes: 42469, changedDocumentPrototypes: 2374, payloadPrototypes: 42435 },
    oracles: {
      "clean-original": "dd6fa9a1715e8451ca802554c9cf47b20e1e774d69169c6bf8ef16f6f10fb4c9",
      "clean-changed": "05707534c73ce126da401a79481d0fd6c892bc308a451d6aa2a4b1691bc2439e",
    },
    scenarios: [
      ["clean-original", null, null],
      ["store-cold-original", "clean-original", decisions(0, 42435, 42435, { hit: 0, absent: 42435, "corrupt-entry": 0, "restore-failed": 0 })],
      ["store-warm-original", "clean-original", decisions(42435, 0, 0, { hit: 42435, absent: 0, "corrupt-entry": 0, "restore-failed": 0 })],
      ["clean-changed", null, null],
      ["store-warm-changed", "clean-changed", decisions(40066, 2369, 2369, { hit: 40066, absent: 2369, "corrupt-entry": 0, "restore-failed": 0 })],
      ["store-corrupt-entry-changed", "clean-changed", decisions(42434, 1, 0, { hit: 42434, absent: 0, "corrupt-entry": 1, "restore-failed": 0 })],
    ],
    gate4Met: false,
  },
};

const externalManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "fixtures/external/manifest.json"), "utf8"),
);
const verdicts = [];

function sameDecisions(actual, expected, label) {
  assert(actual && typeof actual === "object", `${label} reports no payload-store decisions`);
  for (const key of ["hits", "misses", "published"]) {
    assert(actual[key] === expected[key], `${label} ${key} ${actual[key]} != ${expected[key]}`);
  }
  assert(
    JSON.stringify(actual.outcomes) === JSON.stringify(expected.outcomes),
    `${label} outcomes ${JSON.stringify(actual.outcomes)} != ${JSON.stringify(expected.outcomes)}`,
  );
  assert(actual.hits + actual.misses === actual.prototypes, `${label} hits + misses != prototypes`);
  assert(actual.store === payloadEntrySchema, `${label} store schema ${actual.store}`);
}

function checkStatistic(stat, values, label) {
  assert(Array.isArray(stat.values) && stat.values.length === values.length, `${label} values length`);
  assert(stat.values.every((value, index) => value === values[index]), `${label} values differ from runs`);
  assert(close(stat.median, median(values)), `${label} median ${stat.median} != ${median(values)}`);
  assert(stat.minimum === Math.min(...values) && stat.maximum === Math.max(...values), `${label} min/max`);
}

function checkResources(resources, label) {
  assert(Array.isArray(resources), `${label} resources missing`);
  assert(
    JSON.stringify(resources.map((entry) => entry.path)) === JSON.stringify(packageResources),
    `${label} resource paths ${resources.map((entry) => entry.path).join(",")}`,
  );
  for (const entry of resources) {
    assert(Number.isInteger(entry.bytes) && entry.bytes > 0, `${label} ${entry.path} bytes`);
    assert(sha256Pattern.test(entry.sha256), `${label} ${entry.path} sha256`);
  }
}

for (const [model, pin] of Object.entries(pins)) {
  const file = `${model}.json`;
  const text = await readFile(resolve(artifactDirectory, file), "utf8");
  assert(!machinePathPattern.test(text), `${file} carries a machine path`);
  assert(!text.includes("output/external-fixtures"), `${file} carries a fixture download path`);
  const record = JSON.parse(text);
  assert(record.schemaVersion === "naru.payload-reuse-evidence.1", `${file} schemaVersion ${record.schemaVersion}`);
  assert(record.mode === "fresh-process-changed-discipline-rebuild", `${file} mode ${record.mode}`);
  assert(record.model === model, `${file} model ${record.model}`);
  assert(record.host.platform === "win32", `${file} host.platform ${record.host.platform}`);
  assert(/^[0-9a-f]{40}$/u.test(record.commit.head), `${file} commit.head ${record.commit.head}`);

  const dataset = externalManifest.datasets.find((entry) => entry.id === pin.datasetId);
  assert(dataset, `${file} dataset ${pin.datasetId} is not in fixtures/external/manifest.json`);
  assert(record.fixture.datasetId === pin.datasetId, `${file} fixture.datasetId ${record.fixture.datasetId}`);
  assert(record.fixture.manifest.sha256 === manifestSha256, `${file} manifest sha256 ${record.fixture.manifest.sha256}`);
  assert(record.fixture.documents.length === pin.documents, `${file} documents ${record.fixture.documents.length}`);
  for (const document of record.fixture.documents) {
    const asset = dataset.assets.find((entry) => entry.discipline === document.discipline && entry.role === "source");
    assert(asset, `${file} ${document.discipline} has no manifest asset`);
    assert(asset.sha256 === document.sha256 && asset.byteLength === document.bytes, `${file} ${document.discipline} identity`);
    assert(document.uriHint.endsWith(`/${asset.path}`), `${file} ${document.discipline} uriHint ${document.uriHint}`);
  }

  assert(record.adapter.schemaVersion === "naru.ifc-adapter-identity.1", `${file} adapter schema`);
  assert(record.adapter.name === "IfcOpenShell" && sha256Pattern.test(record.adapter.fingerprint), `${file} adapter identity`);
  const options = record.compileOptions;
  assert(options.threads === 6 && options.compactJson === pin.compactJson, `${file} compileOptions threads/compactJson`);
  assert(options.spatialIndex === true && options.relocateHierarchyNodes === true, `${file} compileOptions layout flags`);
  assert(options.payloadEntrySchema === payloadEntrySchema, `${file} payloadEntrySchema ${options.payloadEntrySchema}`);

  const protocol = record.protocol;
  assert(protocol.peakProcessMemory.method === "os-sampled-win32-process-tree", `${file} peak memory method`);
  assert(protocol.peakProcessMemory.intervalMilliseconds === 500, `${file} sampler interval`);
  assert(
    JSON.stringify(protocol.reportComparison.semanticExclusions) === JSON.stringify(semanticExclusions),
    `${file} semantic exclusions ${JSON.stringify(protocol.reportComparison.semanticExclusions)}`,
  );
  assert(Array.isArray(protocol.uncontrolled) && protocol.uncontrolled.length >= 1, `${file} protocol.uncontrolled must name what was not controlled`);

  const changed = record.changedDocument;
  const original = record.fixture.documents.find((document) => document.discipline === changed.discipline);
  assert(changed.discipline === pin.changedDiscipline, `${file} changed discipline ${changed.discipline}`);
  assert(original && changed.originalSha256 === original.sha256, `${file} changed document original identity`);
  assert(sha256Pattern.test(changed.changedSha256) && changed.changedSha256 !== changed.originalSha256, `${file} changed sha256`);
  assert(changed.changedBytes === changed.originalBytes && changed.originalBytes === original.bytes, `${file} the edit must preserve the byte length`);
  assert(changed.edit.entity !== changed.edit.replacement, `${file} edit is a no-op`);
  assert(record.changeEffect.sceneBinDiffers === true && record.changeEffect.packageDigestDiffers === true, `${file} the edit must change scene.bin and the package digest`);
  assert(record.changeEffect.resourcesDiffering.includes("scene.bin"), `${file} changeEffect.resourcesDiffering`);

  const scenarios = record.scenarios;
  assert(
    JSON.stringify(scenarios.map((scenario) => scenario.name)) === JSON.stringify(pin.scenarios.map(([name]) => name)),
    `${file} scenario sequence ${scenarios.map((scenario) => scenario.name).join(",")}`,
  );
  const storeScenarios = [];
  for (const [index, [name, oracleName, expected]] of pin.scenarios.entries()) {
    const scenario = scenarios[index];
    const label = `${file} ${name}`;
    assert(scenario.met === true && scenario.failures.length === 0, `${label} did not meet its expectation: ${scenario.failures.join("; ")}`);
    assert(scenario.packageCacheStatus === "miss", `${label} must start from an absent package entry (${scenario.packageCacheStatus})`);
    assert(sha256Pattern.test(scenario.packageCacheKey), `${label} packageCacheKey`);
    assert(scenario.oracle === oracleName, `${label} oracle ${scenario.oracle}`);
    assert(scenario.payloadStore === (expected !== null), `${label} payloadStore ${scenario.payloadStore}`);
    checkResources(scenario.resources, label);
    assert(scenario.compileMilliseconds > 0 && scenario.processMilliseconds >= scenario.compileMilliseconds, `${label} timings`);
    assert(scenario.peakWorkingSetBytes > 0, `${label} peakWorkingSetBytes`);
    if (expected === null) {
      assert(scenario.payloadCache === null, `${label} clean compile reports a payload cache`);
      assert(scenario.warnings.length === 0, `${label} warnings ${JSON.stringify(scenario.warnings)}`);
      assert(record.oracles[name] && record.oracles[name].packageDigest === scenario.packageDigest, `${label} is not its own oracle`);
      assert(scenario.packageDigest === pin.oracles[name], `${label} package digest ${scenario.packageDigest} (host-local pin, see the comment above)`);
      continue;
    }
    storeScenarios.push(scenario);
    sameDecisions(scenario.payloadCache, expected, label);
    assert(scenario.packageDigest === record.oracles[oracleName].packageDigest, `${label} digest differs from its oracle`);
    const corrupt = name === "store-corrupt-entry-changed";
    assert(scenario.payloadCache.publishFailures === (corrupt ? 1 : 0), `${label} publishFailures ${scenario.payloadCache.publishFailures}`);
    assert(scenario.payloadCache.degraded.length === (corrupt ? 2 : 0), `${label} degraded ${scenario.payloadCache.degraded.length}`);
    if (corrupt) {
      assert(scenario.warnings.some((warning) => warning.includes("restore failed")), `${label} must warn about the corrupt restore`);
      assert(scenario.warnings.some((warning) => warning.includes("publish failed")), `${label} must refuse to republish over the corrupt entry`);
    } else {
      assert(scenario.warnings.length === 0, `${label} warnings ${JSON.stringify(scenario.warnings)}`);
    }
  }
  for (const [name, digest] of Object.entries(pin.oracles)) {
    const oracle = record.oracles[name];
    assert(oracle && oracle.packageDigest === digest, `${file} oracle ${name} digest`);
    checkResources(oracle.resources, `${file} oracle ${name}`);
    // build-report.json declares the package resources with their digests; each
    // must match the file the oracle actually wrote.
    assert(oracle.buildReportResources.length === 8, `${file} oracle ${name} declares ${oracle.buildReportResources.length} resources`);
    for (const declared of oracle.buildReportResources) {
      const written = oracle.resources.find((entry) => entry.path === declared.path);
      assert(written && written.bytes === declared.bytes && written.sha256 === declared.sha256, `${file} oracle ${name} build-report resource ${declared.path} differs from the written file`);
    }
  }
  assert(Object.keys(record.oracles).length === Object.keys(pin.oracles).length, `${file} oracle count`);

  const expectedComparisons = [];
  for (const scenario of storeScenarios) {
    expectedComparisons.push(scenario.name);
    if (scenario.name === "store-corrupt-entry-changed") {
      for (let sample = 1; sample <= pin.samples; sample += 1) expectedComparisons.push(`clean-changed#${sample}`, `store-warm-changed#${sample}`);
    }
  }
  assert(
    JSON.stringify(record.comparisons.map((comparison) => comparison.scenario)) === JSON.stringify(expectedComparisons),
    `${file} comparison sequence ${record.comparisons.map((comparison) => comparison.scenario).join(",")}`,
  );
  for (const comparison of record.comparisons) {
    assert(comparison.failures.length === 0, `${file} ${comparison.scenario} vs ${comparison.oracle}: ${comparison.failures.join("; ")}`);
    assert(comparison.oracle.startsWith("clean-"), `${file} ${comparison.scenario} compares against ${comparison.oracle}`);
  }

  const footprint = record.storeFootprint;
  const coldPublished = scenarios[1].payloadCache.published;
  const changedPublished = scenarios[4].payloadCache.published;
  assert(footprint.afterOriginal.entries === coldPublished, `${file} store entries after the original compile ${footprint.afterOriginal.entries} != ${coldPublished}`);
  assert(footprint.afterChanged.entries === coldPublished + changedPublished, `${file} store entries after the changed rebuild ${footprint.afterChanged.entries}`);
  assert(footprint.afterChanged.bytes > footprint.afterOriginal.bytes && footprint.afterOriginal.bytes > 0, `${file} store bytes`);
  assert(sha256Pattern.test(footprint.corruptedEntry.entry) && footprint.corruptedEntry.restoredAfterwards === true, `${file} corrupted entry bookkeeping`);

  const extraction = record.extraction;
  assert(extraction.samples === pin.samples && extraction.runs.length === pin.samples, `${file} extraction samples ${extraction.samples}`);
  checkStatistic(extraction.adapterMilliseconds, extraction.runs.map((run) => run.adapterMilliseconds), `${file} extraction adapterMilliseconds`);
  checkStatistic(extraction.peakWorkingSetBytes, extraction.runs.map((run) => run.peakWorkingSetBytes), `${file} extraction peakWorkingSetBytes`);
  for (const run of extraction.runs) {
    assert(run.documentArtifactCache.misses.length === 1 && run.documentArtifactCache.misses[0] === pin.changedDiscipline, `${file} extraction run ${run.index} must extract exactly the changed document`);
  }
  const extractionMedian = extraction.adapterMilliseconds.median;
  const changedOracle = record.oracles["clean-changed"].packageDigest;
  const warmDecisions = pin.scenarios.find(([name]) => name === "store-warm-changed")[2];
  for (const [kind, warm] of [["cleanRebuild", false], ["warmRebuild", true]]) {
    const series = record[kind];
    const label = `${file} ${kind}`;
    assert(series.samples === pin.samples && series.runs.length === pin.samples, `${label} samples ${series.samples}`);
    const compile = series.runs.map((run) => run.compileMilliseconds);
    checkStatistic(series.compileMilliseconds, compile, `${label} compileMilliseconds`);
    checkStatistic(series.processMilliseconds, series.runs.map((run) => run.processMilliseconds), `${label} processMilliseconds`);
    checkStatistic(series.peakProcessTreeWorkingSetBytes, series.runs.map((run) => run.peakWorkingSetBytes), `${label} peakProcessTreeWorkingSetBytes`);
    const packaging = compile.map((value) => Number((value - extractionMedian).toFixed(1)));
    checkStatistic(series.packagingMilliseconds, packaging, `${label} packagingMilliseconds`);
    for (const run of series.runs) {
      assert(run.packageDigest === changedOracle, `${label} run ${run.index} digest ${run.packageDigest} != clean-changed oracle`);
      assert(run.warnings.length === 0, `${label} run ${run.index} warnings ${JSON.stringify(run.warnings)}`);
      assert(run.memorySamples > 0 && run.maxProcessCount >= 2, `${label} run ${run.index} sampler saw no process tree`);
      assert(run.documentArtifactCache.misses.length === 1 && run.documentArtifactCache.misses[0] === pin.changedDiscipline, `${label} run ${run.index} must re-extract exactly the changed document`);
      if (warm) sameDecisions(run.payloadCache, warmDecisions, `${label} run ${run.index}`);
      else assert(run.payloadCache === null, `${label} run ${run.index} reports a payload cache`);
    }
  }

  const gates = record.gates;
  const equivalence = gates.cleanPackageResourceEquivalence;
  assert(equivalence.comparisons === record.comparisons.length && equivalence.identical === true, `${file} gate 1 ${JSON.stringify(equivalence)}`);
  assert(JSON.stringify(equivalence.resources) === JSON.stringify(packageResources), `${file} gate 1 resources`);
  assert(JSON.stringify(gates.semanticReportComparison.exclusions) === JSON.stringify(semanticExclusions) && gates.semanticReportComparison.met === true, `${file} gate 2`);
  const ownership = gates.ownershipDecisions;
  assert(ownership.met === true, `${file} ownership decisions not met`);
  sameDecisions({ ...ownership.changedRebuild, prototypes: warmDecisions.hits + warmDecisions.misses, store: payloadEntrySchema }, warmDecisions, `${file} ownership.changedRebuild`);
  assert(ownership.ownership.prototypes === pin.ownership.prototypes, `${file} ownership.prototypes ${ownership.ownership.prototypes}`);
  assert(ownership.ownership.changedDocumentPrototypes === pin.ownership.changedDocumentPrototypes, `${file} changedDocumentPrototypes ${ownership.ownership.changedDocumentPrototypes}`);
  assert(ownership.ownership.changedDocumentPrototypesSharedWithOtherDocuments === 0, `${file} the changed document shares prototypes with others`);
  assert(ownership.ownership.changedDocumentPrototypeIdsRetainedFromOriginal === 0, `${file} changed-document prototype ids must all be renamed (see changedDocumentReuse)`);
  assert(typeof ownership.ownership.changedDocumentReuse === "string" && ownership.ownership.changedDocumentReuse.startsWith("none by construction"), `${file} changedDocumentReuse must state why the changed document cannot reuse`);
  assert(scenarios[1].payloadCache.prototypes === pin.ownership.payloadPrototypes, `${file} payload-bearing prototypes ${scenarios[1].payloadCache.prototypes}`);
  const gate4 = gates.measuredSavingExceedsCost;
  assert(gate4.extractionMedianMs === extractionMedian, `${file} gate 4 extraction median`);
  assert(gate4.cleanPackagingMedianMs === record.cleanRebuild.packagingMilliseconds.median, `${file} gate 4 clean packaging median`);
  assert(gate4.warmPackagingMedianMs === record.warmRebuild.packagingMilliseconds.median, `${file} gate 4 warm packaging median`);
  assert(close(gate4.savingMs, gate4.cleanPackagingMedianMs - gate4.warmPackagingMedianMs), `${file} gate 4 savingMs`);
  assert(close(gate4.savingRatio, gate4.cleanPackagingMedianMs / gate4.warmPackagingMedianMs), `${file} gate 4 savingRatio`);
  assert(gate4.cleanPeakWorkingSetMedianBytes === record.cleanRebuild.peakProcessTreeWorkingSetBytes.median, `${file} gate 4 clean peak`);
  assert(gate4.warmPeakWorkingSetMedianBytes === record.warmRebuild.peakProcessTreeWorkingSetBytes.median, `${file} gate 4 warm peak`);
  assert(gate4.packagingFaster === (gate4.warmPackagingMedianMs < gate4.cleanPackagingMedianMs), `${file} gate 4 packagingFaster`);
  assert(gate4.peakMemoryNoHigher === (gate4.warmPeakWorkingSetMedianBytes <= gate4.cleanPeakWorkingSetMedianBytes), `${file} gate 4 peakMemoryNoHigher`);
  assert(gate4.met === (gate4.packagingFaster && gate4.peakMemoryNoHigher), `${file} gate 4 met`);
  assert(gate4.met === pin.gate4Met, `${file} gate 4 verdict ${gate4.met} != pinned ${pin.gate4Met}; a re-record that flips it is reviewed, not absorbed`);
  assert(gates.allMet === (equivalence.identical && gates.semanticReportComparison.met && ownership.met && gate4.met), `${file} gates.allMet`);
  assert(record.discardedSamples.length === 0, `${file} discarded samples ${record.discardedSamples.length}`);

  verdicts.push(
    `${model}: ${scenarios.length} scenarios, ${record.comparisons.length} byte-identical comparisons, ` +
      `changed rebuild ${warmDecisions.hits}/${warmDecisions.hits + warmDecisions.misses} restored, ` +
      `packaging clean ${(gate4.cleanPackagingMedianMs / 1000).toFixed(1)} s vs warm ${(gate4.warmPackagingMedianMs / 1000).toFixed(1)} s, ` +
      `gate 4 ${gate4.met ? "met" : "NOT met"}`,
  );
}

console.log(`[payload-reuse] ${verdicts.join("; ")}`);
