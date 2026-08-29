// Records what ADR-0017's relocated assembly-tree sidecar does to a real-large
// federation in a browser: the gate the ADR left open. Two packages compiled
// from the same split differ in one thing only -- whether the mesh-less nodes
// live in `scene.gltf` or in `hierarchy.json` + `hierarchy.bin` -- and every
// other resource is byte-identical between them, so a difference measured here
// is relocation and nothing else.
//
// Each sample is a fresh process, a fresh Vite server, and a fresh headed
// Chrome, driven by the committed first-frame recorder rather than a second
// copy of its instrumentation. Arms are interleaved so host drift cannot
// accumulate against one of them.
//
//   pnpm hierarchy:browser:evidence
//   node scripts/record-relocated-hierarchy-browser-evidence.mjs \
//     [--runs 3] [--in-place-scene-dir output/ifc/sixty5-prb] \
//     [--relocated-scene-dir output/ifc/sixty5-relocated] \
//     [--output artifacts/ifc/relocated-hierarchy-browser]
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function argument(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const runsPerArm = Number(argument("--runs", "3"));
if (!Number.isInteger(runsPerArm) || runsPerArm < 1 || runsPerArm > 9) {
  throw new TypeError("--runs must be between 1 and 9.");
}
const outputDirectory = resolve(
  repositoryRoot,
  argument("--output", "artifacts/ifc/relocated-hierarchy-browser"),
);
const workDirectory = resolve(
  repositoryRoot,
  argument("--work", "output/relocated-hierarchy-browser"),
);

/** Repository-relative, forward-slashed, so a record reads the same anywhere. */
const fromRoot = (path) => relative(repositoryRoot, path).split(sep).join("/");

const ARMS = [
  {
    id: "in-place",
    summary: "assembly tree serialized in scene.gltf, as every committed package is",
    sceneDirectory: resolve(
      repositoryRoot,
      argument("--in-place-scene-dir", "output/ifc/sixty5-prb"),
    ),
    reportPath: resolve(
      repositoryRoot,
      argument("--in-place-report", "artifacts/ifc/sixty5/build-report.json"),
    ),
  },
  {
    id: "relocated",
    summary: "compiled with --relocate-hierarchy-nodes; tree in the package sidecar",
    sceneDirectory: resolve(
      repositoryRoot,
      argument("--relocated-scene-dir", "output/ifc/sixty5-relocated"),
    ),
    reportPath: resolve(
      repositoryRoot,
      argument("--relocated-report", "output/ifc/sixty5-relocated/build-report.json"),
    ),
  },
];

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/** Lower median, so every reported figure is one of the runs. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
}

function sample(arm, index) {
  const runDirectory = resolve(workDirectory, `${arm.id}-${index}`);
  const child = spawnSync(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/record-ifc-browser-evidence.mjs"),
      "--scene-dir",
      arm.sceneDirectory,
      "--report",
      arm.reportPath,
      "--output",
      runDirectory,
    ],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (child.status !== 0) {
    throw new Error(`${arm.id} run ${index} failed with status ${child.status}.`);
  }
  return runDirectory;
}

/**
 * The counters that must not move. Relocation renumbers nodes and takes bytes
 * out of the document; it may not change what is drawn, what is resident, or
 * what the network was asked for. Anything listed here that differs between
 * the two arms is a defect in the option, not a measurement.
 */
const ENDPOINT_KEYS = [
  "snapshot.status",
  "snapshot.prototypeCount",
  "snapshot.occurrenceCount",
  "snapshot.triangleCount",
  "snapshot.edgeCount",
  "snapshot.binarySize",
  "snapshot.geometryResult",
  "snapshot.dataset.targetChunksTotal",
  "snapshot.dataset.targetChunksReady",
  "snapshot.dataset.residentDecodedBytes",
  "snapshot.dataset.residentGpuBytes",
  "snapshot.dataset.residencyBudgetBytes",
  "snapshot.dataset.targetSchedulerRequests",
  "snapshot.dataset.targetSchedulerSkips",
  "snapshot.dataset.visibleOccurrences",
  "picking.occurrenceName",
  "semanticProperties.entryCount",
];

const read = (value, path) => path.split(".").reduce((node, key) => node?.[key], value);

/**
 * A selection reads "Selected <name> - node N - ID N+1 - ...". The name is the
 * part that must survive relocation; the node index deliberately does not,
 * because the document keeps only the nodes that draw.
 */
function splitSelection(selection) {
  const marker = " \u00b7 node ";
  const at = selection.indexOf(marker);
  return at === -1
    ? { occurrenceName: selection, nodeSuffix: null }
    : {
        occurrenceName: selection.slice(0, at),
        nodeSuffix: selection.slice(at + marker.length),
      };
}

/** Requests grouped by resource and status, plus the ranges served on them. */
function requestLedger(responses) {
  const byResource = new Map();
  for (const response of responses) {
    // The page URL carries the scene query string; it is not a package fetch.
    const resource = response.resource.startsWith("?") ? "(page)" : response.resource;
    const key = `${resource} ${response.status}`;
    const entry = byResource.get(key) ?? { resource, status: response.status, count: 0 };
    entry.count += 1;
    byResource.set(key, entry);
  }
  return [...byResource.values()].sort((a, b) => a.resource.localeCompare(b.resource));
}

function summarise(runDirectory, record) {
  const selection = splitSelection(record.picking.selection);
  return {
    runDirectory: fromRoot(runDirectory),
    hierarchyReadyMs: record.milestones.hierarchyReadyMs,
    coarseFrameMs: record.milestones.coarseFrameMs,
    readyMs: record.milestones.readyMs,
    usedJsHeapBytes: record.snapshot.usedJsHeapBytes,
    decodeTime: record.snapshot.decodeTime,
    status: record.snapshot.status,
    targetChunksReady: record.snapshot.dataset.targetChunksReady,
    targetSchedulerRequests: record.snapshot.dataset.targetSchedulerRequests,
    targetSchedulerSkips: record.snapshot.dataset.targetSchedulerSkips,
    residentDecodedBytes: record.snapshot.dataset.residentDecodedBytes,
    residentGpuBytes: record.snapshot.dataset.residentGpuBytes,
    triangleCount: record.snapshot.triangleCount,
    occurrenceName: selection.occurrenceName,
    nodeSuffix: selection.nodeSuffix,
    responses: record.binaryRequests.length,
    sidecarResponseIndex: record.binaryRequests.findIndex(
      (response) => response.resource === "hierarchy.bin",
    ),
    coarseResponseIndex: record.binaryRequests.findIndex(
      (response) => response.resource === "coarse.bin",
    ),
    requestLedger: requestLedger(record.binaryRequests),
    consoleIssues: record.consoleIssues.length,
    budgetLimitedScreenshotSha256: record.screenshots.budgetLimited.sha256,
  };
}

/** The bytes each arm asks a client to hold, straight from its build report. */
function transferLedger(report) {
  const resources = report.output.resources.map((resource) => ({
    path: resource.path,
    bytes: resource.bytes ?? resource.byteLength ?? null,
    sha256: resource.sha256,
  }));
  const named = (path) => resources.find((resource) => resource.path === path)?.bytes ?? 0;
  return {
    packageDigest: report.output.packageDigest,
    packageBytes: resources.reduce((total, resource) => total + (resource.bytes ?? 0), 0),
    documentBytes: named("scene.gltf"),
    hierarchySidecarBytes: named("hierarchy.json") + named("hierarchy.bin"),
    hierarchyNodes: report.options?.hierarchyNodes ?? "in-place",
    resources,
  };
}

await rm(workDirectory, { recursive: true, force: true });
await mkdir(workDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

const arms = new Map(ARMS.map((arm) => [arm.id, { ...arm, samples: [], records: [] }]));
// Interleaved, so a host that slows down over the session slows both arms.
for (let index = 1; index <= runsPerArm; index += 1) {
  for (const arm of arms.values()) {
    console.log(`[relocated-browser] ${arm.id} run ${index} of ${runsPerArm} ...`);
    const runDirectory = sample(arm, index);
    const record = await readJson(resolve(runDirectory, "browser-residency.json"));
    arm.records.push({ runDirectory, record });
    arm.samples.push(summarise(runDirectory, record));
    const last = arm.samples.at(-1);
    console.log(
      `[relocated-browser] ${arm.id} run ${index}: hierarchy ${last.hierarchyReadyMs} ms, ` +
        `coarse ${last.coarseFrameMs} ms, ready ${last.readyMs} ms, ` +
        `heap ${(last.usedJsHeapBytes / 1e9).toFixed(3)} GB`,
    );
  }
}

const everyRecord = [...arms.values()].flatMap((arm) => arm.records.map((entry) => entry.record));
const endpoint = ENDPOINT_KEYS.map((key) => {
  const values = everyRecord.map((record) => {
    if (key === "picking.occurrenceName") return splitSelection(record.picking.selection).occurrenceName;
    return read(record, key);
  });
  const expected = values[0];
  return {
    key,
    value: expected,
    matchedInEveryRun: values.every((value) => value === expected),
  };
});
const endpointHolds = endpoint.every((entry) => entry.matchedInEveryRun);
if (!endpointHolds) {
  const drifted = endpoint.filter((entry) => !entry.matchedInEveryRun).map((entry) => entry.key);
  throw new Error(
    `Relocation changed what the runtime produced: ${drifted.join(", ")}. ` +
      "That is a defect in the option, not a result worth recording.",
  );
}

const ledgers = Object.fromEntries(
  await Promise.all(
    [...arms.values()].map(async (arm) => [arm.id, transferLedger(await readJson(arm.reportPath))]),
  ),
);
/** Everything both arms must carry identically for relocation to be the only variable. */
const SHARED_RESOURCES = ["scene.bin", "coarse.bin", "properties.json", "properties.bin"];
const inPlace = ledgers["in-place"];
const relocated = ledgers.relocated;
for (const resource of SHARED_RESOURCES) {
  const before = inPlace.resources.find((entry) => entry.path === resource);
  const after = relocated.resources.find((entry) => entry.path === resource);
  if (!before || !after || before.sha256 !== after.sha256) {
    throw new Error(
      `${resource} differs between the arms; relocation is then not the only variable.`,
    );
  }
}

const summariseArm = (arm) => {
  const of = (field) => arm.samples.map((entry) => entry[field]);
  return {
    id: arm.id,
    summary: arm.summary,
    sceneDirectory: fromRoot(arm.sceneDirectory),
    buildReport: fromRoot(arm.reportPath),
    samples: arm.samples,
    medians: {
      hierarchyReadyMs: median(of("hierarchyReadyMs")),
      coarseFrameMs: median(of("coarseFrameMs")),
      readyMs: median(of("readyMs")),
      usedJsHeapBytes: median(of("usedJsHeapBytes")),
    },
  };
};
const armRecords = [...arms.values()].map(summariseArm);
const [inPlaceArm, relocatedArm] = armRecords;

const delta = (field) => ({
  inPlace: inPlaceArm.medians[field],
  relocated: relocatedArm.medians[field],
  delta: relocatedArm.medians[field] - inPlaceArm.medians[field],
  percent: Number(
    (((relocatedArm.medians[field] - inPlaceArm.medians[field]) / inPlaceArm.medians[field]) * 100).toFixed(2),
  ),
});

/** The cost the ADR asked to see named: what a relocated package adds to the wire. */
const sidecarRequests = relocatedArm.samples.map(
  (entry) =>
    entry.requestLedger.find((request) => request.resource === "hierarchy.bin")?.count ?? 0,
);
const inPlaceSidecarRequests = inPlaceArm.samples.some((entry) =>
  entry.requestLedger.some((request) => request.resource === "hierarchy.bin"),
);
if (sidecarRequests.some((count) => count !== 1) || inPlaceSidecarRequests) {
  throw new Error("The sidecar must be fetched exactly once by the relocated arm and never by the other.");
}

// The committed screenshots come from the median first-frame run of the
// relocated arm, so the picture and the headline figure are the same run.
const medianCoarse = relocatedArm.medians.coarseFrameMs;
const publishedIndex = relocatedArm.samples.findIndex(
  (entry) => entry.coarseFrameMs === medianCoarse,
);
const publishedRun = [...arms.values()][1].records[publishedIndex];
const screenshots = {};
for (const [name, file] of Object.entries(publishedRun.record.screenshots)) {
  await copyFile(resolve(publishedRun.runDirectory, file.path), resolve(outputDirectory, file.path));
  screenshots[name] = file;
}

const record = {
  schemaVersion: "naru.relocated-hierarchy-browser.1",
  status: "experimental-not-interchange",
  mode: "headed-paired-package-first-frame",
  recordedAt: new Date().toISOString(),
  question:
    "What does moving a federation's assembly tree out of the compiled glTF document " +
    "(ADR-0017) do to hierarchy-ready, first frame, and peak heap at real-large scale, " +
    "and what does the sidecar cost to fetch?",
  method: {
    runsPerArm,
    interleaved: true,
    freshProcessPerSample: true,
    recorder: "scripts/record-ifc-browser-evidence.mjs",
    browser: publishedRun.record.browser,
    host: publishedRun.record.host,
    onlyVariable:
      "scene.bin, coarse.bin, properties.json, and properties.bin are byte-identical " +
      "between the arms; the arms differ in scene.gltf and the hierarchy sidecar alone.",
  },
  arms: armRecords,
  comparison: {
    hierarchyReadyMs: delta("hierarchyReadyMs"),
    coarseFrameMs: delta("coarseFrameMs"),
    readyMs: delta("readyMs"),
    usedJsHeapBytes: delta("usedJsHeapBytes"),
  },
  transfer: {
    inPlace,
    relocated,
    documentDeltaBytes: relocated.documentBytes - inPlace.documentBytes,
    packageDeltaBytes: relocated.packageBytes - inPlace.packageBytes,
    sidecarBytes: relocated.hierarchySidecarBytes,
    byteIdenticalResources: SHARED_RESOURCES,
  },
  sidecarFetch: {
    resource: "hierarchy.bin",
    bytes: relocated.resources.find((entry) => entry.path === "hierarchy.bin")?.bytes ?? null,
    requestsPerRun: sidecarRequests,
    responseIndexPerRun: relocatedArm.samples.map((entry) => entry.sidecarResponseIndex),
    // The tree is read before the first frame is drawn, so its fetch has to
    // land ahead of the coarse payload rather than compete with it.
    precedesCoarsePayload: relocatedArm.samples.every(
      (entry) => entry.sidecarResponseIndex < entry.coarseResponseIndex,
    ),
    absentFromInPlaceArm: !inPlaceSidecarRequests,
  },
  endpoint: {
    holdsAcrossEveryRun: endpointHolds,
    note:
      "The picked node index deliberately differs between the arms: a relocated " +
      "document keeps only the nodes that draw, so they are renumbered. The picked " +
      "occurrence, its property entries, and every residency counter do not.",
    nodeSuffixes: Object.fromEntries(
      armRecords.map((arm) => [arm.id, arm.samples[0].nodeSuffix]),
    ),
    counters: endpoint,
  },
  publishedRun: {
    arm: "relocated",
    index: publishedIndex + 1,
    reason: "median first frame of its arm",
  },
  screenshots,
  consoleIssues: armRecords.flatMap((arm) => arm.samples.map((entry) => entry.consoleIssues)),
};

await writeFile(
  resolve(outputDirectory, "relocated-hierarchy-browser.json"),
  `${JSON.stringify(record, null, 2)}\n`,
  "utf8",
);
console.log(
  `[relocated-browser] hierarchy-ready ${record.comparison.hierarchyReadyMs.inPlace} -> ` +
    `${record.comparison.hierarchyReadyMs.relocated} ms, first frame ` +
    `${record.comparison.coarseFrameMs.inPlace} -> ${record.comparison.coarseFrameMs.relocated} ms ` +
    `(${record.comparison.coarseFrameMs.percent}%), ready ${record.comparison.readyMs.inPlace} -> ` +
    `${record.comparison.readyMs.relocated} ms, heap ` +
    `${(record.comparison.usedJsHeapBytes.inPlace / 1e9).toFixed(3)} -> ` +
    `${(record.comparison.usedJsHeapBytes.relocated / 1e9).toFixed(3)} GB`,
);
console.log(
  `[relocated-browser] document ${inPlace.documentBytes} -> ${relocated.documentBytes} B, ` +
    `package ${inPlace.packageBytes} -> ${relocated.packageBytes} B, sidecar ` +
    `${relocated.hierarchySidecarBytes} B fetched once per run`,
);
console.log(`[relocated-browser] evidence: ${fromRoot(outputDirectory)}`);
