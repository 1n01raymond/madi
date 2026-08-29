/**
 * Records cold, warm, and corrupt-entry compiled-cache distributions for the
 * pinned sixty5 IFC federation.
 *
 * `record-import-cache-evidence.mjs` measures one sample of each state for a
 * mid-size federation inside a single process. A real-large model asks two
 * further questions that a single sample cannot answer: how much the elapsed
 * time varies between fresh processes, and how much memory the compiler and
 * its native adapter hold together while the work happens. Every protocol
 * decision below is fixed here, before any timing is read, so that a slow run
 * cannot be reinterpreted after the fact.
 */
import { constants } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";

import {
  processTreeSampleMethod,
  startProcessTreeSampler,
} from "./lib/process-tree-sampler.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const workingRoot = resolve(repositoryRoot, "output/sixty5-cache");
const artifactDirectory = resolve(repositoryRoot, process.argv[2] ?? "artifacts/cache/sixty5");
const datasetId = "ifc-bench-sixty5";

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith("--"), `${name} requires a value.`);
  return value;
}

const samplesPerState = Number(argumentValue("--samples", "5"));
assert(
  Number.isSafeInteger(samplesPerState) && samplesPerState >= 1,
  "--samples must be a positive integer.",
);

/**
 * The protocol, fixed before the first sample. `unchangedReopenTargetMs` is the
 * product target this record measures against; it is never adjusted to match a
 * result.
 */
const protocol = {
  samplesPerState,
  states: ["cold", "warm", "corrupt-entry"],
  processIsolation:
    "One fresh node process per sample. A second compile inside one process would reuse a warm module graph and a grown V8 heap that a user reopening a model tomorrow does not have.",
  iteration:
    "Each iteration clears both caches, takes the cold sample that repopulates them, takes the warm sample against that entry, corrupts scene.gltf inside the entry, and takes the corrupt-entry sample.",
  coldPreparation:
    "The whole cache directory is removed, so both the compiled package entry and the adapter document artifact cache start empty.",
  warmPreparation:
    "The cache is left exactly as the preceding cold sample published it; nothing is warmed up beyond that compile.",
  corruptEntryPreparation:
    "The first byte of scene.gltf inside the cache entry is flipped. The adapter document artifact cache is deliberately left intact, because that is the state a user with one damaged package entry actually has; the record reports which documents each run restored.",
  outputHandling:
    "Every sample compiles into its own output directory, which is hashed in full and then deleted; only digests are retained.",
  failedRunHandling:
    "A sample whose compile throws, or whose cache status is not the one its state requires, is recorded in discardedSamples with its reason and immediately re-run. The retained samples are the first valid ones per state.",
  statistics: {
    median: "The middle value of the sorted retained samples; the mean of the two middle values when the count is even.",
    p95: "Nearest-rank observed p95: the ceil(0.95 * n)-th value of the sorted samples, which is the maximum at n = 5. It is an order statistic of the samples taken, not an estimate of the population.",
  },
  peakProcessMemory: {
    method: processTreeSampleMethod,
    intervalMilliseconds: 500,
    note: "Win32_Process WorkingSetSize summed over the tree rooted at the sample process, so the native IfcOpenShell adapter is included. A peak that rises and falls entirely between two snapshots is invisible to it; the summed per-process PeakWorkingSetSize counter is reported beside it as an upper bound that no sampling gap can miss but that charges peaks which never coincided.",
  },
  uncontrolled: [
    "The operating system file cache is not cleared between samples, so after the first iteration the 840 MB of source documents are likely already resident. Cold here means both compiler caches are empty, not that the host is cold.",
    "The sampler itself runs one PowerShell process for the whole session and is not excluded from the host's load.",
  ],
  gltfFormatting:
    "Every sample compiles with compactJson: true, which is what the committed sixty5 packages were compiled with, so the digests here stay comparable to them. The default pretty-printed document for this federation is larger than the runtime's maximum string length, which is why the compiler writes it as a stream instead of building it as one string (ADR-0016); defaultFormattingProbe compiles that default once, before the samples, and reports what it produced.",
  unchangedReopenTargetMs: { minimum: 1_000, maximum: 5_000 },
  reportComparison: {
    byteIdenticalResources: "Every file a sample writes except adapter-report.json.",
    semanticExclusions: ["adapter-report.json:documentArtifactCache"],
    note: "The document artifact cache result is the only execution-path telemetry excluded, and its value is recorded per sample instead of being normalized away. A cold run records seven misses; a corrupt-entry fallback records seven hits, because only the package entry was damaged; a warm hit does not run the adapter at all and restores the publishing run's report verbatim.",
  },
};

