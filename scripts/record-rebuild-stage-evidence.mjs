/**
 * Records the ADR-0019 gate 0 evidence for one IFC federation: a
 * changed-discipline rebuild (one document edited, every other document's
 * artifact warm) decomposed into adapter and compiler stages, with the
 * fresh-process, predeclared-sample protocol of artifacts/cache/sixty5.
 *
 * Timing is diagnostic: the adapter writes its stage ledger to a separate file
 * only when asked (`--stage-timing`), and the compiler exposes `stages` on its
 * result only when `stageTiming: true`. No package byte, report, or cache key
 * carries a timing, so an instrumented sample produces exactly the package a
 * plain compile does (packages/compiler/test/ifc-federation.test.ts pins it).
 *
 *   node scripts/record-rebuild-stage-evidence.mjs --model digital-hub
 *   node scripts/record-rebuild-stage-evidence.mjs --model sixty5
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  processTreeSampleMethod,
  startProcessTreeSampler,
} from "./lib/process-tree-sampler.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[rebuild-stages] ${message}`);
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value.`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function portable(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

const round = (value) => Number(value.toFixed(1));

/**
 * The same one-entity edit per model as artifacts/cache/payload-reuse, so this
 * record decomposes exactly the rebuild that record timed as a whole.
 */
const models = {
  "digital-hub": {
    datasetId: "ifc-bench-digital-hub",
    uriPrefix: "projects/digital_hub",
    documents: [
      ["architecture", "arc.ifc"],
      ["heating", "heating.ifc"],
      ["plumbing", "plumbing.ifc"],
      ["ventilation", "ventilation.ifc"],
    ],
    compactJson: false,
    edit: {
      discipline: "architecture",
      entity: "#823= IFCEXTRUDEDAREASOLID(#817,#822,#20,7.77);",
      replacement: "#823= IFCEXTRUDEDAREASOLID(#817,#822,#20,9.77);",
      description: "Extrusion depth 7.77 -> 9.77 of #823, referenced only by #824 (IfcShapeRepresentation 'Body').",
    },
    // ADR-0019 Context, exploratory single-run cpu-prof probe, milliseconds.
    exploratory: {
      compileWall: 10140, adapterWait: 6988, inProcessCompilerWork: 3195,
      structureStreamScan: 1240, gcAndMicrotasks: 744, compileSceneToGltf: 780,
      buildCompiledPayload: 236, documentStreaming: 298, writeCompiledPackage: 139,
      validateScene: 92,
    },
  },
  sixty5: {
    datasetId: "ifc-bench-sixty5",
    uriPrefix: "projects/sixty5",
    documents: [
      ["architecture", "arc.ifc"],
      ["electrical", "electrical.ifc"],
      ["facade", "facade.ifc"],
      ["kitchen", "kitchen.ifc"],
      ["plumbing", "plumbing.ifc"],
      ["structure", "str.ifc"],
      ["ventilation", "ventilation.ifc"],
    ],
    compactJson: true,
    edit: {
      discipline: "structure",
      entity: "#890= IFCEXTRUDEDAREASOLID(#886,#889,#19,250.);",
      replacement: "#890= IFCEXTRUDEDAREASOLID(#886,#889,#19,350.);",
      description: "Extrusion depth 250 -> 350 of #890, referenced only by #891 (IfcShapeRepresentation 'Body').",
    },
    exploratory: {
      compileWall: 99851, adapterWait: 62787, inProcessCompilerWork: 37109,
      structureStreamScan: 15100, gcAndMicrotasks: 11347, compileSceneToGltf: 6849,
      buildCompiledPayload: 1229, documentStreaming: 2950, writeCompiledPackage: 1392,
      validateScene: 1018,
    },
  },
};

