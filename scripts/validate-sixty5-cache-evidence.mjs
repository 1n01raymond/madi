import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/cache/sixty5");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[sixty5-cache] ${message}`);
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

const [evidenceText, externalManifest] = await Promise.all([
  readFile(resolve(artifactDirectory, "sixty5-cache-evidence.json"), "utf8"),
  readFile(resolve(repositoryRoot, "fixtures/external/manifest.json"), "utf8").then(
    JSON.parse,
  ),
]);
const evidence = JSON.parse(evidenceText);

assert(
  evidence.schemaVersion === "naru.sixty5-cache-evidence.1",
  "Unknown evidence envelope.",
);
assert(
  evidence.mode === "fresh-process-cache-state-distributions",
  "Recording mode changed; restate what the distributions measure.",
);
assert(
  !/[A-Za-z]:[\\/]/u.test(evidenceText) &&
    !evidenceText.includes("output/external-fixtures"),
  "Evidence leaks a machine-local path.",
);

// The federation is the pinned CC BY 4.0 sixty5 dataset, byte for byte.
assert(
  evidence.fixture.datasetId === "ifc-bench-sixty5" &&
    evidence.fixture.manifest.path === "fixtures/external/manifest.json" &&
    evidence.fixture.manifest.sha256 ===
      "77d7d587d6b32938a371325e281a4584e10c2ff3118a59f300a9da097eb2f478",
  "The external fixture manifest this record pins has changed.",
);
const dataset = externalManifest.datasets.find(({ id }) => id === "ifc-bench-sixty5");
assert(dataset, "ifc-bench-sixty5 is missing from the external manifest.");
assert(
  evidence.fixture.documents.length === 7 &&
    evidence.fixture.documents.length === dataset.assets.length,
  "The record must cover the whole seven-document sixty5 federation.",
);
for (const document of evidence.fixture.documents) {
  const asset = dataset.assets.find(({ discipline }) => discipline === document.discipline);
  assert(asset, `Unknown sixty5 discipline ${document.discipline}.`);
  assert(
    document.sha256 === asset.sha256 &&
      document.bytes === asset.byteLength &&
      document.uriHint === `projects/sixty5/${asset.path}`,
    `sixty5 ${document.discipline} source identity changed.`,
  );
}
assert(
  evidence.adapter.schemaVersion === "naru.ifc-adapter-identity.1" &&
    evidence.adapter.name === "IfcOpenShell" &&
    evidence.adapter.version === "0.8.5" &&
    sha256Pattern.test(evidence.adapter.fingerprint),
  "IFC adapter identity changed.",
);
assert(
  evidence.host.platform === "win32" && typeof evidence.commit.head === "string",
  "The record must disclose the host and the commit it was taken at.",
);

// The protocol is fixed before the results, so the validator pins it too.
const { protocol } = evidence;
assert(
  protocol.samplesPerState === 5 &&
    JSON.stringify(protocol.states) === JSON.stringify(["cold", "warm", "corrupt-entry"]),
  "The sampling plan changed.",
);
assert(
  protocol.peakProcessMemory.method === "os-sampled-win32-process-tree" &&
    protocol.peakProcessMemory.intervalMilliseconds === 500,
  "The peak-memory method changed; restate what it can and cannot see.",
);
assert(
  protocol.unchangedReopenTargetMs.minimum === 1_000 &&
    protocol.unchangedReopenTargetMs.maximum === 5_000,
  "The unchanged-reopen product target must not be edited to fit a result.",
);
assert(
  JSON.stringify(protocol.reportComparison.semanticExclusions) ===
    JSON.stringify(["adapter-report.json:documentArtifactCache"]),
  "Exactly one execution-path field may be excluded from report comparison.",
);
assert(
  typeof protocol.gltfFormatting === "string" &&
    protocol.gltfFormatting.includes("compactJson: true"),
  "The record must state which glTF formatting every sample used.",
);

// Every retained sample must be a valid one: the state's cache status, a real
// process-tree memory sample, and the document-cache result that state implies.
const expectedCacheStatus = { cold: "miss", warm: "hit", "corrupt-entry": "miss" };
const disciplines = evidence.fixture.documents.map(({ discipline }) => discipline);

