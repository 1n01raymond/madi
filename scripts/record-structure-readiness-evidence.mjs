/**
 * Records how early an IFC federation's assembly tree can be published, as
 * ADR-0021 gate 0 requires: fresh-process, structure-only reads of every
 * document in the federation, with no tessellation anywhere in the path.
 *
 * The staged-preview design turns on one question. A cold sixty5 import spends
 * 282.5 s in the adapter (artifacts/cache/rebuild-stages), almost all of it
 * tessellating, and the product target for a usable hierarchy is 5-15 seconds.
 * Whether that target is reachable at all depends on how much of the adapter's
 * cost is parsing the STEP text -- which the tree needs -- and how much is
 * geometry -- which it does not. This recorder separates them by measuring the
 * whole path to a publishable tree: a raw byte scan of the file, the
 * IfcOpenShell parse, the containment walk, and JSON serialization of the
 * result.
 *
 * Nothing here compiles, caches, or writes a package. The measurement tool is
 * native/adapter-ifc/tools/measure_structure_readiness.py.
 *
 *   node scripts/record-structure-readiness-evidence.mjs --model digital-hub
 *   node scripts/record-structure-readiness-evidence.mjs --model sixty5
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  processTreeSampleMethod,
  startProcessTreeSampler,
} from "./lib/process-tree-sampler.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[structure-readiness] ${message}`);
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value.`);
  return value;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portable = (path) => relative(repositoryRoot, path).replaceAll("\\", "/");
const round = (value) => Number(value.toFixed(1));

/**
 * The two federations the rebuild-stage record already measures whole, so the
 * structure-only cost recorded here can be read against a cold import of the
 * same documents. `coldReference` quotes that record's CLEAN arm medians
 * (naru.rebuild-stage-evidence.2, artifacts/cache/rebuild-stages) for
 * orientation only; it is never compared under a gate rule here.
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
    coldReference: {
      record: "artifacts/cache/rebuild-stages/digital-hub.json",
      cleanProcessMilliseconds: 50028.4,
      cleanAdapterMilliseconds: 44980.5,
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
    coldReference: {
      record: "artifacts/cache/rebuild-stages/sixty5.json",
      cleanProcessMilliseconds: 320064.2,
      cleanAdapterMilliseconds: 282484.7,
    },
  },
};

/**
 * The product target issue #73 sets for a usable hierarchy. It is stated here
 * so the record reports against a bound fixed before any timing was read; this
 * record measures the adapter-side path only, so it can refute the target but
 * cannot on its own establish it (a viewer must still receive and draw).
 */
const productTarget = {
  source: "issue #73 acceptance criterion 8",
  lowerSeconds: 5,
  upperSeconds: 15,
  measures: "adapter-side time to a serialized assembly tree, excluding transport to a viewer",
};

const modelId = argumentValue("--model", "digital-hub");
const model = models[modelId];
assert(model, `--model must be one of ${Object.keys(models).join(", ")}.`);
const sampleCount = Number(argumentValue("--samples", "5"));
assert(Number.isSafeInteger(sampleCount) && sampleCount >= 1, "--samples must be a positive integer.");
const threads = Number(argumentValue("--threads", "6"));
assert(Number.isSafeInteger(threads) && threads >= 1, "--threads must be a positive integer.");
const artifactDirectory = resolve(repositoryRoot, argumentValue("--output", "artifacts/import/structure-readiness"));
const workingRoot = resolve(repositoryRoot, "output/structure-readiness", modelId);

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
  sourceIdentities.push({
    discipline: document.discipline,
    uriHint: document.uriHint,
    bytes: bytes.byteLength,
    sha256: digest,
  });
}

const ifcPython =
  process.env.NARU_IFC_PYTHON ?? process.env.NARU_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const adapterScript = resolve(repositoryRoot, "native/adapter-ifc/tools/extract_federation_scene_ir.py");
const adapterProbe = spawnSync(ifcPython, [adapterScript, "--identity"], { encoding: "utf8", windowsHide: true });
assert(adapterProbe.status === 0, `IFC adapter --identity failed: ${adapterProbe.stderr}`);
const adapterIdentity = JSON.parse(adapterProbe.stdout);
const measureScript = resolve(repositoryRoot, "native/adapter-ifc/tools/measure_structure_readiness.py");

function gitOutput(...args) {
  const probe = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  assert(probe.status === 0, `git ${args.join(" ")} failed: ${probe.stderr}`);
  return probe.stdout.trim();
}

const sampler = process.platform === "win32" ? startProcessTreeSampler({ intervalMilliseconds: 500 }) : undefined;

