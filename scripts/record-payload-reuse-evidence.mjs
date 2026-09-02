/**
 * Records the ADR-0018 acceptance evidence for one IFC federation: a
 * changed-discipline rebuild through the content-addressed compiled payload
 * store must reproduce the clean compile byte for byte, must report exactly the
 * ownership decisions the change implies, and must measurably save more time
 * than the store costs without raising peak memory (issue #71).
 *
 * Every sample is a fresh node process (scripts/lib/ifc-cache-sample.mjs). The
 * compiled-package cache and the adapter's document artifact cache share one
 * `--cache` directory; the recorder evicts the package entry before each
 * store-enabled sample so extraction stays warm while packaging has to run.
 *
 *   node scripts/record-payload-reuse-evidence.mjs --model digital-hub
 *   node scripts/record-payload-reuse-evidence.mjs --model sixty5 --samples 3
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  processTreeSampleMethod,
  startProcessTreeSampler,
} from "./lib/process-tree-sampler.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[payload-reuse] ${message}`);
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

/**
 * One deterministic geometric edit per model: the extrusion depth of one
 * IfcExtrudedAreaSolid that exactly one shape representation references, so
 * exactly one prototype's payload changes and every other payload survives.
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
    defaultSamples: 5,
    extendedScenarios: true,
    edit: {
      discipline: "architecture",
      entity: "#823= IFCEXTRUDEDAREASOLID(#817,#822,#20,7.77);",
      replacement: "#823= IFCEXTRUDEDAREASOLID(#817,#822,#20,9.77);",
      description: "Extrusion depth 7.77 -> 9.77 of #823, referenced only by #824 (IfcShapeRepresentation 'Body').",
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
    defaultSamples: 3,
    extendedScenarios: false,
    edit: {
      discipline: "structure",
      entity: "#890= IFCEXTRUDEDAREASOLID(#886,#889,#19,250.);",
      replacement: "#890= IFCEXTRUDEDAREASOLID(#886,#889,#19,350.);",
      description: "Extrusion depth 250 -> 350 of #890, referenced only by #891 (IfcShapeRepresentation 'Body').",
    },
  },
};

const modelId = argumentValue("--model", "digital-hub");
const model = models[modelId];
assert(model, `--model must be one of ${Object.keys(models).join(", ")}.`);
const sampleCount = Number(argumentValue("--samples", String(model.defaultSamples)));
assert(Number.isSafeInteger(sampleCount) && sampleCount >= 1, "--samples must be a positive integer.");
const threads = Number(argumentValue("--threads", "6"));
assert(Number.isSafeInteger(threads) && threads >= 1, "--threads must be a positive integer.");
const artifactDirectory = resolve(
  repositoryRoot,
  argumentValue("--output", "artifacts/cache/payload-reuse"),
);
const workingRoot = resolve(repositoryRoot, "output/payload-reuse", modelId);
const cacheDirectory = join(workingRoot, "cache");
const storeDirectory = join(workingRoot, "store");
const changedDirectory = join(workingRoot, "changed");
const payloadEntrySchema = "naru.compiled-payload-entry.1";
const excludedReportFields = [
  "adapter-report.json:documentArtifactCache",
  "build-report.json:compiledPayloadCache",
];

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

// The changed document: one extrusion depth edited in a copy under output/,
// written byte for byte otherwise (line endings included).
const changedDocument = documents.find(({ discipline }) => discipline === model.edit.discipline);
assert(changedDocument, "The edited discipline is not part of the federation.");
await mkdir(changedDirectory, { recursive: true });
const originalText = (await readFile(resolve(repositoryRoot, changedDocument.sourcePath))).toString("latin1");
assert(
  originalText.split(model.edit.entity).length === 2,
  `${changedDocument.fileName} must contain the edited entity exactly once.`,
);
const changedText = originalText.replace(model.edit.entity, model.edit.replacement);
const changedBytes = Buffer.from(changedText, "latin1");
const changedPath = join(changedDirectory, changedDocument.fileName);
await writeFile(changedPath, changedBytes);
const changedIdentity = {
  discipline: changedDocument.discipline,
  fileName: changedDocument.fileName,
  uriHint: changedDocument.uriHint,
  edit: model.edit,
  originalBytes: sourceIdentities.find((s) => s.discipline === changedDocument.discipline).bytes,
  originalSha256: sourceIdentities.find((s) => s.discipline === changedDocument.discipline).sha256,
  changedBytes: changedBytes.byteLength,
  changedSha256: sha256(changedBytes),
};

const ifcPython =
  process.env.NARU_IFC_PYTHON ??
  process.env.NARU_PYTHON ??
  (process.platform === "win32" ? "python" : "python3");
const adapterScript = resolve(repositoryRoot, "native/adapter-ifc/tools/extract_federation_scene_ir.py");
const adapterProbe = spawnSync(ifcPython, [adapterScript, "--identity"], { encoding: "utf8", windowsHide: true });
assert(adapterProbe.status === 0, `IFC adapter --identity failed: ${adapterProbe.stderr}`);
const adapterIdentity = JSON.parse(adapterProbe.stdout);

function gitOutput(...args) {
  const probe = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  assert(probe.status === 0, `git ${args.join(" ")} failed: ${probe.stderr}`);
  return probe.stdout.trim();
}

/** Writes a sample config for one document set, with or without the store. */
async function writeConfig(name, { documentSet, store, relabel, drop }) {
  const configPath = join(workingRoot, `config-${name}.json`);
  const selected = documents
    .filter(({ discipline }) => discipline !== drop)
    .map((document) => ({
      discipline: document.discipline,
      sourcePath:
        documentSet === "changed" && document.discipline === changedDocument.discipline
          ? portable(changedPath)
          : document.sourcePath,
      uriHint:
        relabel && document.discipline === changedDocument.discipline
          ? `${model.uriPrefix}/relabelled/${document.fileName}`
          : document.uriHint,
    }));
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        cacheDirectory: portable(cacheDirectory),
        ...(store ? { payloadCacheDirectory: portable(storeDirectory) } : {}),
        threads,
        compactJson: model.compactJson,
        spatialIndex: true,
        relocateHierarchyNodes: true,
        pythonExecutable: ifcPython,
        documents: selected,
      },
      null,
      2,
    )}\n`,
  );
  return { path: configPath, documents: selected };
}

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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const sampler = startProcessTreeSampler({ intervalMilliseconds: 500 });

/** Runs one fresh-process sample and returns everything worth keeping about it. */
async function runSample(phase, index, configPath, extraArguments = []) {
  const label = `${phase}#${index}`;
  const outputDirectory = join(workingRoot, "sample");
  const resultPath = join(workingRoot, "sample-result.json");
  await rm(outputDirectory, { recursive: true, force: true });
  await rm(resultPath, { force: true });
  await mkdir(outputDirectory, { recursive: true });
  console.log(`[payload-reuse] ${label} ...`);
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/lib/ifc-cache-sample.mjs"),
      "--config", configPath,
      "--result", resultPath,
      "--output", portable(outputDirectory),
      "--phase", phase,
      ...extraArguments,
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
  );
  const observation = sampler.observe(child.pid);
  const exitCode = await new Promise((settle) => child.on("exit", (code) => settle(code ?? -1)));
  const processMilliseconds = Number((performance.now() - startedAt).toFixed(1));
  const memory = observation.close();
  const result = await readJson(resultPath);
  let resources;
  let reportCores;
  let dependencyIndex;
  if (exitCode === 0 && !result.adapterOnly) {
    resources = await identifyOutput(outputDirectory);
    const adapterReport = await readJson(join(outputDirectory, "adapter-report.json"));
    delete adapterReport.documentArtifactCache;
    const buildReport = await readJson(join(outputDirectory, "build-report.json"));
    delete buildReport.compiledPayloadCache;
    reportCores = {
      "adapter-report.json": JSON.stringify(adapterReport),
      "build-report.json": JSON.stringify(buildReport),
    };
    dependencyIndex = await readJson(join(outputDirectory, "incremental-dependencies.json"));
  }
  await rm(outputDirectory, { recursive: true, force: true });
  console.log(
    `[payload-reuse] ${label}: exit ${exitCode}, ${(processMilliseconds / 1000).toFixed(1)} s, ` +
      `peak tree ${(memory.peakWorkingSetBytes / 1e9).toFixed(2)} GB` +
      (result.report?.compiledPayloadCache
        ? `, payload hits ${result.report.compiledPayloadCache.hits}/${result.report.compiledPayloadCache.prototypes}`
        : ""),
  );
  return { phase, index, exitCode, processMilliseconds, memory, resources, reportCores, dependencyIndex, ...result };
}

