/**
 * Records that the IFC adapter publishes one document's assembly tree before
 * it tessellates that document, as ADR-0021 gate 1 requires.
 *
 * Gate 0 (artifacts/import/structure-readiness) measured how long a tree takes
 * to resolve with no tessellation anywhere in the path. It could not show that
 * a real extraction publishes one, because nothing published one. This record
 * runs the shipping adapter twice over the same federation -- once with
 * `--structure-preview`, once without -- and measures the staged arm from the
 * outside: a poller watches the preview directory, verifies each tree's stored
 * bytes against the index the moment it is named, and timestamps that against
 * the process spawn.
 *
 * Three things are established, and nothing else is claimed:
 *
 *   1. Order. Trees arrive smallest source first, and every one of them lands
 *      before its own document's extraction finishes.
 *   2. Agreement. Each tree's node count equals that document's occurrence
 *      count in the Scene IR the same run produced. Gate 1 was drafted against
 *      gate 0's per-document counts; those count only spatial-containment
 *      participants, so they are recorded here for comparison and the
 *      equality is pinned against the Scene IR instead. See the record README.
 *   3. Cost. The two arms are compared byte for byte on all four outputs, so
 *      staging is shown to move nothing, and their process times are recorded
 *      side by side so what staging costs is visible rather than assumed.
 *
 * A viewer is not in this path. The first-tree time recorded here is
 * adapter-side: process spawn to a verified tree on disk, transport excluded.
 *
 *   node scripts/record-structure-first-emission-evidence.mjs --model digital-hub
 *   node scripts/record-structure-first-emission-evidence.mjs --model sixty5 --samples 3
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import {
  processTreeSampleMethod,
  startProcessTreeSampler,
} from "./lib/process-tree-sampler.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[structure-first-emission] ${message}`);
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value.`);
  return value;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portable = (path) => relative(repositoryRoot, path).split(sep).join("/");
const round = (value) => Number(value.toFixed(1));
const seconds = (milliseconds) => Number((milliseconds / 1000).toFixed(3));

/**
 * The same two federations gate 0 measured, so a staged emission can be read
 * against that record's structure-only timings for the same documents.
 * `readinessRecord` is the committed gate-0 record this one quotes for the
 * per-document count comparison; it is read, never rewritten.
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
    readinessRecord: "artifacts/import/structure-readiness/digital-hub.json",
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
    readinessRecord: "artifacts/import/structure-readiness/sixty5.json",
  },
};

/**
 * The product target issue #73 sets, quoted so the record reports against a
 * bound fixed before any timing was read. This record measures the adapter
 * side only, so it can refute the target but cannot on its own establish it:
 * ADR-0021 gate 4 still has to measure a viewer.
 */
const productTarget = {
  source: "issue #73 acceptance criterion 8",
  lowerSeconds: 5,
  upperSeconds: 15,
  measures:
    "process spawn to a verified staged tree on disk, transport to a viewer excluded",
};

const modelId = argumentValue("--model", "digital-hub");
const model = models[modelId];
assert(model, `--model must be one of ${Object.keys(models).join(", ")}.`);
const sampleCount = Number(argumentValue("--samples", "5"));
assert(Number.isSafeInteger(sampleCount) && sampleCount >= 1, "--samples must be a positive integer.");
const threads = Number(argumentValue("--threads", "6"));
assert(Number.isSafeInteger(threads) && threads >= 1, "--threads must be a positive integer.");
const pollMilliseconds = Number(argumentValue("--poll", "25"));
assert(Number.isSafeInteger(pollMilliseconds) && pollMilliseconds >= 1, "--poll must be a positive integer.");
const artifactDirectory = resolve(
  repositoryRoot,
  argumentValue("--output", "artifacts/import/structure-first-emission"),
);
const workingRoot = resolve(repositoryRoot, "output/structure-first-emission", modelId);

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

/**
 * Emission order is a property of the sources, not of a run, so it is derived
 * here and compared against what the adapter's index declares.
 */