const modelId = argumentValue("--model", "digital-hub");
const model = models[modelId];
assert(model, `--model must be one of ${Object.keys(models).join(", ")}.`);
const sampleCount = Number(argumentValue("--samples", "5"));
assert(Number.isSafeInteger(sampleCount) && sampleCount >= 1, "--samples must be a positive integer.");
const maximumAttempts = 3;
const threads = Number(argumentValue("--threads", "6"));
assert(Number.isSafeInteger(threads) && threads >= 1, "--threads must be a positive integer.");
const artifactDirectory = resolve(repositoryRoot, argumentValue("--output", "artifacts/cache/rebuild-stages"));
const workingRoot = resolve(repositoryRoot, "output/rebuild-stages", modelId);
const cacheDirectory = join(workingRoot, "cache");
const documentArtifactDirectory = join(cacheDirectory, "ifc-documents");
const changedDirectory = join(workingRoot, "changed");

const manifestPath = resolve(repositoryRoot, "fixtures/external/manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const dataset = manifest.datasets.find(({ id }) => id === model.datasetId);
assert(dataset, `Unknown external fixture dataset ${model.datasetId}.`);

const documents = model.documents.map(([discipline, fileName]) => ({
  discipline,
  fileName,
  sourcePath: `output/external-fixtures/${model.datasetId}/${fileName}`,
  uriHint: `${model.uriPrefix}/${fileName}`,
}));
const sourceIdentities = [];
for (const document of documents) {
  const bytes = await readFile(resolve(repositoryRoot, document.sourcePath));
  const digest = sha256(bytes);
  assert(
    dataset.assets.some(({ sha256: assetDigest }) => assetDigest === digest),
    `${document.fileName} is not a pinned asset of ${model.datasetId}.`,
  );
  sourceIdentities.push({ discipline: document.discipline, uriHint: document.uriHint, bytes: bytes.byteLength, sha256: digest });
}

const changedDocument = documents.find(({ discipline }) => discipline === model.edit.discipline);
assert(changedDocument, "The edited discipline is not part of the federation.");
const unchangedDisciplines = documents.map((d) => d.discipline).filter((d) => d !== changedDocument.discipline);
await mkdir(changedDirectory, { recursive: true });
const originalText = (await readFile(resolve(repositoryRoot, changedDocument.sourcePath))).toString("latin1");
assert(originalText.split(model.edit.entity).length === 2, `${changedDocument.fileName} must contain the edited entity exactly once.`);
const changedBytes = Buffer.from(originalText.replace(model.edit.entity, model.edit.replacement), "latin1");
const changedPath = join(changedDirectory, changedDocument.fileName);
await writeFile(changedPath, changedBytes);
const original = sourceIdentities.find((s) => s.discipline === changedDocument.discipline);
const changedIdentity = {
  discipline: changedDocument.discipline,
  fileName: changedDocument.fileName,
  uriHint: changedDocument.uriHint,
  edit: model.edit,
  originalBytes: original.bytes,
  originalSha256: original.sha256,
  changedBytes: changedBytes.byteLength,
  changedSha256: sha256(changedBytes),
};

const ifcPython = process.env.NARU_IFC_PYTHON ?? process.env.NARU_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const adapterScript = resolve(repositoryRoot, "native/adapter-ifc/tools/extract_federation_scene_ir.py");
const adapterProbe = spawnSync(ifcPython, [adapterScript, "--identity"], { encoding: "utf8", windowsHide: true });
assert(adapterProbe.status === 0, `IFC adapter --identity failed: ${adapterProbe.stderr}`);
const adapterIdentity = JSON.parse(adapterProbe.stdout);

function gitOutput(...args) {
  const probe = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  assert(probe.status === 0, `git ${args.join(" ")} failed: ${probe.stderr}`);
  return probe.stdout.trim();
}

async function writeConfig(name, documentSet) {
  const configPath = join(workingRoot, `config-${name}.json`);
  const selected = documents.map((document) => ({
    discipline: document.discipline,
    sourcePath: documentSet === "changed" && document.discipline === changedDocument.discipline ? portable(changedPath) : document.sourcePath,
    uriHint: document.uriHint,
  }));
  const config = {
    cacheDirectory: portable(cacheDirectory),
    threads,
    compactJson: model.compactJson,
    spatialIndex: true,
    relocateHierarchyNodes: true,
    pythonExecutable: ifcPython,
    documents: selected,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

async function listNames(directory) {
  try {
    return (await readdir(directory)).sort((a, b) => a.localeCompare(b, "en"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const sampler = startProcessTreeSampler({ intervalMilliseconds: 500 });

/** One fresh node process; returns the sample runner's result plus process wall and peak memory. */
async function runSample(phase, index, configPath, extraArguments) {
  const label = `${phase}#${index}`;
  const outputDirectory = join(workingRoot, "sample");
  const resultPath = join(workingRoot, "sample-result.json");
  await rm(outputDirectory, { recursive: true, force: true });
  await rm(resultPath, { force: true });
  await mkdir(outputDirectory, { recursive: true });
  console.log(`[rebuild-stages] ${label} ...`);
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [resolve(repositoryRoot, "scripts/lib/ifc-cache-sample.mjs"), "--config", configPath, "--result", resultPath, "--output", portable(outputDirectory), "--phase", phase, ...extraArguments],
    { cwd: repositoryRoot, stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
  );
  const observation = sampler.observe(child.pid);
  const exitCode = await new Promise((settle) => child.on("exit", (code) => settle(code ?? -1)));
  const processMilliseconds = round(performance.now() - startedAt);
  const memory = observation.close();
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  await rm(outputDirectory, { recursive: true, force: true });
  console.log(`[rebuild-stages] ${label}: exit ${exitCode}, ${(processMilliseconds / 1000).toFixed(1)} s, peak tree ${(memory.peakWorkingSetBytes / 1e9).toFixed(2)} GB`);
  return { phase, index, exitCode, processMilliseconds, memory, ...result };
}

/** Reset the cache to "every unchanged artifact warm, nothing else": no package entry, no changed-document artifact. */
async function resetCacheState(originalArtifacts) {
  for (const name of await listNames(cacheDirectory)) {
    if (name !== "ifc-documents") await rm(join(cacheDirectory, name), { recursive: true, force: true });
  }
  for (const name of await listNames(documentArtifactDirectory)) {
    if (!originalArtifacts.includes(name)) await rm(join(documentArtifactDirectory, name), { force: true });
  }
}

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Why a sample is not the rebuild the protocol requires; empty when it is. */
function sampleFailures(sample, packageDigest) {
  const failures = [];
  if (sample.exitCode !== 0) failures.push(`exit ${sample.exitCode}: ${sample.failure?.message ?? "unknown"}`);
  if (failures.length > 0) return failures;
  if (sample.cache?.status !== "miss") failures.push(`package cache status ${sample.cache?.status}, expected miss`);
  const artifacts = sample.documentArtifactCache ?? {};
  if (!sameSet(artifacts.misses ?? [], [changedDocument.discipline])) failures.push(`document artifact misses ${JSON.stringify(artifacts.misses)}, expected [${changedDocument.discipline}]`);
  if (!sameSet(artifacts.hits ?? [], unchangedDisciplines)) failures.push(`document artifact hits ${JSON.stringify(artifacts.hits)}, expected the unchanged documents`);
  if (sample.warnings.length > 0) failures.push(`warnings: ${sample.warnings.join(" | ")}`);
  if (!sample.stages) failures.push("the result carries no stage ledger");
  if (packageDigest && sample.report.output.packageDigest !== packageDigest) failures.push(`packageDigest ${sample.report.output.packageDigest} != ${packageDigest}`);
  return failures;
}

// ---------------------------------------------------------------------------
// Warm-up: extract the ORIGINAL federation once (adapter only, fresh process)
// so every unchanged document's artifact is warm before the first sample.
// ---------------------------------------------------------------------------
await rm(cacheDirectory, { recursive: true, force: true });
await mkdir(workingRoot, { recursive: true });
const originalConfig = await writeConfig("original", "original");
const changedConfig = await writeConfig("changed", "changed");
const warmUpSample = await runSample("warm-up-original-extraction", 1, originalConfig, ["--adapter-only"]);
assert(warmUpSample.exitCode === 0, `warm-up failed: ${warmUpSample.failure?.message ?? "unknown"}`);
assert(sameSet(warmUpSample.documentArtifactCache.misses, documents.map((d) => d.discipline)), "the warm-up must extract every document cold");
const originalArtifacts = await listNames(documentArtifactDirectory);
assert(originalArtifacts.length === documents.length, `expected ${documents.length} document artifacts after warm-up, found ${originalArtifacts.length}`);
const warmUp = {
  adapterMilliseconds: warmUpSample.adapterMilliseconds,
  processMilliseconds: warmUpSample.processMilliseconds,
  peakWorkingSetBytes: warmUpSample.memory.peakWorkingSetBytes,
  documentArtifactCache: warmUpSample.documentArtifactCache,
  artifacts: originalArtifacts.length,
};

// ---------------------------------------------------------------------------
// Samples: fresh-process changed-discipline rebuilds with the stage ledger.
// ---------------------------------------------------------------------------
const samples = [];
const discarded = [];
let packageDigest;
for (let index = 1; index <= sampleCount; index += 1) {
  let accepted;
  for (let attempt = 1; attempt <= maximumAttempts && !accepted; attempt += 1) {
    await resetCacheState(originalArtifacts);
    const sample = await runSample("changed-rebuild", index, changedConfig, ["--stage-timing"]);
    const failures = sampleFailures(sample, packageDigest);
    if (failures.length === 0) {
      accepted = sample;
      packageDigest ??= sample.report.output.packageDigest;
    } else {
      console.log(`[rebuild-stages] changed-rebuild#${index} attempt ${attempt} discarded: ${failures.join("; ")}`);
      discarded.push({ index, attempt, failures, exitCode: sample.exitCode, processMilliseconds: sample.processMilliseconds });
    }
  }
  assert(accepted, `sample ${index} failed ${maximumAttempts} times`);
  samples.push(accepted);
}
sampler.stop();

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    values,
    median: sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)],
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
  };
}
const over = (pick) => distribution(samples.map((s) => round(pick(s))));
const overKeys = (keys, pick) => Object.fromEntries(keys.map((key) => [key, over((s) => pick(s)[key])]));

const compilerStageNames = Object.keys(samples[0].stages.stages);
const compileStageNames = Object.keys(samples[0].stages.compileStages);
const adapterProcessKeys = ["spawnToModuleStartMilliseconds", "importMilliseconds", "importsToMainMilliseconds", "mainMilliseconds", "finishToCloseMilliseconds"];
const federationKeys = Object.keys(samples[0].stages.adapter.ledger.federation);
const writeKeys = Object.keys(samples[0].stages.adapter.ledger.write);
const ledgerDocument = (sample, discipline) => sample.stages.adapter.ledger.documents.find((d) => d.discipline === discipline);
const documentKeys = (discipline) => Object.keys(ledgerDocument(samples[0], discipline)).filter((k) => typeof ledgerDocument(samples[0], discipline)[k] === "number");
const sum = (values) => values.reduce((total, value) => total + value, 0);
const documentAccounted = (d) => sum(Object.entries(d).filter(([k, v]) => k.endsWith("Milliseconds") && typeof v === "number").map(([, v]) => v));
const adapterAccounted = (sample) => {
  const { ledger } = sample.stages.adapter;
  return sum(ledger.documents.map(documentAccounted)) + sum(Object.values(ledger.federation)) + sum(Object.values(ledger.write));
};

/** Bookkeeping identities every sample must satisfy; tolerances absorb float rounding and the gaps between timers. */
function closure(sample) {
  const { stages } = sample;
  const attributed = sum(compilerStageNames.map((name) => stages.stages[name]));
  const adapter = stages.adapter;
  const adapterProcess = sum(adapterProcessKeys.map((key) => adapter[key]));
  const checks = {
    compilerStagesPlusUnattributedEqualTotal: Math.abs(attributed + stages.unattributedMilliseconds - stages.totalMilliseconds) < 0.01,
    unattributedNonNegative: stages.unattributedMilliseconds >= 0,
    compileSubStagesEqualCompile: Math.abs(sum(compileStageNames.map((name) => stages.compileStages[name])) - stages.stages.compile) < 0.01,
    structureReadWithinReadSceneIr: stages.structureReadMilliseconds <= stages.stages.readSceneIr + 0.01,
    totalWithinCompileMilliseconds: stages.totalMilliseconds <= sample.compileMilliseconds + 0.1,
    adapterProcessWithinAdapterStage: adapterProcess <= stages.stages.adapter + 5,
    adapterLedgerWithinMain: adapterAccounted(sample) <= adapter.mainMilliseconds + 5,
    ledgerNamesEveryDocument: sameSet(adapter.ledger.documents.map((d) => d.discipline), documents.map((d) => d.discipline)),
    changedDocumentExtracted: ledgerDocument(sample, changedDocument.discipline)?.outcome === "extracted",
    unchangedDocumentsRestoredVerified: unchangedDisciplines.every((d) => ledgerDocument(sample, d)?.outcome === "restored" && ledgerDocument(sample, d)?.artifactState === "verified"),
  };
  return { ...checks, met: Object.values(checks).every(Boolean) };
}
const closures = samples.map(closure);
assert(closures.every((c) => c.met), `ledger closure failed: ${JSON.stringify(closures.filter((c) => !c.met))}`);

// ---------------------------------------------------------------------------
// Distributions over the accepted samples (median, p95 nearest-rank, min, max).
// ---------------------------------------------------------------------------
const distributions = {
  whole: {
    processMilliseconds: over((s) => s.processMilliseconds),
    compileMilliseconds: over((s) => s.compileMilliseconds),
    totalMilliseconds: over((s) => s.stages.totalMilliseconds),
    harnessOverheadMilliseconds: over((s) => s.processMilliseconds - s.compileMilliseconds),
    inProcessCompilerWorkMilliseconds: over((s) => s.stages.totalMilliseconds - s.stages.stages.adapter),
    peakWorkingSetBytes: over((s) => s.memory.peakWorkingSetBytes),
    peakPrivateBytes: over((s) => s.memory.peakPrivateBytes),
  },
  compilerStages: overKeys(compilerStageNames, (s) => s.stages.stages),
  unattributedMilliseconds: over((s) => s.stages.unattributedMilliseconds),
  structureReadMilliseconds: over((s) => s.stages.structureReadMilliseconds),
  compileStages: overKeys(compileStageNames, (s) => s.stages.compileStages),
  adapterProcess: overKeys(adapterProcessKeys, (s) => s.stages.adapter),
  adapterMainUnattributedMilliseconds: over((s) => s.stages.adapter.mainMilliseconds - adapterAccounted(s)),
  adapterDocuments: Object.fromEntries(
    documents.map(({ discipline }) => [
      discipline,
      {
        outcome: ledgerDocument(samples[0], discipline).outcome,
        ...(ledgerDocument(samples[0], discipline).artifactState ? { artifactState: ledgerDocument(samples[0], discipline).artifactState } : {}),
        ...overKeys(documentKeys(discipline), (s) => ledgerDocument(s, discipline)),
      },
    ]),
  ),
  adapterFederation: overKeys(federationKeys, (s) => s.stages.adapter.ledger.federation),
  adapterWrite: overKeys(writeKeys, (s) => s.stages.adapter.ledger.write),
  // ADR-0019 gate 3 baseline: what verifying every unchanged document costs today.
  unchangedArtifactVerifyMilliseconds: over((s) => sum(unchangedDisciplines.map((d) => ledgerDocument(s, d).artifactVerifyMilliseconds ?? 0))),
  unchangedArtifactLoadMilliseconds: over((s) => sum(unchangedDisciplines.map((d) => ledgerDocument(s, d).artifactLoadMilliseconds ?? 0))),
  unchangedArtifactBytes: sum(unchangedDisciplines.map((d) => ledgerDocument(samples[0], d).artifactBytes ?? 0)),
};

// ---------------------------------------------------------------------------
// Does the ADR-0019 Context attribution (single cpu-prof runs) reproduce
// within this record's own spread? Each row names the measured counterpart.
// ---------------------------------------------------------------------------
const attributionRows = {
  compileWall: { measured: "whole.totalMilliseconds", pick: (s) => s.stages.totalMilliseconds },
  adapterWait: { measured: "compilerStages.adapter", pick: (s) => s.stages.stages.adapter },
  inProcessCompilerWork: { measured: "whole.inProcessCompilerWorkMilliseconds", pick: (s) => s.stages.totalMilliseconds - s.stages.stages.adapter },
  structureStreamScan: { measured: "structureReadMilliseconds", pick: (s) => s.stages.structureReadMilliseconds },
  compileSceneToGltf: { measured: "compilerStages.compile", pick: (s) => s.stages.stages.compile },
  buildCompiledPayload: { measured: "compileStages.encodeGeometry", pick: (s) => s.stages.compileStages.encodeGeometry },
  documentStreaming: { measured: "compileStages.measureDocument", pick: (s) => s.stages.compileStages.measureDocument, note: "The probe timed streamJsonInto; the ledger times the measuring pass, which streams the same document once (json-document.ts)." },
  writeCompiledPackage: { measured: "compilerStages.writePackage", pick: (s) => s.stages.stages.writePackage },
  validateScene: { measured: "compileStages.validateScene", pick: (s) => s.stages.compileStages.validateScene },
};
const exploratoryAttribution = {
  source: "docs/adr/0019-document-artifact-transport.md, Context table (single cpu-prof run per model on this host)",
  rule: "reproduced when minimum <= exploratory <= maximum of this record's samples",
  rows: Object.fromEntries(
    Object.entries(attributionRows).map(([name, row]) => {
      const d = over(row.pick);
      const exploratory = model.exploratory[name];
      return [name, {
        exploratoryMilliseconds: exploratory,
        measured: row.measured,
        median: d.median,
        minimum: d.minimum,
        maximum: d.maximum,
        ratioMedianToExploratory: Number((d.median / exploratory).toFixed(3)),
        withinSpread: d.minimum <= exploratory && exploratory <= d.maximum,
        ...(row.note ? { note: row.note } : {}),
      }];
    }),
  ),
  notMeasured: {
    gcAndMicrotasks: {
      exploratoryMilliseconds: model.exploratory.gcAndMicrotasks,
      reason: "A cpu-prof category with no wall-clock stage; the nearest ledger figure is unattributedMilliseconds (wall time between stage timers), reported but not compared.",
      unattributedMedian: distributions.unattributedMilliseconds.median,
    },
  },
};
exploratoryAttribution.reproduced = Object.values(exploratoryAttribution.rows).every((row) => row.withinSpread);
exploratoryAttribution.rowsOutsideSpread = Object.entries(exploratoryAttribution.rows).filter(([, row]) => !row.withinSpread).map(([name]) => name);

const protocol = {
  processIsolation: "Every sample and the warm-up is one fresh `node scripts/lib/ifc-cache-sample.mjs` process; the adapter is a fresh Python process inside it.",
  cacheState: "Warm-up extracts the ORIGINAL federation once (adapter only) so every document artifact is warm. Before each sample the package cache entries and the changed document's artifact are deleted; the unchanged documents' artifacts stay. Each sample therefore restores every unchanged document and re-extracts the changed one, and its package cache lookup is a miss.",
  change: `${changedDocument.discipline}: ${JSON.stringify(model.edit.entity)} -> ${JSON.stringify(model.edit.replacement)}`,
  timing: "Adapter stages come from `--stage-timing` (a separate ledger file, never the report); compiler stages from `stageTiming: true` on compileIfcFederation. Neither touches a package byte: every sample's packageDigest must equal the first's.",
  sampleValidity: "A sample counts only when the process exits 0, the package cache misses, the document artifact hits are exactly the unchanged documents and the miss is exactly the changed one, no warning is emitted, the stage ledger is present, and the package digest equals the first sample's. Up to 3 attempts per index; every discarded attempt is recorded.",
  statistics: "median; p95 nearest-rank; minimum; maximum over the accepted samples",
  peakMemory: processTreeSampleMethod,
  uncontrolled: "Other processes on the host, disk cache state between samples, and CPU frequency scaling.",
};

const evidence = {
  schemaVersion: "naru.rebuild-stage-evidence.1",
  mode: "fresh-process-changed-discipline-stage-decomposition",
  recordedAt: new Date().toISOString(),
  model: modelId,
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
  },
  commit: {
    head: gitOutput("rev-parse", "HEAD"),
    describe: gitOutput("log", "-1", "--pretty=%s"),
    workingTreeClean: gitOutput("status", "--porcelain") === "",
  },
  fixture: {
    datasetId: model.datasetId,
    manifest: { path: "fixtures/external/manifest.json", sha256: sha256(manifestBytes) },
    license: dataset.license,
    documents: sourceIdentities,
  },
  changedDocument: changedIdentity,
  adapter: adapterIdentity,
  compileOptions: {
    threads,
    compactJson: model.compactJson,
    spatialIndex: true,
    relocateHierarchyNodes: true,
    cacheDirectory: portable(cacheDirectory),
    pythonExecutable: isAbsolute(ifcPython) && !relative(repositoryRoot, ifcPython).startsWith("..") ? portable(ifcPython) : basename(ifcPython),
  },
  protocol,
  packageDigest,
  warmUp,
  samples: samples.map((s) => ({
    index: s.index,
    exitCode: s.exitCode,
    processMilliseconds: s.processMilliseconds,
    compileMilliseconds: s.compileMilliseconds,
    peakWorkingSetBytes: s.memory.peakWorkingSetBytes,
    peakPrivateBytes: s.memory.peakPrivateBytes,
    maxProcessCount: s.memory.maxProcessCount,
    packageDigest: s.report.output.packageDigest,
    cache: s.cache,
    documentArtifactCache: s.documentArtifactCache,
    warnings: s.warnings,
    stages: s.stages,
  })),
  discardedSamples: discarded,
  closure: closures,
  distributions,
  exploratoryAttribution,
};

await mkdir(artifactDirectory, { recursive: true });
const recordPath = resolve(artifactDirectory, `${modelId}.json`);
await writeFile(recordPath, `${JSON.stringify(evidence, null, 2)}\n`);
const w = distributions.whole;
console.log(
  `[rebuild-stages] ${modelId}: ${samples.length} samples, ${discarded.length} discarded; process ${(w.processMilliseconds.median / 1000).toFixed(1)} s, compile ${(w.totalMilliseconds.median / 1000).toFixed(1)} s ` +
    `(adapter ${(distributions.compilerStages.adapter.median / 1000).toFixed(1)} s, compiler work ${(w.inProcessCompilerWorkMilliseconds.median / 1000).toFixed(1)} s), peak ${(w.peakWorkingSetBytes.median / 1e9).toFixed(2)} GB`,
);
for (const [name, row] of Object.entries(exploratoryAttribution.rows)) {
  console.log(`[rebuild-stages]   ${name}: exploratory ${row.exploratoryMilliseconds} vs median ${row.median} [${row.minimum}, ${row.maximum}] -> ${row.withinSpread ? "within spread" : "OUTSIDE spread"}`);
}
console.log(`[rebuild-stages] attribution ${exploratoryAttribution.reproduced ? "reproduced" : "NOT reproduced"}; wrote ${portable(recordPath)}`);