const manifestPath = resolve(repositoryRoot, "fixtures/external/manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const dataset = manifest.datasets.find(({ id }) => id === datasetId);
assert(dataset, `Unknown external fixture dataset ${datasetId}.`);

const documents = [
  ["architecture", "arc.ifc"],
  ["electrical", "electrical.ifc"],
  ["facade", "facade.ifc"],
  ["kitchen", "kitchen.ifc"],
  ["plumbing", "plumbing.ifc"],
  ["structure", "str.ifc"],
  ["ventilation", "ventilation.ifc"],
].map(([discipline, fileName]) => ({
  discipline,
  sourcePath: `output/external-fixtures/${datasetId}/${fileName}`,
  uriHint: `projects/sixty5/${fileName}`,
  fileName,
}));

const sourceIdentities = [];
for (const document of documents) {
  const bytes = await readFile(resolve(repositoryRoot, document.sourcePath));
  const digest = sha256(bytes);
  assert(
    dataset.assets.some(({ sha256: assetDigest }) => assetDigest === digest),
    `${document.fileName} is not a pinned asset of ${datasetId}.`,
  );
  sourceIdentities.push({
    discipline: document.discipline,
    uriHint: document.uriHint,
    bytes: bytes.byteLength,
    sha256: digest,
  });
}

const ifcPython =
  process.env.NARU_IFC_PYTHON ??
  process.env.NARU_PYTHON ??
  (process.platform === "win32" ? "python" : "python3");
const adapterScript = resolve(
  repositoryRoot,
  "native/adapter-ifc/tools/extract_federation_scene_ir.py",
);
const adapterProbe = spawnSync(ifcPython, [adapterScript, "--identity"], {
  encoding: "utf8",
  windowsHide: true,
});
assert(adapterProbe.status === 0, `IFC adapter --identity failed: ${adapterProbe.stderr}`);
const adapterIdentity = JSON.parse(adapterProbe.stdout);

function gitOutput(...args) {
  const probe = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert(probe.status === 0, `git ${args.join(" ")} failed: ${probe.stderr}`);
  return probe.stdout.trim();
}

const threads = Number(argumentValue("--threads", "6"));
assert(Number.isSafeInteger(threads) && threads >= 1, "--threads must be a positive integer.");

const configPath = join(workingRoot, "sample-config.json");
await mkdir(workingRoot, { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify(
    {
      cacheDirectory: relative(repositoryRoot, join(workingRoot, "cache")).replaceAll("\\", "/"),
      threads,
      compactJson: true,
      pythonExecutable: ifcPython,
      documents: documents.map(({ discipline, sourcePath, uriHint }) => ({
        discipline,
        sourcePath,
        uriHint,
      })),
    },
    null,
    2,
  )}\n`,
);
const cacheDirectory = join(workingRoot, "cache");

const excludedReportField = "documentArtifactCache";

/** Hashes everything a sample wrote, so two samples can be compared file by file. */
async function identifyOutput(outputDirectory) {
  const names = (await readdir(outputDirectory)).sort((a, b) => a.localeCompare(b, "en"));
  const resources = [];
  for (const name of names) {
    const bytes = await readFile(join(outputDirectory, name));
    resources.push({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return resources;
}

const sampler = startProcessTreeSampler({
  intervalMilliseconds: protocol.peakProcessMemory.intervalMilliseconds,
});

async function runSample(phase, index, extraArguments = []) {
  const label = `${phase}#${index}`;
  const outputDirectory = join(workingRoot, "sample");
  const resultPath = join(workingRoot, "sample-result.json");
  await rm(outputDirectory, { recursive: true, force: true });
  await rm(resultPath, { force: true });
  console.log(`[sixty5-cache] ${label} ...`);
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/lib/ifc-cache-sample.mjs"),
      "--config", configPath,
      "--result", resultPath,
      "--output", relative(repositoryRoot, outputDirectory).replaceAll("\\", "/"),
      "--phase", phase,
      ...extraArguments,
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
  );
  const observation = sampler.observe(child.pid);
  const exitCode = await new Promise((settle) => child.on("exit", (code) => settle(code ?? -1)));
  const processMilliseconds = Number((performance.now() - startedAt).toFixed(1));
  const memory = observation.close();
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  const resources = exitCode === 0 ? await identifyOutput(outputDirectory) : undefined;
  // The adapter report is the one file whose content legitimately differs
  // between states, so it is compared with its cache result set aside rather
  // than by digest.
  let adapterReportCore;
  if (exitCode === 0) {
    const adapterReport = JSON.parse(
      await readFile(join(outputDirectory, "adapter-report.json"), "utf8"),
    );
    delete adapterReport[excludedReportField];
    adapterReportCore = JSON.stringify(adapterReport);
  }
  await rm(outputDirectory, { recursive: true, force: true });
  console.log(
    `[sixty5-cache] ${label}: ${result.cache?.status ?? "failed"} in ` +
      `${(processMilliseconds / 1000).toFixed(1)} s, peak tree ` +
      `${((memory.peakWorkingSetBytes ?? 0) / 1e9).toFixed(2)} GB`,
  );
  return { exitCode, processMilliseconds, memory, resources, adapterReportCore, ...result };
}