const expectedEmissionOrder = [...sourceIdentities]
  .sort((a, b) => a.bytes - b.bytes || a.discipline.localeCompare(b.discipline))
  .map(({ discipline }) => discipline);

const readiness = JSON.parse(
  await readFile(resolve(repositoryRoot, model.readinessRecord), "utf8"),
);
assert(
  readiness.schemaVersion === "naru.structure-readiness.1",
  `${model.readinessRecord} is not a naru.structure-readiness.1.`,
);
const readinessEntries = new Map(
  readiness.structure.map((entry) => [entry.discipline, entry.structureEntries]),
);

const ifcPython =
  process.env.NARU_IFC_PYTHON ?? process.env.NARU_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const adapterScript = resolve(repositoryRoot, "native/adapter-ifc/tools/extract_federation_scene_ir.py");
const adapterProbe = spawnSync(ifcPython, [adapterScript, "--identity"], { encoding: "utf8", windowsHide: true });
assert(adapterProbe.status === 0, `IFC adapter --identity failed: ${adapterProbe.stderr}`);
const adapterIdentity = JSON.parse(adapterProbe.stdout);

function gitOutput(...args) {
  const probe = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  assert(probe.status === 0, `git ${args.join(" ")} failed: ${probe.stderr}`);
  return probe.stdout.trim();
}

/**
 * Watches a preview directory the way a consumer would: read the index, and
 * for every document it newly names, verify the stored bytes against the
 * length and digest the index declares before parsing them.
 *
 * Two failure modes are counted rather than swallowed. `contendedReads` are
 * reads that lost a race with the adapter's rename and were retried on the
 * next tick -- expected on Windows, and harmless. A read that succeeds and
 * does not match the index refutes the atomic-publish claim, so it aborts the
 * recording rather than being counted.
 */
function watchPreviewDirectory(directory, startedAt) {
  const observations = [];
  const seen = new Set();
  let contendedReads = 0;
  let indexPolls = 0;
  let emissionOrder = null;
  let complete = false;

  const poll = () => {
    let index;
    try {
      index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
      indexPolls += 1;
    } catch {
      contendedReads += 1;
      return;
    }
    assert(
      index.schemaVersion === "naru.ifc-structure-preview-index.1",
      "preview index is not a naru.ifc-structure-preview-index.1.",
    );
    emissionOrder = index.emissionOrder;
    complete = index.complete === true;
    for (const descriptor of index.documents) {
      if (seen.has(descriptor.discipline)) continue;
      let stored;
      try {
        stored = readFileSync(join(directory, descriptor.path));
      } catch {
        contendedReads += 1;
        continue;
      }
      const observedAt = performance.now();
      assert(
        stored.byteLength === descriptor.byteLength && sha256(stored) === descriptor.sha256,
        `staged tree ${descriptor.path} did not match the index it was named in.`,
      );
      const preview = JSON.parse(stored.toString("utf8"));
      assert(
        preview.schemaVersion === "naru.ifc-structure-preview.1",
        `${descriptor.path} is not a naru.ifc-structure-preview.1.`,
      );
      seen.add(descriptor.discipline);
      observations.push({
        discipline: descriptor.discipline,
        observedMilliseconds: round(observedAt - startedAt),
        nodeCount: descriptor.nodeCount,
        rootCount: descriptor.rootCount,
        byteLength: descriptor.byteLength,
        sha256: descriptor.sha256,
        schema: preview.schema,
        sourceDigest: preview.sourceDigest,
        parentedNodes: preview.nodes.filter((node) => node.parent !== null).length,
        namedNodes: preview.nodes.filter((node) => node.name !== undefined).length,
      });
    }
  };

  const timer = setInterval(poll, pollMilliseconds);
  return {
    close() {
      clearInterval(timer);
      poll();
      return { observations, contendedReads, indexPolls, emissionOrder, complete };
    },
  };
}

