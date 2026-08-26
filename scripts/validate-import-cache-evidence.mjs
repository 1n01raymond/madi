import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(repositoryRoot, "artifacts/cache");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[import-cache] ${message}`);
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

const [evidenceText, stepManifest, externalManifest] = await Promise.all([
  readFile(resolve(artifactDirectory, "import-cache-evidence.json"), "utf8"),
  readFile(resolve(repositoryRoot, "fixtures/step/manifest.json"), "utf8").then(
    JSON.parse,
  ),
  readFile(resolve(repositoryRoot, "fixtures/external/manifest.json"), "utf8").then(
    JSON.parse,
  ),
]);
const evidence = JSON.parse(evidenceText);

assert(
  evidence.schemaVersion === "naru.import-cache-evidence.1",
  "Unknown evidence envelope.",
);
assert(
  !/[A-Za-z]:[\\/]/u.test(evidenceText) &&
    !evidenceText.includes("output/external-fixtures"),
  "Evidence leaks a machine-local path.",
);

function assertRuns(record, label) {
  assert(sha256Pattern.test(record.cacheKey), `${label} cache key is not a SHA-256.`);
  assert(sha256Pattern.test(record.packageDigest), `${label} package digest is not a SHA-256.`);
  const [cold, warm, corrupted] = record.runs;
  assert(record.runs.length === 3, `${label} must record exactly three runs.`);
  assert(
    cold.phase === "cold" && cold.cache === "miss",
    `${label} cold run must be a cache miss.`,
  );
  assert(
    warm.phase === "warm" && warm.cache === "hit",
    `${label} warm run must be a cache hit.`,
  );
  assert(
    corrupted.phase === "corrupted-entry" && corrupted.cache === "miss",
    `${label} corrupted-entry run must fall back to a miss.`,
  );
  for (const run of record.runs) {
    assert(
      Number.isFinite(run.elapsedMs) && run.elapsedMs > 0,
      `${label} ${run.phase} run is missing its timing.`,
    );
  }
  assert(
    warm.elapsedMs < cold.elapsedMs,
    `${label} warm restore is not faster than the cold compile.`,
  );
  assert(
    corrupted.corruptedResource === "scene.gltf",
    `${label} corruption target changed.`,
  );
  assert(
    corrupted.warnings.some((line) => line.includes("cache restore failed")),
    `${label} corrupted-entry run did not report the failed restore.`,
  );
  assert(
    record.warmRestoreByteIdentical === true &&
      record.fallbackRecompileByteIdentical === true,
    `${label} byte-identity proof is missing.`,
  );
  assert(
    record.entryAfterFallback === "manifest-intact-resource-still-corrupt",
    `${label} post-fallback entry state changed; restate the fail-closed claim.`,
  );
  assert(
    Array.isArray(record.resources) && record.resources.length >= 4,
    `${label} package resource inventory is missing.`,
  );
  for (const resource of record.resources) {
    assert(
      sha256Pattern.test(resource.sha256) && Number.isSafeInteger(resource.bytes),
      `${label} resource ${resource.path} identity is malformed.`,
    );
  }
}

// STEP: the pinned real PyGamer fixture must be the recorded source.
const pygamer = stepManifest.fixtures.find(({ id }) => id === "adafruit-pygamer");
assert(pygamer, "adafruit-pygamer is missing from the STEP fixture manifest.");
assert(
  evidence.step.source.path === "fixtures/step/adafruit-pygamer.step" &&
    evidence.step.source.sha256 === pygamer.sha256,
  "STEP evidence source is not the pinned PyGamer fixture.",
);
assert(
  evidence.step.adapter.schemaVersion === "naru.occt-adapter-identity.1" &&
    evidence.step.adapter.toolchain.cadquery === "2.8.0" &&
    evidence.step.adapter.toolchain.ocp === "7.9.3.1",
  "OCCT adapter identity changed.",
);
assertRuns(evidence.step, "STEP");
assert(
  evidence.step.packageDigest ===
    "f99ccb9c69f4a5771eda9825005f197d0a74d40742944c8d8a7ad78af40ab86d",
  "STEP cache evidence package digest changed.",
);

// IFC: the four-document Digital Hub federation, byte-pinned to the external
// fixture manifest, must reproduce the committed federation package digest.
const digitalHub = externalManifest.datasets.find(
  ({ id }) => id === "ifc-bench-digital-hub",
);
assert(digitalHub, "ifc-bench-digital-hub is missing from the external manifest.");
assert(
  evidence.ifc.documents.length === 4 &&
    evidence.ifc.documents.length === digitalHub.assets.length,
  "IFC evidence must cover the whole Digital Hub federation.",
);
for (const document of evidence.ifc.documents) {
  const asset = digitalHub.assets.find(
    ({ discipline }) => discipline === document.discipline,
  );
  assert(asset, `Unknown IFC discipline ${document.discipline}.`);
  assert(
    document.sha256 === asset.sha256 &&
      document.uriHint === `projects/digital_hub/${asset.path}`,
    `IFC ${document.discipline} source identity changed.`,
  );
}
assert(
  evidence.ifc.adapter.schemaVersion === "naru.ifc-adapter-identity.1" &&
    evidence.ifc.adapter.name === "IfcOpenShell" &&
    evidence.ifc.adapter.version === "0.8.5",
  "IFC adapter identity changed.",
);
assertRuns(evidence.ifc, "IFC");
// This digest is the current-toolchain Digital Hub package (E2.1 explicit
// edges, naru.ifc-adapter-report.5 / naru.ifc-scene-ir-split.4). It differs
// deliberately from artifacts/ifc/digital-hub/build-report.json, which is a
// pre-E2.1 record (includeEdges: false); that federation record's refresh is
// tracked separately and must not silently retarget this pin.
assert(
  evidence.ifc.packageDigest ===
    "0e2ed4547e298908744ce7d9075900b1c55a4e88f26af7a6bef2ea7ee6c6595d",
  "IFC cache evidence package digest changed.",
);

console.log(
  `[import-cache] verified STEP cold ${(evidence.step.runs[0].elapsedMs / 1000).toFixed(1)} s ` +
    `-> warm ${(evidence.step.runs[1].elapsedMs / 1000).toFixed(1)} s ` +
    `(package ${evidence.step.packageDigest.slice(0, 12)})`,
);
console.log(
  `[import-cache] verified IFC cold ${(evidence.ifc.runs[0].elapsedMs / 1000).toFixed(1)} s ` +
    `-> warm ${(evidence.ifc.runs[1].elapsedMs / 1000).toFixed(1)} s ` +
    `(package ${evidence.ifc.packageDigest.slice(0, 12)})`,
);
console.log(
  "[import-cache] corrupted entries failed closed and recompiled byte-identically",
);