const expectedCacheStatus = { cold: "miss", warm: "hit", "corrupt-entry": "miss" };

/** Rejects a sample that did not measure the state it was taken for. */
function sampleRejection(phase, sample) {
  if (sample.exitCode !== 0) return `the compile failed: ${sample.failure?.message ?? "unknown"}`;
  if (sample.cache?.status !== expectedCacheStatus[phase]) {
    return `cache status ${sample.cache?.status} is not ${expectedCacheStatus[phase]}`;
  }
  if (phase === "corrupt-entry" && !sample.warnings.some((line) => line.includes("cache restore failed"))) {
    return "the run did not report a failed restore";
  }
  if (sample.memory.peakWorkingSetBytes === null) {
    return "no process-tree memory sample covered the run";
  }
  return undefined;
}

async function corruptEntryResource(key, resourcePath) {
  const target = join(cacheDirectory, key, resourcePath);
  const bytes = await readFile(target);
  assert(bytes.byteLength > 0, `${resourcePath} in the cache entry is empty.`);
  bytes[0] ^= 0xff;
  await writeFile(target, bytes);
}

const retained = { cold: [], warm: [], "corrupt-entry": [] };
const discarded = [];
const maximumAttempts = 3;

async function takeSample(phase, index, prepare) {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await prepare();
    const sample = await runSample(phase, index);
    const rejection = sampleRejection(phase, sample);
    if (!rejection) return sample;
    console.warn(`[sixty5-cache] discarded ${phase}#${index} attempt ${attempt}: ${rejection}`);
    discarded.push({ phase, index, attempt, reason: rejection });
  }
  throw new TypeError(`${phase} sample ${index} never produced a valid run.`);
}

// Taken first, from an empty cache, so the record states in measured terms how
// the compiler's default glTF formatting behaves on a document larger than the
// runtime's maximum string length.
await rm(cacheDirectory, { recursive: true, force: true });
const probe = await runSample("default-formatting-probe", 1, ["--pretty"]);
const defaultFormattingProbe = {
  compactJson: false,
  outcome: probe.exitCode === 0 ? "compiled" : "failed",
  compileMilliseconds: probe.compileMilliseconds,
  processMilliseconds: probe.processMilliseconds,
  peakWorkingSetBytes: probe.memory.peakWorkingSetBytes,
  // The point of the probe: a pretty-printed document this size cannot exist
  // as one JavaScript string, so both numbers are recorded side by side.
  documentBytes: probe.resources?.find(({ path }) => path === "scene.gltf")?.bytes ?? null,
  maximumStringLength: constants.MAX_STRING_LENGTH,
  packageDigest: probe.report?.output?.packageDigest ?? null,
  failure: probe.failure ?? null,
  note: "One run of the same federation with the compiler's default pretty-printed glTF document, taken before the samples. The document is written as a stream rather than built as one string (ADR-0016), so a result larger than the runtime's maximum string length is expected to compile; a host where it still fails would record outcome: failed with the RangeError.",
};