for (const [state, expected] of Object.entries(expectedCacheStatus)) {
  const record = evidence.states[state];
  assert(record, `The ${state} distribution is missing.`);
  assert(
    record.samples === 5 && record.runs.length === 5,
    `The ${state} state must retain five valid samples.`,
  );
  for (const measure of ["compileMilliseconds", "processMilliseconds"]) {
    const distribution = record[measure];
    assert(
      distribution.values.length === 5 &&
        distribution.values.every((value) => Number.isFinite(value) && value > 0),
      `The ${state} ${measure} distribution is malformed.`,
    );
    const sorted = [...distribution.values].sort((a, b) => a - b);
    assert(
      distribution.median === sorted[2] &&
        distribution.p95 === sorted[4] &&
        distribution.minimum === sorted[0] &&
        distribution.maximum === sorted[4],
      `The ${state} ${measure} statistics do not match its samples.`,
    );
  }
  for (const run of record.runs) {
    assert(
      run.cacheStatus === expected,
      `A retained ${state} sample reports cache ${run.cacheStatus}.`,
    );
    // The evidence debt does not close without a valid peak for every run.
    assert(
      Number.isInteger(run.memorySamples) &&
        run.memorySamples >= 1 &&
        run.peakWorkingSetBytes > 0 &&
        run.osPeakWorkingSetBytes >= run.peakWorkingSetBytes,
      `A retained ${state} sample has no valid process-tree memory sample.`,
    );
    const cache = run.documentArtifactCache;
    assert(
      cache.schemaVersion === "naru.ifc-document-artifact.1" && cache.status === "enabled",
      `A retained ${state} sample did not run with the document artifact cache.`,
    );
    if (state === "cold" || state === "warm") {
      // A warm hit never runs the adapter; it restores the cold run's report.
      assert(
        cache.hits.length === 0 && cache.misses.length === disciplines.length,
        `A retained ${state} sample should record seven document-cache misses.`,
      );
    } else {
      assert(
        cache.misses.length === 0 && cache.hits.length === disciplines.length,
        "A corrupt-entry fallback should still restore all seven documents.",
      );
      assert(
        run.warnings.some((line) => line.includes("cache restore failed")),
        "A corrupt-entry sample did not report the failed restore.",
      );
      assert(
        run.warnings.some((line) => line.includes("cache publish failed")),
        "A corrupt-entry sample must report that the damaged entry was not replaced.",
      );
    }
    if (state !== "corrupt-entry") {
      assert(run.warnings.length === 0, `A retained ${state} sample warned unexpectedly.`);
    }
  }
}
assert(
  evidence.states.warm.compileMilliseconds.median <
    evidence.states["corrupt-entry"].compileMilliseconds.median &&
    evidence.states["corrupt-entry"].compileMilliseconds.median <
      evidence.states.cold.compileMilliseconds.median,
  "Warm, corrupt-entry, and cold no longer order as the record explains them.",
);
assert(
  Array.isArray(evidence.discardedSamples) && evidence.discardedSamples.length === 0,
  "This record was taken with no discarded samples; a re-record with rejects must say so.",
);