/** One fresh Python process reading every document structure-only, with process wall and peak tree memory around it. */
async function runSample(index) {
  const resultPath = join(workingRoot, `sample-${index}.json`);
  await rm(resultPath, { force: true });
  const documentArguments = documents.flatMap((document) => [
    "--document",
    `${document.discipline}=${resolve(repositoryRoot, document.sourcePath)}`,
  ]);
  console.log(`[structure-readiness] sample ${index} ...`);
  const startedAt = performance.now();
  const child = spawn(
    ifcPython,
    [measureScript, ...documentArguments, "--threads", String(threads), "--output", resultPath],
    { cwd: repositoryRoot, stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
  );
  const observation = sampler?.observe(child.pid);
  const exitCode = await new Promise((settle) => child.on("exit", (code) => settle(code ?? -1)));
  const processMilliseconds = round(performance.now() - startedAt);
  const memory = observation?.close();
  assert(exitCode === 0, `sample ${index} exited ${exitCode}.`);
  const measurement = JSON.parse(await readFile(resultPath, "utf8"));
  await rm(resultPath, { force: true });
  console.log(
    `[structure-readiness] sample ${index}: ${(processMilliseconds / 1000).toFixed(1)} s, ` +
      `federation ready ${(measurement.federation.sequentialReadyMilliseconds / 1000).toFixed(1)} s` +
      (memory ? `, peak tree ${(memory.peakWorkingSetBytes / 1e9).toFixed(2)} GB` : ""),
  );
  return { index, processMilliseconds, memory, measurement };
}

await mkdir(workingRoot, { recursive: true });
console.log(`[structure-readiness] ${modelId}: warm-up, then ${sampleCount} samples over ${documents.length} documents.`);
await runSample("warm-up");
const samples = [];
for (let index = 1; index <= sampleCount; index += 1) samples.push(await runSample(index));
sampler?.stop();

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

const documentOf = (sample, discipline) =>
  sample.measurement.documents.find((entry) => entry.discipline === discipline);

/**
 * What a structure-only read produces is a function of the file, not of the
 * run: the same entry count, the same payload bytes, the same keyword counts
 * every time. Those are asserted identical across samples and recorded once,
 * so the distributions below hold nothing but time and memory.
 */
const structure = documents.map(({ discipline }) => {
  const rows = samples.map((sample) => documentOf(sample, discipline));
  assert(rows.every(Boolean), `sample missing document ${discipline}.`);
  const shapeOf = (row) => ({
    schema: row.schema,
    sourceBytes: row.sourceBytes,
    structureEntries: row.structureEntries,
    structureRoots: row.structureRoots,
    aggregateRelations: row.aggregateRelations,
    containmentRelations: row.containmentRelations,
    structurePayloadBytes: row.structurePayloadBytes,
    scanKeywordCounts: row.scanKeywordCounts,
  });
  const shape = shapeOf(rows[0]);
  const canonical = JSON.stringify(shape);
  for (const row of rows) {
    assert(JSON.stringify(shapeOf(row)) === canonical, `${discipline} structure differed between samples.`);
  }
  return {
    discipline,
    uriHint: documents.find((d) => d.discipline === discipline).uriHint,
    ...shape,
    milliseconds: {
      scan: distribution(rows.map((row) => row.scanMilliseconds)),
      open: distribution(rows.map((row) => row.openMilliseconds)),
      walk: distribution(rows.map((row) => row.walkMilliseconds)),
      serialize: distribution(rows.map((row) => row.serializeMilliseconds)),
      ready: distribution(rows.map((row) => row.readyMilliseconds)),
    },
  };
});

const federationOf = (pick) => distribution(samples.map((sample) => pick(sample.measurement.federation)));
const federation = {
  documentCount: samples[0].measurement.federation.documentCount,
  sourceBytes: samples[0].measurement.federation.sourceBytes,
  structureEntries: samples[0].measurement.federation.structureEntries,
  structurePayloadBytes: samples[0].measurement.federation.structurePayloadBytes,
  threads,
  milliseconds: {
    scan: federationOf((f) => f.scanMilliseconds),
    sequentialReady: federationOf((f) => f.sequentialReadyMilliseconds),
    firstDocumentReady: federationOf((f) => f.firstDocumentReadyMilliseconds),
    slowestDocumentReady: federationOf((f) => f.slowestDocumentReadyMilliseconds),
    estimatedThreadedMakespan: federationOf((f) => f.estimatedThreadedMakespanMilliseconds),
  },
  makespanMethod: samples[0].measurement.federation.makespanMethod,
  process: distribution(samples.map((sample) => sample.processMilliseconds)),
};
const peakWorkingSet = sampler
  ? distribution(samples.map((sample) => sample.memory.peakWorkingSetBytes))
  : null;

/**
 * The reading the design turns on, computed from the medians above. Each field
 * is a fact about this record, not a claim about a shipped import: nothing here
 * publishes a tree, and the transport to a viewer is not measured.
 */
const seconds = (milliseconds) => Number((milliseconds / 1000).toFixed(3));
const slowest = [...structure].sort(
  (a, b) => b.milliseconds.ready.median - a.milliseconds.ready.median,
)[0];
const fastest = [...structure].sort(
  (a, b) => a.milliseconds.ready.median - b.milliseconds.ready.median,
)[0];
const parseShare = structure.reduce((total, entry) => total + entry.milliseconds.open.median, 0);
const walkShare = structure.reduce((total, entry) => total + entry.milliseconds.walk.median, 0);
const serializeShare = structure.reduce((total, entry) => total + entry.milliseconds.serialize.median, 0);
const sequentialMedian = federation.milliseconds.sequentialReady.median;
const findings = {
  parsingDominates: {
    parseMilliseconds: round(parseShare),
    walkMilliseconds: round(walkShare),
    serializeMilliseconds: round(serializeShare),
    parseShareOfReady: Number((parseShare / sequentialMedian).toFixed(4)),
    walkShareOfReady: Number((walkShare / sequentialMedian).toFixed(4)),
  },
  structureShareOfColdAdapter: Number(
    (sequentialMedian / model.coldReference.cleanAdapterMilliseconds).toFixed(4),
  ),
  coldReference: model.coldReference,
  criticalPath: {
    slowestDiscipline: slowest.discipline,
    slowestReadySeconds: seconds(slowest.milliseconds.ready.median),
    fastestDiscipline: fastest.discipline,
    fastestReadySeconds: seconds(fastest.milliseconds.ready.median),
  },
  productTarget,
  againstProductTarget: {
    sequentialWholeFederationSeconds: seconds(sequentialMedian),
    sequentialWithinUpperBound: seconds(sequentialMedian) <= productTarget.upperSeconds,
    estimatedThreadedSeconds: seconds(federation.milliseconds.estimatedThreadedMakespan.median),
    estimatedThreadedWithinUpperBound:
      seconds(federation.milliseconds.estimatedThreadedMakespan.median) <= productTarget.upperSeconds,
    firstDocumentSeconds: seconds(federation.milliseconds.firstDocumentReady.median),
    firstDocumentWithinUpperBound:
      seconds(federation.milliseconds.firstDocumentReady.median) <= productTarget.upperSeconds,
  },
};

const record = {
  schemaVersion: "naru.structure-readiness.1",
  mode: "fresh-process-structure-only-federation-read",
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
  adapter: adapterIdentity,
  tool: {
    path: portable(measureScript),
    schemaVersion: samples[0].measurement.schemaVersion,
    ifcopenshellVersion: samples[0].measurement.ifcopenshellVersion,
    pythonVersion: samples[0].measurement.pythonVersion,
    pythonExecutable:
      isAbsolute(ifcPython) && !relative(repositoryRoot, ifcPython).startsWith("..")
        ? portable(ifcPython)
        : basename(ifcPython),
  },
  protocol: {
    sampleCount,
    discardedSamples: 0,
    warmUpRuns: 1,
    rule:
      "One warm-up run, then every subsequent run recorded. Each sample is a fresh Python process reading every " +
      "document in its own pass. No sample is discarded for its timing; a non-zero exit aborts the recording.",
    covers:
      "Raw byte scan, IfcOpenShell parse, spatial containment walk, and JSON serialization of the resulting entry " +
      "list. Property and classification association is excluded (the cold adapter spends a separate " +
      "propertyIndex stage on it), and no representation is evaluated, so nothing here tessellates.",
    caveats: [
      "The OS page cache is not dropped between samples, matching the protocol of artifacts/cache/sixty5.",
      "Threaded makespan is arithmetic over the measured per-document durations, not a measured parallel run.",
      "Time to a viewer is not measured: this is the adapter-side path to a serialized tree only.",
    ],
  },
  memory: {
    method: sampler ? processTreeSampleMethod : "unsupported",
    peakWorkingSetBytes: peakWorkingSet,
  },
  structure,
  federation,
  samples: samples.map((sample) => ({
    index: sample.index,
    processMilliseconds: sample.processMilliseconds,
    ...(sample.memory
      ? {
          peakWorkingSetBytes: sample.memory.peakWorkingSetBytes,
          peakPrivateBytes: sample.memory.peakPrivateBytes,
        }
      : {}),
    federation: sample.measurement.federation,
    documents: sample.measurement.documents,
  })),
  findings,
};

await mkdir(artifactDirectory, { recursive: true });
const recordPath = join(artifactDirectory, `${modelId}.json`);
await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
await rm(workingRoot, { recursive: true, force: true });

console.log(
  `[structure-readiness] ${modelId}: whole federation ready ${seconds(sequentialMedian)} s sequential, ` +
    `${seconds(federation.milliseconds.estimatedThreadedMakespan.median)} s estimated at ${threads} threads, ` +
    `first document ${seconds(federation.milliseconds.firstDocumentReady.median)} s (${fastest.discipline}), ` +
    `slowest ${seconds(slowest.milliseconds.ready.median)} s (${slowest.discipline}).`,
);
console.log(
  `[structure-readiness] parse ${round(parseShare)} ms vs walk ${round(walkShare)} ms vs serialize ` +
    `${round(serializeShare)} ms; the structure path is ` +
    `${(findings.structureShareOfColdAdapter * 100).toFixed(1)}% of the cold adapter's ` +
    `${seconds(model.coldReference.cleanAdapterMilliseconds)} s.`,
);
console.log(`[structure-readiness] wrote ${portable(recordPath)}`);