/** Removes the compiled-package entry, leaving the adapter document artifacts. */
async function evictPackageEntry(key) {
  if (key) await rm(join(cacheDirectory, key), { recursive: true, force: true });
}

async function listDirectories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const documentArtifactDirectory = join(cacheDirectory, "ifc-documents");
const storeNamespace = join(storeDirectory, payloadEntrySchema);

/** Entry count and byte footprint of the store namespace. */
async function storeFootprint() {
  const entries = await listDirectories(storeNamespace);
  let bytes = 0;
  for (const entry of entries) {
    for (const name of await readdir(join(storeNamespace, entry))) {
      bytes += (await stat(join(storeNamespace, entry, name))).size;
    }
  }
  return { entries: entries.length, bytes };
}

/** Compares a sample against an oracle: every file by digest, the two reports semantically. */
function identityFailures(oracle, sample) {
  const failures = [];
  if (oracle.report.output.packageDigest !== sample.report.output.packageDigest) {
    failures.push(`packageDigest ${oracle.report.output.packageDigest} != ${sample.report.output.packageDigest}`);
  }
  const oracleNames = oracle.resources.map(({ path }) => path).join(",");
  const sampleNames = sample.resources.map(({ path }) => path).join(",");
  if (oracleNames !== sampleNames) failures.push(`resource set ${oracleNames} != ${sampleNames}`);
  for (const resource of oracle.resources) {
    if (resource.path in oracle.reportCores) continue;
    const other = sample.resources.find(({ path }) => path === resource.path);
    if (!other) continue;
    if (other.sha256 !== resource.sha256 || other.bytes !== resource.bytes) {
      failures.push(`${resource.path} ${resource.sha256} (${resource.bytes} B) != ${other.sha256} (${other.bytes} B)`);
    }
  }
  for (const name of Object.keys(oracle.reportCores)) {
    if (oracle.reportCores[name] !== sample.reportCores[name]) failures.push(`${name} differs outside the excluded field`);
  }
  if (JSON.stringify(oracle.report.output.resources) !== JSON.stringify(sample.report.output.resources)) {
    failures.push("build-report output.resources differ");
  }
  return failures;
}