let cacheKey;
for (let index = 1; index <= samplesPerState; index += 1) {
  const cold = await takeSample("cold", index, () =>
    rm(cacheDirectory, { recursive: true, force: true }),
  );
  cacheKey ??= cold.cache.key;
  assert(cold.cache.key === cacheKey, `Cold sample ${index} resolved a different cache key.`);
  retained.cold.push(cold);

  const warm = await takeSample("warm", index, async () => {});
  assert(warm.cache.key === cacheKey, `Warm sample ${index} resolved a different cache key.`);
  retained.warm.push(warm);

  const corrupted = await takeSample("corrupt-entry", index, () =>
    corruptEntryResource(cacheKey, "scene.gltf"),
  );
  assert(
    corrupted.cache.key === cacheKey,
    `Corrupt-entry sample ${index} resolved a different cache key.`,
  );
  retained["corrupt-entry"].push(corrupted);
}
sampler.stop();

function sorted(values) {
  return [...values].sort((left, right) => left - right);
}

function median(values) {
  const order = sorted(values);
  const middle = Math.floor(order.length / 2);
  return order.length % 2 === 1
    ? order[middle]
    : Number(((order[middle - 1] + order[middle]) / 2).toFixed(1));
}

/** Nearest-rank observed p95: an order statistic of the samples, not an estimate. */
function nearestRankP95(values) {
  const order = sorted(values);
  return order[Math.ceil(0.95 * order.length) - 1];
}

/** Compares one sample's files with the clean baseline's, field by field. */
function identityFailures(baseline, sample) {
  const failures = [];
  const byPath = new Map(baseline.resources.map((resource) => [resource.path, resource]));
  if (sample.resources.length !== baseline.resources.length) {
    failures.push(`wrote ${sample.resources.length} files, the baseline wrote ${baseline.resources.length}`);
  }
  for (const resource of sample.resources) {
    const expected = byPath.get(resource.path);
    if (!expected) {
      failures.push(`wrote ${resource.path}, which the baseline did not`);
      continue;
    }
    if (resource.path === "adapter-report.json") continue;
    if (resource.bytes !== expected.bytes || resource.sha256 !== expected.sha256) {
      failures.push(`${resource.path} is not byte-identical to the baseline`);
    }
  }
  if (sample.report.output.packageDigest !== baseline.report.output.packageDigest) {
    failures.push("package digest differs from the baseline");
  }
  if (JSON.stringify(sample.report) !== JSON.stringify(baseline.report)) {
    failures.push("the build report differs from the baseline");
  }
  if (sample.adapterReportCore !== baseline.adapterReportCore) {
    failures.push(`the adapter report differs from the baseline outside ${excludedReportField}`);
  }
  return failures;
}

const baseline = retained.cold[0];
const comparisons = [];
for (const [phase, samples] of Object.entries(retained)) {
  for (const [at, sample] of samples.entries()) {
    if (sample === baseline) continue;
    comparisons.push({ phase, index: at + 1, failures: identityFailures(baseline, sample) });
  }
}

