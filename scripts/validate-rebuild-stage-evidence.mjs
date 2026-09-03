/**
 * Validates the ADR-0019 gate 0 evidence under artifacts/cache/rebuild-stages:
 * one record per model, each a fresh-process changed-discipline rebuild whose
 * adapter and compiler stages were timed through the diagnostic ledgers
 * (`--stage-timing`, `stageTiming: true`) that never touch a package byte.
 *
 * Package digests below are HOST-LOCAL: the IFC adapter's split Scene IR differs
 * by a few bytes across hosts (see artifacts/spatial-demand), so a re-record on
 * another machine must be reviewed and re-pinned deliberately, never silently
 * retargeted to make this pass. Sample counts, the stage-name sets, the ledger
 * closure identities, and the attribution verdicts are pinned exactly.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/cache/rebuild-stages");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[rebuild-stages] ${message}`);
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const machinePathPattern = new RegExp(`[A-Za-z]:[${String.fromCharCode(92, 92)}/]`, "u");
const manifestSha256 = "77d7d587d6b32938a371325e281a4584e10c2ff3118a59f300a9da097eb2f478";
const schemaVersion = "naru.rebuild-stage-evidence.1";
const mode = "fresh-process-changed-discipline-stage-decomposition";
const adapterLedgerSchema = "naru.ifc-adapter-stage-timing.1";
const compilerLedgerSchema = "naru.ifc-federation-stage-timing.1";
const compilerStageNames = [
  "inspectSources", "toolchainIdentity", "cacheLookup", "adapter", "readSceneIr", "hydrate", "compile",
  "validateCompiled", "dependencyIndex", "writePackage", "writeDependencyIndex", "retainSceneIr", "cachePublish",
];
const compileStageNames = ["validateScene", "encodeGeometry", "measureDocument", "other"];
const adapterProcessKeys = ["spawnToModuleStartMilliseconds", "importMilliseconds", "importsToMainMilliseconds", "mainMilliseconds", "finishToCloseMilliseconds"];
const federationKeys = ["mergeMilliseconds", "propertyIndexMilliseconds"];
const writeKeys = ["geometryMilliseconds", "propertiesMilliseconds", "structureMilliseconds", "digestMilliseconds", "reportMilliseconds"];
const attributionRows = [
  "compileWall", "adapterWait", "inProcessCompilerWork", "structureStreamScan", "compileSceneToGltf",
  "buildCompiledPayload", "documentStreaming", "writeCompiledPackage", "validateScene",
];
const sum = (values) => values.reduce((total, value) => total + value, 0);
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function distributionOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)],
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
  };
}

/**
 * Per-model pins. `packageDigest` is the changed-discipline package this host
 * compiles (host-local, see the file comment); `attributionReproduced` and
 * `rowsOutsideSpread` are the verdict the record reached against ADR-0019's
 * exploratory Context table and must be re-pinned together with the ADR text.
 */
const pins = {
  "digital-hub": {
    datasetId: "ifc-bench-digital-hub",
    documents: ["architecture", "heating", "plumbing", "ventilation"],
    changedDiscipline: "architecture",
    compactJson: false,
    samples: 5,
    packageDigest: "c4b151e5f5d762e4f431c5f647aaec8a53a43d7bbf9737917e4874a1f022b3bb",
    attributionReproduced: false,
    rowsOutsideSpread: [...attributionRows],
  },
  sixty5: {
    datasetId: "ifc-bench-sixty5",
    documents: ["architecture", "electrical", "facade", "kitchen", "plumbing", "structure", "ventilation"],
    changedDiscipline: "structure",
    compactJson: true,
    samples: 5,
    packageDigest: "05707534c73ce126da401a79481d0fd6c892bc308a451d6aa2a4b1691bc2439e",
    attributionReproduced: false,
    rowsOutsideSpread: [...attributionRows],
  },
};

const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "fixtures/external/manifest.json"), "utf8"));
const verdicts = [];