async function listNames(directory) {
  try {
    return (await readdir(directory)).sort((a, b) => a.localeCompare(b, "en"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const scenarios = [];
const oracles = {};
const comparisons = [];

function describeDocuments(config) {
  return config.documents.map(({ discipline, uriHint, sourcePath }) => ({
    discipline,
    uriHint,
    source: sourcePath === portable(changedPath) ? "changed" : "original",
  }));
}

function payloadReport(sample) {
  return sample.report.compiledPayloadCache ?? null;
}

/** One fresh-process scenario, checked against its expectations and its oracle. */
async function scenario(name, config, { oracle, expect = () => [], asOracle = false }) {
  const sample = await runSample(name, 1, config.path);
  assert(sample.exitCode === 0, `${name} failed: ${sample.failure?.message ?? "unknown"}`);
  const failures = [];
  if (sample.cache.status !== "miss") failures.push(`package cache status ${sample.cache.status}, expected miss`);
  if (oracle) {
    const identity = identityFailures(oracles[oracle], sample);
    comparisons.push({ scenario: name, oracle, failures: identity });
    failures.push(...identity);
  }
  failures.push(...expect(sample));
  if (asOracle) oracles[name] = sample;
  const payload = payloadReport(sample);
  scenarios.push({
    name,
    documents: describeDocuments(config),
    payloadStore: Boolean(payload),
    oracle: oracle ?? null,
    packageCacheKey: sample.cache.key,
    packageCacheStatus: sample.cache.status,
    documentArtifactCache: sample.documentArtifactCache,
    payloadCache: payload,
    warnings: sample.warnings,
    compileMilliseconds: sample.compileMilliseconds,
    processMilliseconds: sample.processMilliseconds,
    peakWorkingSetBytes: sample.memory.peakWorkingSetBytes,
    packageDigest: sample.report.output.packageDigest,
    resources: sample.resources,
    failures,
    met: failures.length === 0,
  });
  console.log(`[payload-reuse] ${name}: ${failures.length === 0 ? "met" : `NOT met (${failures.join("; ")})`}`);
  return sample;
}

function expectPayload(rules) {
  return (sample) => {
    const payload = payloadReport(sample);
    if (!payload) return ["build-report.json carries no compiledPayloadCache"];
    const failures = [];
    const { outcomes } = payload;
    const check = (condition, message) => {
      if (!condition) failures.push(message);
    };
    check(payload.hits + payload.misses === payload.prototypes, `hits ${payload.hits} + misses ${payload.misses} != prototypes ${payload.prototypes}`);
    check(payload.misses === outcomes.absent + outcomes["corrupt-entry"] + outcomes["restore-failed"], "misses do not sum the degraded outcomes");
    if (rules.allHits) check(payload.hits === payload.prototypes && payload.published === 0, `expected every prototype restored, got ${payload.hits}/${payload.prototypes}, published ${payload.published}`);
    if (rules.noneRestoredBefore) check(payload.hits + outcomes.absent === payload.prototypes && payload.published === outcomes.absent, `cold store: hits ${payload.hits}, absent ${outcomes.absent}, published ${payload.published}`);
    if (rules.someMisses) check(payload.misses >= 1 && payload.hits >= 1 && payload.published === payload.misses, `changed rebuild: hits ${payload.hits}, misses ${payload.misses}, published ${payload.published}`);
    if (rules.maximumMisses !== undefined) check(payload.misses <= rules.maximumMisses, `misses ${payload.misses} exceed the ${rules.maximumMisses} prototypes the changed document owns`);
    if (rules.corrupt) {
      check(outcomes["corrupt-entry"] >= 1, "no corrupt-entry outcome");
      check(payload.publishFailures >= 1, "republish over the corrupt entry was not refused");
      check(sample.warnings.some((w) => w.includes("payload cache restore failed")), "no restore warning");
      check(sample.warnings.some((w) => w.includes("payload cache publish failed")), "no publish warning");
    } else {
      check(outcomes["corrupt-entry"] === 0 && outcomes["restore-failed"] === 0 && payload.publishFailures === 0, "unexpected degraded outcome");
      check(sample.warnings.length === 0, `unexpected warnings: ${sample.warnings.join(" | ")}`);
    }
    return failures;
  };
}

function expectNoStore(sample) {
  return payloadReport(sample) ? ["a clean compile must not report compiledPayloadCache"] : [];
}

// ---------------------------------------------------------------------------
// Scenarios: byte identity and ownership decisions, one fresh process each.
// ---------------------------------------------------------------------------
await rm(cacheDirectory, { recursive: true, force: true });
await rm(storeDirectory, { recursive: true, force: true });
await mkdir(workingRoot, { recursive: true });

const originalClean = await writeConfig("original-clean", { documentSet: "original", store: false });
const originalStore = await writeConfig("original-store", { documentSet: "original", store: true });
const changedClean = await writeConfig("changed-clean", { documentSet: "changed", store: false });
const changedStore = await writeConfig("changed-store", { documentSet: "changed", store: true });

const cleanOriginal = await scenario("clean-original", originalClean, { asOracle: true, expect: expectNoStore });
const originalKey = cleanOriginal.cache.key;
const originalArtifacts = await listNames(documentArtifactDirectory);

await evictPackageEntry(originalKey);
const storeCold = await scenario("store-cold-original", originalStore, {
  oracle: "clean-original",
  expect: expectPayload({ noneRestoredBefore: true }),
});
const footprintAfterOriginal = await storeFootprint();
assert(
  footprintAfterOriginal.entries === payloadReport(storeCold).outcomes.absent,
  `store holds ${footprintAfterOriginal.entries} entries, cold run published ${payloadReport(storeCold).outcomes.absent}`,
);

await evictPackageEntry(originalKey);
await scenario("store-warm-original", originalStore, {
  oracle: "clean-original",
  expect: expectPayload({ allHits: true }),
});

const cleanChanged = await scenario("clean-changed", changedClean, { asOracle: true, expect: expectNoStore });
const changedKey = cleanChanged.cache.key;
assert(changedKey !== originalKey, "the changed document must produce a different package cache key");
const changedArtifacts = (await listNames(documentArtifactDirectory)).filter((n) => !originalArtifacts.includes(n));
assert(changedArtifacts.length === 1, `expected one new document artifact, found ${changedArtifacts.length}`);
const changedArtifactPath = join(documentArtifactDirectory, changedArtifacts[0]);

// What the edit actually changed, so the record can show the change was geometric.
const changeEffect = {
  sceneBinDiffers:
    cleanOriginal.resources.find((r) => r.path === "scene.bin").sha256 !==
    cleanChanged.resources.find((r) => r.path === "scene.bin").sha256,
  packageDigestDiffers: cleanOriginal.report.output.packageDigest !== cleanChanged.report.output.packageDigest,
  resourcesDiffering: cleanOriginal.resources
    .filter((r) => cleanChanged.resources.find((o) => o.path === r.path)?.sha256 !== r.sha256)
    .map((r) => r.path),
};
assert(changeEffect.sceneBinDiffers, "the edit did not change scene.bin; it is not a geometric change");

const ownership = (() => {
  const index = cleanChanged.dependencyIndex;
  const changed = index.documents.find(({ discipline }) => discipline === changedDocument.discipline);
  const others = new Set(index.documents.filter((d) => d !== changed).flatMap((d) => d.prototypeIds));
  const originalIds = new Set(cleanOriginal.dependencyIndex.prototypes.map((p) => p.prototypeId));
  const changedIds = new Set(index.prototypes.map((p) => p.prototypeId));
  return {
    prototypes: index.prototypes.length,
    changedDocumentPrototypes: changed.prototypeIds.length,
    changedDocumentPrototypesSharedWithOtherDocuments: changed.prototypeIds.filter((id) => others.has(id)).length,
    prototypeIdsOnlyInChangedIndex: [...changedIds].filter((id) => !originalIds.has(id)).length,
    prototypeIdsOnlyInOriginalIndex: [...originalIds].filter((id) => !changedIds.has(id)).length,
    reconciledDocumentPairs: index.documents.reduce((n, d) => n + d.reconciledDocumentIds.length, 0),
    changedDocumentPrototypeIdsRetainedFromOriginal: changed.prototypeIds.filter((id) => originalIds.has(id)).length,
    changedDocumentReuse:
      "none by construction: the IFC adapter derives every prototype id from the document token `<discipline>-<sourceDigest[:12]>`, and the payload content digest hashes the representation id because the accessor names it restores embed that id. Editing one entity therefore renames every prototype of that document, so the changed document's untouched geometry is rebuilt and republished while only the other documents' payloads are restored.",
  };
})();

await evictPackageEntry(changedKey);
const storeEntriesBeforeChanged = await listNames(storeNamespace);
const storeWarmChanged = await scenario("store-warm-changed", changedStore, {
  oracle: "clean-changed",
  expect: expectPayload({ someMisses: true, maximumMisses: ownership.changedDocumentPrototypes }),
});
const changedPayload = payloadReport(storeWarmChanged);
const footprintAfterChanged = await storeFootprint();
const publishedEntries = (await listNames(storeNamespace)).filter((n) => !storeEntriesBeforeChanged.includes(n));
assert(publishedEntries.length === changedPayload.published, `store grew by ${publishedEntries.length}, run published ${changedPayload.published}`);

// Corrupt the entry the changed rebuild just published, then rebuild again.
const corruptEntryPath = join(storeNamespace, publishedEntries[0], "payload.bin");
const intactEntryBytes = await readFile(corruptEntryPath);
const corruptedBytes = Buffer.from(intactEntryBytes);
corruptedBytes[0] ^= 0xff;
await writeFile(corruptEntryPath, corruptedBytes);
await evictPackageEntry(changedKey);
await scenario("store-corrupt-entry-changed", changedStore, {
  oracle: "clean-changed",
  expect: expectPayload({ corrupt: true }),
});
await writeFile(corruptEntryPath, intactEntryBytes);
const corruptedEntry = { entry: publishedEntries[0], flippedByte: 0, restoredAfterwards: true };

// ---------------------------------------------------------------------------
// Gate 4: packaging time and peak memory of the changed-discipline rebuild,
// clean versus store-warm, in the same warm-extraction state.
// ---------------------------------------------------------------------------
const discarded = [];
const timing = { extraction: [], clean: [], warm: [] };

async function prepareChangedRebuildState() {
  await rm(changedArtifactPath, { force: true });
  await evictPackageEntry(changedKey);
  // The store keeps every payload of the unchanged documents and none of the
  // changed one, which is the state a user has right after editing a document.
  for (const entry of publishedEntries) await rm(join(storeNamespace, entry), { recursive: true, force: true });
}

async function timingSample(kind, index) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await prepareChangedRebuildState();
    const sample =
      kind === "extraction"
        ? await runSample("extraction-changed", index, changedStore.path, ["--adapter-only"])
        : await runSample(kind === "clean" ? "clean-changed" : "store-warm-changed", index, kind === "clean" ? changedClean.path : changedStore.path);
    const reasons = [];
    if (sample.exitCode !== 0) reasons.push(`exit ${sample.exitCode}: ${sample.failure?.message ?? "unknown"}`);
    else {
      const artifacts = sample.documentArtifactCache;
      if (!artifacts || artifacts.misses.length !== 1 || artifacts.misses[0] !== changedDocument.discipline) reasons.push("the changed document was not the single artifact miss");
      if (kind !== "extraction") {
        if (sample.cache.status !== "miss") reasons.push(`package cache status ${sample.cache.status}`);
        const identity = identityFailures(oracles["clean-changed"], sample);
        comparisons.push({ scenario: `${kind === "clean" ? "clean-changed" : "store-warm-changed"}#${index}`, oracle: "clean-changed", failures: identity });
        reasons.push(...identity);
      }
      if (kind === "warm") {
        const payload = payloadReport(sample);
        if (!payload || payload.hits !== changedPayload.hits || payload.misses !== changedPayload.misses || payload.published !== changedPayload.published) {
          reasons.push(`payload decisions ${JSON.stringify(payload && { hits: payload.hits, misses: payload.misses, published: payload.published })} differ from the pinned ${JSON.stringify({ hits: changedPayload.hits, misses: changedPayload.misses, published: changedPayload.published })}`);
        }
        if (sample.warnings.length > 0) reasons.push(`warnings: ${sample.warnings.join(" | ")}`);
      }
    }
    if (reasons.length === 0) {
      timing[kind].push(sample);
      return;
    }
    discarded.push({ kind, index, attempt, reasons });
    console.warn(`[payload-reuse] discarded ${kind}#${index} attempt ${attempt}: ${reasons.join("; ")}`);
  }
  throw new TypeError(`[payload-reuse] ${kind}#${index} failed three attempts.`);
}

for (let index = 1; index <= sampleCount; index += 1) {
  await timingSample("clean", index);
  await timingSample("warm", index);
  await timingSample("extraction", index);
}

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

const extraction = {
  samples: timing.extraction.length,
  adapterMilliseconds: distribution(timing.extraction.map((s) => s.adapterMilliseconds)),
  peakWorkingSetBytes: distribution(timing.extraction.map((s) => s.memory.peakWorkingSetBytes)),
  runs: timing.extraction.map((s) => ({ index: s.index, adapterMilliseconds: s.adapterMilliseconds, peakWorkingSetBytes: s.memory.peakWorkingSetBytes, documentArtifactCache: s.documentArtifactCache })),
};
const extractionMedianMs = extraction.adapterMilliseconds.median;

function summarizeRebuild(samples) {
  return {
    samples: samples.length,
    compileMilliseconds: distribution(samples.map((s) => s.compileMilliseconds)),
    processMilliseconds: distribution(samples.map((s) => s.processMilliseconds)),
    packagingMilliseconds: distribution(samples.map((s) => Number((s.compileMilliseconds - extractionMedianMs).toFixed(1)))),
    peakProcessTreeWorkingSetBytes: distribution(samples.map((s) => s.memory.peakWorkingSetBytes)),
    summedPeakWorkingSetUpperBoundBytes: distribution(samples.map((s) => s.memory.osPeakWorkingSetBytes)),
    runs: samples.map((s) => ({
      index: s.index,
      compileMilliseconds: s.compileMilliseconds,
      processMilliseconds: s.processMilliseconds,
      peakWorkingSetBytes: s.memory.peakWorkingSetBytes,
      peakPrivateBytes: s.memory.peakPrivateBytes,
      osPeakWorkingSetBytes: s.memory.osPeakWorkingSetBytes,
      memorySamples: s.memory.treeSamples,
      maxProcessCount: s.memory.maxProcessCount,
      packageDigest: s.report.output.packageDigest,
      documentArtifactCache: s.documentArtifactCache,
      payloadCache: payloadReport(s),
      warnings: s.warnings,
    })),
  };
}
const cleanRebuild = summarizeRebuild(timing.clean);
const warmRebuild = summarizeRebuild(timing.warm);

const savingMs = cleanRebuild.packagingMilliseconds.median - warmRebuild.packagingMilliseconds.median;
const gate4 = {
  method:
    "packagingMilliseconds = compileMilliseconds - median adapterMilliseconds of the extraction-only samples taken in the same cache state (the compiler reports no stage timing, so packaging is derived by difference). The store-warm sample pays its own restore and publish inside that time, so a lower median already nets the store's cost.",
  criteria: {
    packagingFaster: "median store-warm packagingMilliseconds < median clean packagingMilliseconds",
    peakMemoryNoHigher: "median store-warm peakProcessTreeWorkingSetBytes <= median clean peakProcessTreeWorkingSetBytes",
  },
  extractionMedianMs,
  cleanPackagingMedianMs: cleanRebuild.packagingMilliseconds.median,
  warmPackagingMedianMs: warmRebuild.packagingMilliseconds.median,
  savingMs: Number(savingMs.toFixed(1)),
  savingRatio: Number((cleanRebuild.packagingMilliseconds.median / warmRebuild.packagingMilliseconds.median).toFixed(3)),
  cleanPeakWorkingSetMedianBytes: cleanRebuild.peakProcessTreeWorkingSetBytes.median,
  warmPeakWorkingSetMedianBytes: warmRebuild.peakProcessTreeWorkingSetBytes.median,
  packagingFaster: warmRebuild.packagingMilliseconds.median < cleanRebuild.packagingMilliseconds.median,
  peakMemoryNoHigher:
    warmRebuild.peakProcessTreeWorkingSetBytes.median <= cleanRebuild.peakProcessTreeWorkingSetBytes.median,
};
gate4.met = gate4.packagingFaster && gate4.peakMemoryNoHigher;

// ---------------------------------------------------------------------------
// Extended scenarios (Digital Hub): a relabelled document and a deleted one.
// ---------------------------------------------------------------------------
if (model.extendedScenarios) {
  const relabelledClean = await writeConfig("relabelled-clean", { documentSet: "original", store: false, relabel: true });
  const relabelledStore = await writeConfig("relabelled-store", { documentSet: "original", store: true, relabel: true });
  const relabelled = await scenario("clean-relabelled", relabelledClean, { asOracle: true, expect: expectNoStore });
  await evictPackageEntry(relabelled.cache.key);
  await scenario("store-warm-relabelled", relabelledStore, { oracle: "clean-relabelled", expect: expectPayload({ allHits: true }) });

  const dropped = documents[documents.length - 1].discipline;
  const deletedClean = await writeConfig("deleted-clean", { documentSet: "original", store: false, drop: dropped });
  const deletedStore = await writeConfig("deleted-store", { documentSet: "original", store: true, drop: dropped });
  const deleted = await scenario("clean-deleted", deletedClean, { asOracle: true, expect: expectNoStore });
  await evictPackageEntry(deleted.cache.key);
  await scenario("store-warm-deleted", deletedStore, { oracle: "clean-deleted", expect: expectPayload({ allHits: true }) });
}
sampler.stop();

const protocol = {
  processIsolation: "One fresh node process per sample; the recorder never compiles in-process.",
  cacheState:
    "The compiled-package cache and the adapter document artifact cache share the --cache directory. Before every store-enabled scenario the recorder removes the compiled-package entry for that document set, so extraction stays warm while packaging has to run; a compile that hit the package cache would skip packaging entirely and is rejected.",
  changedDocument:
    "The edited discipline is compiled from a copy under output/ whose bytes differ from the fixture only in the edited entity; its document artifact misses once and is then cached like the others.",
  timingState:
    "Before every timing sample the changed document's artifact, the changed package entry, and the store entries the changed rebuild published are removed, so clean, store-warm, and extraction-only samples all start from exactly one document to extract, a whole package to write, and a store that holds the unchanged documents' payloads only. Samples interleave clean, warm, extraction per iteration.",
  corruptEntry:
    "The first byte of payload.bin in the entry the changed rebuild published is flipped; the intact bytes are written back after the scenario.",
  outputHandling: "Every sample compiles into its own output directory, which is hashed in full and then deleted.",
  failedSampleHandling:
    "A timing sample whose process fails, whose cache state is not the one the protocol requires, whose output differs from the oracle, or whose payload decisions differ from the pinned scenario is recorded in discardedSamples and re-run, at most three attempts. Scenario samples are never re-run: a mismatch is a gate failure and is recorded as such.",
  statistics: {
    median: "The middle value of the sorted retained samples; the mean of the two middle values when the count is even.",
    p95: "Nearest-rank observed p95: the ceil(0.95 * n)-th sorted value, an order statistic of the samples taken.",
  },
  peakProcessMemory: {
    method: processTreeSampleMethod,
    intervalMilliseconds: 500,
    note: "Win32_Process WorkingSetSize summed over the tree rooted at the sample process, so the native adapter is included; the summed per-process PeakWorkingSetSize is reported beside it as an upper bound.",
  },
  reportComparison: {
    byteIdenticalResources: "Every file a sample writes except adapter-report.json and build-report.json, which are compared as JSON with exactly the excluded fields removed.",
    semanticExclusions: excludedReportFields,
  },
  uncontrolled: [
    "The operating system file cache is not cleared between samples.",
    "The sampler runs one PowerShell process for the whole session and is not excluded from the host's load.",
  ],
};

const gates = {
  cleanPackageResourceEquivalence: {
    comparisons: comparisons.length,
    identical: comparisons.every(({ failures }) => failures.length === 0),
    resources: oracles["clean-changed"].resources.map(({ path }) => path),
  },
  semanticReportComparison: {
    exclusions: excludedReportFields,
    met: comparisons.every(({ failures }) => !failures.some((f) => f.includes("differs outside"))) && scenarios.every((s) => s.met),
  },
  ownershipDecisions: {
    met: scenarios.every((s) => s.met),
    changedRebuild: { hits: changedPayload.hits, misses: changedPayload.misses, published: changedPayload.published, outcomes: changedPayload.outcomes },
    ownership,
  },
  measuredSavingExceedsCost: gate4,
};
gates.allMet = gates.cleanPackageResourceEquivalence.identical && gates.semanticReportComparison.met && gates.ownershipDecisions.met && gate4.met && discarded.length === 0;

const evidence = {
  schemaVersion: "naru.payload-reuse-evidence.1",
  mode: "fresh-process-changed-discipline-rebuild",
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
  changeEffect,
  adapter: adapterIdentity,
  compileOptions: {
    threads,
    compactJson: model.compactJson,
    spatialIndex: true,
    relocateHierarchyNodes: true,
    cacheDirectory: portable(cacheDirectory),
    payloadCacheDirectory: portable(storeDirectory),
    payloadEntrySchema,
    // Recorded relative to the repository when it lives there (the local
    // adapter venv), otherwise by name only: the record must not carry a
    // machine path.
    pythonExecutable: isAbsolute(ifcPython) && !relative(repositoryRoot, ifcPython).startsWith("..") ? portable(ifcPython) : basename(ifcPython),
  },
  protocol,
  scenarios,
  oracles: Object.fromEntries(
    Object.entries(oracles).map(([name, sample]) => [
      name,
      { packageDigest: sample.report.output.packageDigest, resources: sample.resources, buildReportResources: sample.report.output.resources },
    ]),
  ),
  comparisons,
  storeFootprint: { afterOriginal: footprintAfterOriginal, afterChanged: footprintAfterChanged, corruptedEntry },
  extraction,
  cleanRebuild,
  warmRebuild,
  gates,
  discardedSamples: discarded,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(resolve(artifactDirectory, `${modelId}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
for (const s of scenarios) console.log(`[payload-reuse] ${s.name}: ${s.met ? "met" : "NOT MET"}${s.payloadCache ? ` (hits ${s.payloadCache.hits}, misses ${s.payloadCache.misses}, published ${s.payloadCache.published})` : ""}`);
console.log(
  `[payload-reuse] gate 4: extraction ${(extractionMedianMs / 1000).toFixed(1)} s; packaging clean ${(gate4.cleanPackagingMedianMs / 1000).toFixed(1)} s vs warm ${(gate4.warmPackagingMedianMs / 1000).toFixed(1)} s (${gate4.savingRatio}x); ` +
    `peak ${(gate4.cleanPeakWorkingSetMedianBytes / 1e9).toFixed(2)} vs ${(gate4.warmPeakWorkingSetMedianBytes / 1e9).toFixed(2)} GB -> ${gate4.met ? "met" : "NOT met"}`,
);
console.log(`[payload-reuse] all gates ${gates.allMet ? "met" : "NOT met"}; ${discarded.length} discarded; wrote ${portable(resolve(artifactDirectory, `${modelId}.json`))}`);