const sampler = process.platform === "win32" ? startProcessTreeSampler({ intervalMilliseconds: 500 }) : undefined;
/** Streamed so a 345 MB Scene IR is never held whole to be hashed. */
async function digestFile(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const outputNames = ["scene-ir.json", "scene-ir-geometry.bin", "scene-ir-properties.bin", "adapter-report.json"];

/** One fresh adapter process over the whole federation, staged or not. */
async function runSample(arm, index) {
  const directory = join(workingRoot, `${arm}-${index}`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const previewDirectory = join(directory, "preview");
  const stageTimingPath = join(directory, "stage-timing.json");
  const adapterArguments = [
    adapterScript,
    ...documents.flatMap((document) => [
      "--document",
      `${document.discipline}=${resolve(repositoryRoot, document.sourcePath)}`,
      "--uri-hint",
      `${document.discipline}=${document.uriHint}`,
    ]),
    "--scene",
    join(directory, "scene-ir.json"),
    "--geometry",
    join(directory, "scene-ir-geometry.bin"),
    "--properties",
    join(directory, "scene-ir-properties.bin"),
    "--report",
    join(directory, "adapter-report.json"),
    "--threads",
    String(threads),
    "--stage-timing",
    stageTimingPath,
    ...(arm === "staged" ? ["--structure-preview", previewDirectory] : []),
  ];
  console.log(`[structure-first-emission] ${arm} sample ${index} ...`);
  const startedAt = performance.now();
  const child = spawn(ifcPython, adapterArguments, {
    cwd: repositoryRoot,
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  const observation = sampler?.observe(child.pid);
  const watcher = arm === "staged" ? watchPreviewDirectory(previewDirectory, startedAt) : undefined;
  const exitCode = await new Promise((settle) => child.on("exit", (code) => settle(code ?? -1)));
  const processMilliseconds = round(performance.now() - startedAt);
  const watched = watcher?.close();
  const memory = observation?.close();
  assert(exitCode === 0, `${arm} sample ${index} exited ${exitCode}.`);

  if (watched) {
    assert(
      watched.complete === true,
      `${arm} sample ${index} left the preview index incomplete.`,
    );
    for (const document of documents) {
      assert(
        watched.observations.some((entry) => entry.discipline === document.discipline),
        `${arm} sample ${index} never published a verified tree for ${document.discipline}.`,
      );
    }
  }

  const digests = {};
  for (const name of outputNames) digests[name] = await digestFile(join(directory, name));
  const report = JSON.parse(await readFile(join(directory, "adapter-report.json"), "utf8"));
  const stageTiming = JSON.parse(await readFile(stageTimingPath, "utf8"));
  await rm(directory, { recursive: true, force: true });
  console.log(
    `[structure-first-emission] ${arm} sample ${index}: ${(processMilliseconds / 1000).toFixed(1)} s` +
      (watched ? `, first tree ${(watched.observations[0].observedMilliseconds / 1000).toFixed(2)} s` : "") +
      (memory ? `, peak tree ${(memory.peakWorkingSetBytes / 1e9).toFixed(2)} GB` : ""),
  );
  return { arm, index, processMilliseconds, memory, digests, report, stageTiming, watched };
}

await mkdir(workingRoot, { recursive: true });
console.log(
  `[structure-first-emission] ${modelId}: warm-up, then ${sampleCount} interleaved sample(s) per arm ` +
    `over ${documents.length} documents at ${threads} threads.`,
);
await runSample("staged", "warm-up");
const samples = [];
for (let index = 1; index <= sampleCount; index += 1) {
  samples.push(await runSample("staged", index));
  samples.push(await runSample("plain", index));
}
sampler?.stop();
await rm(workingRoot, { recursive: true, force: true });

const staged = samples.filter((sample) => sample.arm === "staged");
const plain = samples.filter((sample) => sample.arm === "plain");

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

/**
 * Every output of every sample in both arms is compared against the first
 * sample's. Staging changes the order documents are inspected in, so this is
 * the check that would catch an order dependency leaking into the bytes.
 */
const canonicalDigests = staged[0].digests;
for (const sample of samples) {
  for (const name of outputNames) {
    assert(
      sample.digests[name] === canonicalDigests[name],
      `${sample.arm} sample ${sample.index} wrote a different ${name}.`,
    );
  }
}

const stageDocument = (sample, discipline) =>
  sample.stageTiming.documents.find((entry) => entry.discipline === discipline);
const observationOf = (sample, discipline) =>
  sample.watched.observations.find((entry) => entry.discipline === discipline);
const reportSource = (sample, discipline) =>
  sample.report.sources.find((entry) => entry.discipline === discipline);

/**
 * One row per document. The shape of a staged tree is a function of the file,
 * so node count, root count, byte length, and digest are asserted identical
 * across samples and recorded once; only time varies below them.
 *
 * `sceneIrOccurrenceCount` comes from the adapter report the same run wrote,
 * and `readinessStructureEntries` from the committed gate-0 record. They are
 * different trees on purpose: gate 0 walked spatial containment only, while a
 * staged tree carries every occurrence the Scene IR carries, so a preview node
 * and a Scene IR node are the same node. The gate-1 equality is pinned against
 * the first; the second is recorded so the difference is visible, not hidden.
 */
const perDocument = documents.map(({ discipline, uriHint }) => {
  const rows = staged.map((sample) => observationOf(sample, discipline));
  assert(rows.every(Boolean), `a staged sample published no tree for ${discipline}.`);
  const shapeOf = (row) => ({
    nodeCount: row.nodeCount,
    rootCount: row.rootCount,
    byteLength: row.byteLength,
    sha256: row.sha256,
    schema: row.schema,
    sourceDigest: row.sourceDigest,
    parentedNodes: row.parentedNodes,
    namedNodes: row.namedNodes,
  });
  const shape = shapeOf(rows[0]);
  const canonical = JSON.stringify(shape);
  for (const row of rows) {
    assert(JSON.stringify(shapeOf(row)) === canonical, `${discipline} staged tree differed between samples.`);
  }
  const occurrenceCounts = new Set(
    samples.map((sample) => reportSource(sample, discipline).counts.occurrenceCount),
  );
  assert(occurrenceCounts.size === 1, `${discipline} reported more than one occurrence count.`);
  const sceneIrOccurrenceCount = [...occurrenceCounts][0];
  return {
    discipline,
    uriHint,
    sourceBytes: sourceIdentities.find((entry) => entry.discipline === discipline).bytes,
    emissionRank: expectedEmissionOrder.indexOf(discipline),
    ...shape,
    sceneIrOccurrenceCount,
    nodeCountMatchesSceneIr: shape.nodeCount === sceneIrOccurrenceCount,
    readinessStructureEntries: readinessEntries.get(discipline) ?? null,
    milliseconds: {
      observedPublish: distribution(rows.map((row) => row.observedMilliseconds)),
      structureReady: distribution(
        staged.map((sample) => round(stageDocument(sample, discipline).structureReadyMilliseconds)),
      ),
      structurePublish: distribution(
        staged.map((sample) => round(stageDocument(sample, discipline).structurePublishMilliseconds)),
      ),
      extractStaged: distribution(
        staged.map((sample) => round(stageDocument(sample, discipline).extractMilliseconds)),
      ),
      extractPlain: distribution(
        plain.map((sample) => round(stageDocument(sample, discipline).extractMilliseconds)),
      ),
    },
  };
});

const declaredOrders = new Set(staged.map((sample) => JSON.stringify(sample.watched.emissionOrder)));
assert(declaredOrders.size === 1, "staged samples declared more than one emission order.");
const declaredEmissionOrder = JSON.parse([...declaredOrders][0]);
const observedOrders = new Set(
  staged.map((sample) => JSON.stringify(sample.watched.observations.map((entry) => entry.discipline))),
);

/**
 * What the record concludes, computed from the medians above. Each field is a
 * fact about this record: nothing here transports a tree to a viewer, and no
 * package is written, so gate 4 and gate 2 are untouched by it.
 */
const firstDiscipline = expectedEmissionOrder[0];
const firstRow = perDocument.find((entry) => entry.discipline === firstDiscipline);
const stagedProcess = distribution(staged.map((sample) => sample.processMilliseconds));
const plainProcess = distribution(plain.map((sample) => sample.processMilliseconds));
const findings = {
  emissionOrder: {
    expected: expectedEmissionOrder,
    declared: declaredEmissionOrder,
    observed: JSON.parse([...observedOrders][0]),
    stableAcrossSamples: observedOrders.size === 1,
    rule: "ascending source size, ties broken by discipline name",
    matchesSourceSize: JSON.stringify(declaredEmissionOrder) === JSON.stringify(expectedEmissionOrder),
  },
  firstTree: {
    discipline: firstDiscipline,
    sourceBytes: firstRow.sourceBytes,
    nodeCount: firstRow.nodeCount,
    observedSeconds: seconds(firstRow.milliseconds.observedPublish.median),
    observedP95Seconds: seconds(firstRow.milliseconds.observedPublish.p95),
    shareOfStagedProcess: Number(
      (firstRow.milliseconds.observedPublish.median / stagedProcess.median).toFixed(4),
    ),
  },
  structureBeforeTessellation: {
    rule: "every document publishes its tree before its own extraction finishes",
    holds: perDocument.every(
      (entry) => entry.milliseconds.structureReady.maximum < entry.milliseconds.extractStaged.minimum,
    ),
    slowestReadyMilliseconds: Math.max(
      ...perDocument.map((entry) => entry.milliseconds.structureReady.median),
    ),
    wholeFederationObservedSeconds: seconds(
      Math.max(...perDocument.map((entry) => entry.milliseconds.observedPublish.median)),
    ),
  },
  countsAgreeWithSceneIr: perDocument.every((entry) => entry.nodeCountMatchesSceneIr),
  federationCompletion: {
    rule: "documents are inspected one after another, so document N's tree waits for N-1 tessellations",
    lastTreeObservedSeconds: seconds(
      Math.max(...perDocument.map((entry) => entry.milliseconds.observedPublish.median)),
    ),
    shareOfStagedProcess: Number(
      (
        Math.max(...perDocument.map((entry) => entry.milliseconds.observedPublish.median)) /
        stagedProcess.median
      ).toFixed(4),
    ),
    structureOnlyPassSeconds: seconds(readiness.federation.milliseconds.sequentialReady.median),
    note:
      "Publishing every tree before any tessellation would need a structure-only pass over the " +
      "whole federation, which gate 0 measured at structureOnlyPassSeconds. ADR-0021 chose the " +
      "per-document unit, so this record measures what that choice delivers and leaves the " +
      "alternative priced rather than taken.",
  },
  stagingCost: {
    stagedMedianMilliseconds: stagedProcess.median,
    plainMedianMilliseconds: plainProcess.median,
    differenceMilliseconds: round(stagedProcess.median - plainProcess.median),
    ratio: Number((stagedProcess.median / plainProcess.median).toFixed(4)),
    publishMilliseconds: round(
      perDocument.reduce((total, entry) => total + entry.milliseconds.structurePublish.median, 0),
    ),
    stagedBytes: perDocument.reduce((total, entry) => total + entry.byteLength, 0),
  },
  productTarget,
  againstProductTarget: {
    firstTreeSeconds: seconds(firstRow.milliseconds.observedPublish.median),
    firstTreeWithinUpperBound:
      seconds(firstRow.milliseconds.observedPublish.median) <= productTarget.upperSeconds,
    wholeFederationSeconds: seconds(
      Math.max(...perDocument.map((entry) => entry.milliseconds.observedPublish.median)),
    ),
    wholeFederationWithinUpperBound:
      seconds(Math.max(...perDocument.map((entry) => entry.milliseconds.observedPublish.median))) <=
      productTarget.upperSeconds,
  },
};

const record = {
  schemaVersion: "naru.structure-first-emission.1",
  mode: "fresh-process-staged-adapter-emission",
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
    path: portable(adapterScript),
    previewSchema: "naru.ifc-structure-preview.1",
    previewIndexSchema: "naru.ifc-structure-preview-index.1",
    stageTimingSchema: staged[0].stageTiming.schemaVersion,
    pythonExecutable:
      isAbsolute(ifcPython) && !relative(repositoryRoot, ifcPython).startsWith("..")
        ? portable(ifcPython)
        : basename(ifcPython),
  },
  protocol: {
    sampleCount,
    discardedSamples: 0,
    warmUpRuns: 1,
    threads,
    pollMilliseconds,
    arms: {
      staged: "the adapter with --structure-preview, watched from the outside by this recorder",
      plain: "the same adapter, same documents, same threads, without --structure-preview",
    },
    rule:
      "One discarded staged warm-up, then the two arms alternate staged, plain, staged, plain so a drift in " +
      "host load cannot land on one arm. No sample is discarded for its timing; a non-zero exit, a tree that " +
      "fails verification, or an output that differs between samples aborts the recording.",
    covers:
      "The shipping adapter over the whole federation with no document-artifact cache, so every document is " +
      "extracted. First-tree time is measured from process spawn, which includes interpreter start and imports.",
    caveats: [
      "Publication times are observed by a poller, so each is accurate to the poll interval, not better.",
      "The OS page cache is not dropped between samples, matching the protocol of artifacts/cache/sixty5.",
      "No viewer is in this path: transport, parse, and draw are ADR-0021 gate 4, not this record.",
      "Documents are inspected sequentially; a threaded federation read is not measured here.",
    ],
  },
  memory: {
    method: sampler ? processTreeSampleMethod : "unsupported",
    stagedPeakWorkingSetBytes: sampler ? distribution(staged.map((s) => s.memory.peakWorkingSetBytes)) : null,
    plainPeakWorkingSetBytes: sampler ? distribution(plain.map((s) => s.memory.peakWorkingSetBytes)) : null,
  },
  outputIdentity: {
    rule: "every output of every sample in both arms equals the first staged sample's, byte for byte",
    comparisons: (samples.length - 1) * outputNames.length,
    exclusions: [],
    digests: canonicalDigests,
  },
  documents: perDocument,
  process: { staged: stagedProcess, plain: plainProcess },
  samples: samples.map((sample) => ({
    arm: sample.arm,
    index: sample.index,
    processMilliseconds: sample.processMilliseconds,
    ...(sample.memory
      ? { peakWorkingSetBytes: sample.memory.peakWorkingSetBytes, peakPrivateBytes: sample.memory.peakPrivateBytes }
      : {}),
    ...(sample.watched
      ? {
          preview: {
            complete: sample.watched.complete,
            indexPolls: sample.watched.indexPolls,
            contendedReads: sample.watched.contendedReads,
            observations: sample.watched.observations,
          },
        }
      : {}),
    stages: sample.stageTiming,
  })),
  findings,
};

await mkdir(artifactDirectory, { recursive: true });
const recordPath = join(artifactDirectory, `${modelId}.json`);
await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

console.log(
  `[structure-first-emission] ${modelId}: first tree ${findings.firstTree.observedSeconds} s ` +
    `(${findings.firstTree.discipline}, ${findings.firstTree.nodeCount} nodes), whole federation ` +
    `${findings.againstProductTarget.wholeFederationSeconds} s, staged process ` +
    `${seconds(stagedProcess.median)} s vs plain ${seconds(plainProcess.median)} s.`,
);
console.log(`[structure-first-emission] wrote ${portable(recordPath)}`);