// Package identity: the exact resource set, its digests, and the proof that
// every other sample reproduced the baseline byte for byte.
const identity = evidence.packageIdentity;
assert(
  identity.packageDigest ===
    "3206ea40835d8ca70a0a82208e397a8dcdcd66351b29b4df0e8102ff910e6454",
  "The sixty5 package digest changed.",
);
const expectedResources = [
  ["adapter-report.json", 39_022],
  ["build-report.json", 141_563],
  ["coarse.bin", 38_700_720],
  ["incremental-dependencies.json", 38_342_167],
  ["properties.bin", 31_179_862],
  ["properties.json", 17_705_010],
  ["scene.bin", 169_752_328],
  ["scene.gltf", 357_999_930],
];
assert(
  identity.resources.length === expectedResources.length,
  "The compiled output no longer holds the recorded eight files.",
);
for (const [index, [path, bytes]] of expectedResources.entries()) {
  const resource = identity.resources[index];
  assert(
    resource.path === path && resource.bytes === bytes && sha256Pattern.test(resource.sha256),
    `Package resource ${path} changed.`,
  );
}
const expectedDigests = {
  "coarse.bin": "258e085d4f3d0b380bb89c3596b2e3bfc4a43177afe9fc7e92d6e1046db9031b",
  "properties.bin": "dad8d98909c738df930569c4b907c29e64cda2b65d84917936c1c4d86d3dd8c4",
  "properties.json": "dc3394714b73d322dcfe6bad7ce780dbdd18cb547e5eaf45a26c9e66de932312",
  "scene.bin": "8860f0f545e6d5ca1f8d225a339fca107389fbdba4069b930850625e7c0f60d1",
  "scene.gltf": "e8aae670655445cb3d351ea89bb37af18c3f955fb9fc9ccc9a9a9dfa63cf95ac",
};
for (const [path, sha256] of Object.entries(expectedDigests)) {
  assert(
    identity.resources.find((resource) => resource.path === path)?.sha256 === sha256,
    `Package resource ${path} digest changed.`,
  );
  // The build report must describe the same bytes it shipped beside.
  const declared = identity.buildReportResources.find((resource) => resource.path === path);
  assert(
    declared?.sha256 === sha256 &&
      declared.bytes ===
        identity.resources.find((resource) => resource.path === path)?.bytes,
    `build-report.json disagrees with the ${path} it declares.`,
  );
}
assert(
  identity.buildReportResources.length === 5,
  "The build report resource inventory changed.",
);
assert(
  identity.identical === true &&
    identity.comparisons.length === 14 &&
    identity.comparisons.every(({ failures }) => failures.length === 0),
  "The fourteen non-baseline samples are not all byte-identical to the baseline.",
);

// The product target the record answers, reported as measured either way.
const reopen = evidence.unchangedReopen;
assert(
  reopen.target.maximum === protocol.unchangedReopenTargetMs.maximum,
  "The reopen verdict is measured against a different target than the protocol states.",
);
assert(
  reopen.meetsCompile === reopen.compileMedianMs <= reopen.target.maximum &&
    reopen.meetsWholeProcess === reopen.wholeProcessMedianMs <= reopen.target.maximum,
  "The reopen verdict does not follow from its own medians.",
);
assert(
  reopen.meetsCompile === true && reopen.meetsWholeProcess === true,
  "The recorded unchanged reopen no longer meets the 1-5 s target; report the miss, do not weaken this check.",
);

// A default-formatting compile of this federation cannot produce a package on
// Node: JSON.stringify exceeds V8's maximum string length. A streaming document
// writer would make this "compiled" and requires a re-record, not a looser pin.
const probe = evidence.defaultFormattingProbe;
assert(
  probe.compactJson === false &&
    probe.outcome === "failed" &&
    probe.failure?.name === "RangeError" &&
    probe.failure.message === "Invalid string length",
  "The default-formatting probe result changed; re-record rather than restate it.",
);

// This host compiles current main, which emits explicit IFC boundary edges; the
// committed pre-E2.1 federation record is a different package by design and must
// not be silently retargeted to make either record pass.
assert(
  evidence.committedRecordComparison.record === "artifacts/ifc/sixty5" &&
    evidence.committedRecordComparison.packageDigest ===
      "a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347" &&
    evidence.committedRecordComparison.reproduced === false,
  "The committed-record comparison changed.",
);

const seconds = (value) => (value / 1000).toFixed(1);
console.log(
  `[sixty5-cache] verified cold ${seconds(evidence.states.cold.compileMilliseconds.median)} s ` +
    `-> warm ${seconds(evidence.states.warm.compileMilliseconds.median)} s ` +
    `-> corrupt-entry ${seconds(evidence.states["corrupt-entry"].compileMilliseconds.median)} s ` +
    "(medians of five fresh-process samples each)",
);
console.log(
  `[sixty5-cache] unchanged reopen ${reopen.wholeProcessMedianMs.toFixed(0)} ms whole process ` +
    `meets the ${reopen.target.minimum}-${reopen.target.maximum} ms target; ` +
    `package ${identity.packageDigest.slice(0, 12)} identical over 14 comparisons`,
);