for (const [modelId, pin] of Object.entries(pins)) {
  const file = `artifacts/cache/rebuild-stages/${modelId}.json`;
  const text = await readFile(resolve(artifactDirectory, `${modelId}.json`), "utf8");
  assert(!machinePathPattern.test(text), `${file} carries a machine path`);
  const record = JSON.parse(text);
  assert(record.schemaVersion === schemaVersion, `${file} schemaVersion ${record.schemaVersion}`);
  assert(record.mode === mode, `${file} mode ${record.mode}`);
  assert(record.model === modelId, `${file} model ${record.model}`);
  assert(/^[0-9a-f]{40}$/u.test(record.commit?.head ?? ""), `${file} commit.head ${record.commit?.head}`);
  for (const key of ["platform", "architecture", "node", "cpuCount", "cpuModel", "totalMemoryBytes"]) assert(record.host?.[key] !== undefined, `${file} host.${key}`);

  // Fixture identity.
  assert(record.fixture.datasetId === pin.datasetId, `${file} datasetId ${record.fixture.datasetId}`);
  assert(record.fixture.manifest.sha256 === manifestSha256, `${file} manifest sha256 ${record.fixture.manifest.sha256}`);
  const dataset = manifest.datasets.find(({ id }) => id === pin.datasetId);
  assert(dataset, `${file} dataset ${pin.datasetId} is not in the manifest`);
  assert(sameSet(record.fixture.documents.map((d) => d.discipline), pin.documents), `${file} federation documents`);
  for (const document of record.fixture.documents) {
    assert(dataset.assets.some((asset) => asset.sha256 === document.sha256), `${file} ${document.discipline} sha256 is not a manifest asset`);
  }
  assert(record.changedDocument.discipline === pin.changedDiscipline, `${file} changed discipline ${record.changedDocument.discipline}`);
  assert(sha256Pattern.test(record.changedDocument.changedSha256) && record.changedDocument.changedSha256 !== record.changedDocument.originalSha256, `${file} changed document identity`);
  const unchanged = pin.documents.filter((d) => d !== pin.changedDiscipline);
  assert(record.compileOptions.compactJson === pin.compactJson && record.compileOptions.spatialIndex === true && record.compileOptions.relocateHierarchyNodes === true, `${file} compileOptions`);

  // Warm-up populated every artifact cold.
  assert(sameSet(record.warmUp.documentArtifactCache.misses, pin.documents) && record.warmUp.documentArtifactCache.hits.length === 0, `${file} warm-up must extract every document`);
  assert(record.warmUp.artifacts === pin.documents.length, `${file} warm-up artifacts ${record.warmUp.artifacts}`);

  // Samples: exact count, zero discarded, one package digest, valid cache decisions.
  assert(record.samples.length === pin.samples, `${file} expected ${pin.samples} samples, found ${record.samples.length}`);
  assert(record.discardedSamples.length === 0, `${file} ${record.discardedSamples.length} discarded samples`);
  assert(record.packageDigest === pin.packageDigest, `${file} packageDigest ${record.packageDigest} (host-local pin; re-pin deliberately)`);
  assert(record.closure.length === pin.samples, `${file} closure entries`);
  for (const [i, sample] of record.samples.entries()) {
    const at = `${file} sample ${sample.index}`;
    assert(sample.index === i + 1 && sample.exitCode === 0, `${at} index/exit`);
    assert(sample.packageDigest === pin.packageDigest, `${at} packageDigest ${sample.packageDigest}`);
    assert(sample.cache.status === "miss", `${at} package cache ${sample.cache.status}`);
    assert(sameSet(sample.documentArtifactCache.hits, unchanged) && sameSet(sample.documentArtifactCache.misses, [pin.changedDiscipline]), `${at} document artifact decisions`);
    assert(sample.warnings.length === 0, `${at} warnings`);
    assert(sample.compileMilliseconds > 0 && sample.processMilliseconds >= sample.compileMilliseconds, `${at} process/compile wall`);
    assert(sample.peakWorkingSetBytes > 0, `${at} peak working set`);
    const { stages } = sample;
    assert(stages.schemaVersion === compilerLedgerSchema, `${at} compiler ledger schema ${stages.schemaVersion}`);
    assert(sameSet(Object.keys(stages.stages), compilerStageNames), `${at} compiler stage names`);
    assert(sameSet(Object.keys(stages.compileStages), compileStageNames), `${at} compile sub-stage names`);
    for (const name of compilerStageNames) assert(typeof stages.stages[name] === "number" && stages.stages[name] >= 0, `${at} stage ${name}`);
    assert(Math.abs(sum(compilerStageNames.map((n) => stages.stages[n])) + stages.unattributedMilliseconds - stages.totalMilliseconds) < 0.01, `${at} compiler stages do not close to total`);
    assert(stages.unattributedMilliseconds >= 0, `${at} negative unattributed time`);
    assert(Math.abs(sum(compileStageNames.map((n) => stages.compileStages[n])) - stages.stages.compile) < 0.01, `${at} compile sub-stages do not close`);
    assert(stages.structureReadMilliseconds <= stages.stages.readSceneIr + 0.01, `${at} structure read exceeds readSceneIr`);
    assert(stages.stages.cacheLookup > 0 && stages.stages.cachePublish > 0, `${at} package cache stages must be exercised`);
    assert(stages.totalMilliseconds <= sample.compileMilliseconds + 0.1, `${at} ledger total exceeds compile wall`);
    const { adapter } = stages;
    assert(sameSet(Object.keys(adapter).filter((k) => k !== "ledger"), adapterProcessKeys), `${at} adapter process keys`);
    assert(sum(adapterProcessKeys.map((k) => adapter[k])) <= stages.stages.adapter + 5, `${at} adapter process parts exceed the adapter stage`);
    const { ledger } = adapter;
    assert(ledger.schemaVersion === adapterLedgerSchema, `${at} adapter ledger schema ${ledger.schemaVersion}`);
    assert(sameSet(Object.keys(ledger.federation), federationKeys) && sameSet(Object.keys(ledger.write), writeKeys), `${at} adapter ledger key sets`);
    assert(sameSet(ledger.documents.map((d) => d.discipline), pin.documents), `${at} adapter ledger documents`);
    for (const document of ledger.documents) {
      const expectRestored = document.discipline !== pin.changedDiscipline;
      assert(document.outcome === (expectRestored ? "restored" : "extracted"), `${at} ${document.discipline} outcome ${document.outcome}`);
      if (expectRestored) {
        assert(document.artifactState === "verified" && document.artifactVerifyMilliseconds >= 0 && document.artifactBytes > 0 && document.restoreMilliseconds >= 0, `${at} ${document.discipline} restore ledger`);
      } else {
        assert(document.artifactState === "absent" && document.extractMilliseconds > 0 && document.publishMilliseconds >= 0, `${at} ${document.discipline} extract ledger`);
      }
    }
    const accounted = sum(ledger.documents.map((d) => sum(Object.entries(d).filter(([k, v]) => k.endsWith("Milliseconds") && typeof v === "number").map(([, v]) => v)))) + sum(Object.values(ledger.federation)) + sum(Object.values(ledger.write));
    assert(accounted <= adapter.mainMilliseconds + 5, `${at} adapter ledger exceeds main wall`);
    assert(record.closure[i].met === true, `${at} closure not met`);
  }

  // Distributions are recomputable from the samples.
  const whole = record.distributions.whole;
  const check = (name, distribution, values) => {
    const expected = distributionOf(values.map((v) => Number(v.toFixed(1))));
    for (const key of ["median", "p95", "minimum", "maximum"]) assert(Math.abs(distribution[key] - expected[key]) < 0.06, `${file} ${name}.${key} ${distribution[key]} != ${expected[key]}`);
  };
  check("whole.totalMilliseconds", whole.totalMilliseconds, record.samples.map((s) => s.stages.totalMilliseconds));
  check("whole.processMilliseconds", whole.processMilliseconds, record.samples.map((s) => s.processMilliseconds));
  check("whole.peakWorkingSetBytes", whole.peakWorkingSetBytes, record.samples.map((s) => s.peakWorkingSetBytes));
  for (const name of compilerStageNames) check(`compilerStages.${name}`, record.distributions.compilerStages[name], record.samples.map((s) => s.stages.stages[name]));
  for (const name of compileStageNames) check(`compileStages.${name}`, record.distributions.compileStages[name], record.samples.map((s) => s.stages.compileStages[name]));
  check("unchangedArtifactVerifyMilliseconds", record.distributions.unchangedArtifactVerifyMilliseconds, record.samples.map((s) => sum(s.stages.adapter.ledger.documents.filter((d) => d.discipline !== pin.changedDiscipline).map((d) => d.artifactVerifyMilliseconds))));

  // Attribution verdict against ADR-0019's exploratory table.
  const attribution = record.exploratoryAttribution;
  assert(sameSet(Object.keys(attribution.rows), attributionRows), `${file} attribution rows`);
  for (const [name, row] of Object.entries(attribution.rows)) {
    assert(row.exploratoryMilliseconds > 0 && row.minimum <= row.median && row.median <= row.maximum, `${file} attribution ${name} shape`);
    assert(row.withinSpread === (row.minimum <= row.exploratoryMilliseconds && row.exploratoryMilliseconds <= row.maximum), `${file} attribution ${name} withinSpread`);
  }
  assert(attribution.reproduced === pin.attributionReproduced, `${file} attribution reproduced ${attribution.reproduced}, pinned ${pin.attributionReproduced}`);
  assert(sameSet(attribution.rowsOutsideSpread, pin.rowsOutsideSpread), `${file} rows outside spread ${JSON.stringify(attribution.rowsOutsideSpread)}`);
  assert(typeof attribution.notMeasured.gcAndMicrotasks.exploratoryMilliseconds === "number", `${file} gcAndMicrotasks row`);

  verdicts.push(`${modelId}: ${record.samples.length} samples, compile ${(whole.totalMilliseconds.median / 1000).toFixed(1)} s (adapter ${(record.distributions.compilerStages.adapter.median / 1000).toFixed(1)} s), attribution ${attribution.reproduced ? "reproduced" : "not reproduced"}`);
}

console.log(`[rebuild-stages] ${verdicts.join("; ")}`);