function distribution(values) {
  return {
    values,
    median: median(values),
    p95: nearestRankP95(values),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

function summarize(phase) {
  const samples = retained[phase];
  return {
    samples: samples.length,
    compileMilliseconds: distribution(samples.map((sample) => sample.compileMilliseconds)),
    processMilliseconds: distribution(samples.map((sample) => sample.processMilliseconds)),
    peakProcessTreeWorkingSetBytes: distribution(
      samples.map((sample) => sample.memory.peakWorkingSetBytes),
    ),
    // Charges peaks that never coincided, so it can only be too high.
    summedPeakWorkingSetUpperBoundBytes: distribution(
      samples.map((sample) => sample.memory.osPeakWorkingSetBytes),
    ),
    runs: samples.map((sample, at) => ({
      index: at + 1,
      compileMilliseconds: sample.compileMilliseconds,
      processMilliseconds: sample.processMilliseconds,
      cacheStatus: sample.cache.status,
      peakWorkingSetBytes: sample.memory.peakWorkingSetBytes,
      peakPrivateBytes: sample.memory.peakPrivateBytes,
      osPeakWorkingSetBytes: sample.memory.osPeakWorkingSetBytes,
      memorySamples: sample.memory.treeSamples,
      maxProcessCount: sample.memory.maxProcessCount,
      documentArtifactCache: sample.documentArtifactCache,
      warnings: sample.warnings,
    })),
  };
}

const states = {
  cold: summarize("cold"),
  warm: summarize("warm"),
  "corrupt-entry": summarize("corrupt-entry"),
};

const unchangedReopen = {
  target: protocol.unchangedReopenTargetMs,
  compileMedianMs: states.warm.compileMilliseconds.median,
  compileP95Ms: states.warm.compileMilliseconds.p95,
  wholeProcessMedianMs: states.warm.processMilliseconds.median,
  wholeProcessP95Ms: states.warm.processMilliseconds.p95,
  meetsCompile: states.warm.compileMilliseconds.p95 <= protocol.unchangedReopenTargetMs.maximum,
  meetsWholeProcess:
    states.warm.processMilliseconds.p95 <= protocol.unchangedReopenTargetMs.maximum,
  note: "Measured against the upper bound of the target; a warm reopen faster than the lower bound passes. meetsWholeProcess includes node startup and module loading, which a user reopening a model also pays.",
};

const committedRecord = JSON.parse(
  await readFile(resolve(repositoryRoot, "artifacts/ifc/sixty5/build-report.json"), "utf8"),
);
const committedComparison = {
  record: "artifacts/ifc/sixty5",
  packageDigest: committedRecord.output.packageDigest,
  reproduced: committedRecord.output.packageDigest === baseline.report.output.packageDigest,
  note: "The committed sixty5 package predates explicit IFC boundary edges (PR #42), which the compiler now emits by default, so the digests are expected to differ. This record pins what current main compiles on this host; it does not retarget the committed record.",
};

const evidence = {
  schemaVersion: "naru.sixty5-cache-evidence.1",
  mode: "fresh-process-cache-state-distributions",
  recordedAt: new Date().toISOString(),
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
    datasetId,
    manifest: {
      path: "fixtures/external/manifest.json",
      sha256: sha256(manifestBytes),
    },
    license: dataset.license,
    documents: sourceIdentities,
  },
  adapter: adapterIdentity,
  compileOptions: {
    threads,
    cacheDirectory: relative(repositoryRoot, cacheDirectory).replaceAll("\\", "/"),
    pythonExecutable: ifcPython,
  },
  protocol,
  states,
  packageIdentity: {
    baseline: { state: "cold", index: 1 },
    packageDigest: baseline.report.output.packageDigest,
    resources: baseline.resources,
    buildReportResources: baseline.report.output.resources,
    comparisons,
    identical: comparisons.every(({ failures }) => failures.length === 0),
  },
  unchangedReopen,
  defaultFormattingProbe,
  committedRecordComparison: committedComparison,
  discardedSamples: discarded,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  resolve(artifactDirectory, "sixty5-cache-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);

for (const state of protocol.states) {
  const summary = states[state];
  console.log(
    `[sixty5-cache] ${state}: median ${(summary.compileMilliseconds.median / 1000).toFixed(1)} s ` +
      `(p95 ${(summary.compileMilliseconds.p95 / 1000).toFixed(1)} s), peak tree ` +
      `${(summary.peakProcessTreeWorkingSetBytes.median / 1e9).toFixed(2)} GB over ` +
      `${summary.samples} samples`,
  );
}
console.log(
  `[sixty5-cache] unchanged reopen ${unchangedReopen.compileMedianMs} ms compile / ` +
    `${unchangedReopen.wholeProcessMedianMs} ms process: target ` +
    `${unchangedReopen.meetsWholeProcess ? "met" : "NOT met"}`,
);
console.log(
  `[sixty5-cache] package ${baseline.report.output.packageDigest.slice(0, 12)}, identity ` +
    `${evidence.packageIdentity.identical ? "holds" : "BROKEN"} over ` +
    `${comparisons.length} comparisons, ${discarded.length} discarded samples`,
);
