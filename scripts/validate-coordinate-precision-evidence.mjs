import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDirectory = fileURLToPath(
  new URL("../artifacts/precision/large-coordinates", import.meta.url),
);
const evidence = JSON.parse(
  await readFile(resolve(evidenceDirectory, "evidence.json"), "utf8"),
);

const expectedPackages = {
  near: "1019d7cd7bfdc3deb0962f952da7e9b2dd48f1988a00b315706772d51324a185",
  far: "74da685cf59644f646dcb373b82f6342b8ae296e1a85dd439957a64cb5ba8fb4",
};
const expectedBrowsers = {
  chrome: {
    engine: "Blink",
    version: "151.0.7922.174",
    screenshots: {
      initial: "8b72b65a683e788c2145c6309ec46d649fea6de81291cef8e0a27934de8c4170",
      navigated: "363f0342da4a469b8c870feeb61695aa094b9347176a638ddb8721a8d0cf33a9",
      sectioned: "13743c59dcf1a1a3c33c07553c79fefa2c83e4e60ccdb79a818a5fddb1d95cbb",
    },
  },
  firefox: {
    engine: "Gecko",
    version: "150.0.2",
    screenshots: {
      initial: "5649ca5a78a32e6a7b0d91726afd4c39adb39e1032eb633089f3ccecb62f36aa",
      navigated: "5bbea69491a3b1ea1864d3461c6e5515f8ed96ee0e3ed275ef5ae209b26a02aa",
      sectioned: "48f6278d20dc4b8988d31db5bdaa7452bdd49529e604d2a8ecef66bb05aff373",
    },
  },
};

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

assert(
  evidence.schemaVersion === "naru.coordinate-precision.1" &&
    evidence.status === "adr-decision-evidence",
  "Unsupported coordinate-precision evidence schema or status.",
);
assert(
  evidence.host?.platform === "darwin" && evidence.host?.architecture === "arm64",
  "The reviewed coordinate-precision record must come from the Apple-Silicon host.",
);
assert(
  evidence.fixture?.ownership === "project-owned-apache-2.0" &&
    evidence.fixture.plateWidthMillimeters === 40 &&
    evidence.fixture.plateHeightMillimeters === 60 &&
    evidence.fixture.gapMillimeters === 0.25 &&
    JSON.stringify(evidence.fixture.farOffsetMeters) ===
      JSON.stringify([10_000_000, -7_000_000, 3_000_000]) &&
    evidence.fixture.naiveF32UlpMetersAtFarX === 1,
  "The record must use the project-owned 0.25 mm fixture at the pinned 10,000 km offset.",
);
assert(
  evidence.thresholds?.maximumMeasurementErrorMillimeters === 0.001 &&
    evidence.thresholds.maximumPixelDrift === 0.25 &&
    evidence.thresholds.pickingIdentityRequired === true &&
    evidence.thresholds.gltfErrors === 0 &&
    evidence.thresholds.gltfWarnings === 0 &&
    evidence.thresholds.consoleIssues === 0,
  "Coordinate-precision acceptance thresholds changed without a schema update.",
);

const expectedCounts = {
  prototypeCount: 1,
  compiledPrototypeCount: 1,
  occurrenceCount: 2,
  renderableOccurrenceCount: 2,
  gltfNodeCount: 3,
  gltfMeshCount: 1,
  materialCount: 4,
  triangleCount: 2,
  edgeSegmentCount: 4,
};
for (const id of ["near", "far"]) {
  const record = evidence.packages?.[id];
  const buildReport = JSON.parse(
    await readFile(resolve(evidenceDirectory, id, "build-report.json"), "utf8"),
  );
  assert(record?.packageDigest === expectedPackages[id], `${id} package digest changed.`);
  assert(
    buildReport.output?.packageDigest === record.packageDigest &&
      JSON.stringify(buildReport.counts) === JSON.stringify(expectedCounts) &&
      JSON.stringify(record.counts) === JSON.stringify(expectedCounts),
    `${id} build report or compiled counts changed.`,
  );
  assert(
    record.gltfValidation?.errors === 0 && record.gltfValidation?.warnings === 0,
    `${id} package did not pass the pinned Khronos glTF validation gate.`,
  );
  assert(
    Number.isFinite(record.measurement?.absoluteErrorMillimeters) &&
      record.measurement.absoluteErrorMillimeters <=
        evidence.thresholds.maximumMeasurementErrorMillimeters,
    `${id} measurement exceeds the 0.001 mm error budget.`,
  );

  for (const resource of buildReport.output.resources) {
    const bytes = await readFile(resolve(evidenceDirectory, id, resource.path));
    const summary = resource.path === "scene.gltf" ? record.sceneGltf : record.sceneBinary;
    assert(
      bytes.byteLength === resource.bytes &&
        digest(bytes) === resource.sha256 &&
        summary.bytes === resource.bytes &&
        summary.sha256 === resource.sha256,
      `${id}/${resource.path} does not match its build and evidence digests.`,
    );
  }
}

const nearMeasurement = evidence.packages.near.measurement;
const farMeasurement = evidence.packages.far.measurement;
assert(
  Math.abs(nearMeasurement.gapMillimeters - farMeasurement.gapMillimeters) < 1e-12 &&
    Math.abs(farMeasurement.naiveF32GapMillimeters + 40) < 1e-12,
  "The far package must retain the near gap while naive f32 collapses both plate centers.",
);
for (let index = 0; index < 2; index += 1) {
  assert(
    Math.abs(
      farMeasurement.centerXMeters[index] -
        nearMeasurement.centerXMeters[index] -
        evidence.fixture.farOffsetMeters[0],
    ) < 1e-9,
    `Far plate ${index} does not retain its exact near-relative X center.`,
  );
}

assert(evidence.browsers?.length === 2, "Exactly two headed browser engines are required.");
for (const browser of evidence.browsers) {
  const expected = expectedBrowsers[browser.browser];
  assert(expected, `Unexpected browser ${browser.browser}.`);
  assert(
    browser.browserEngine === expected.engine &&
      browser.version === expected.version &&
      browser.headless === false,
    `${browser.browser} version, engine, or headed mode changed.`,
  );
  assert(
    browser.near?.picked?.objectId === 2 &&
      browser.far?.picked?.objectId === 2 &&
      browser.near.picked.label === "Left precision plate" &&
      JSON.stringify(browser.near.picked) === JSON.stringify(browser.far.picked),
    `${browser.browser} did not preserve deterministic picking identity.`,
  );
  assert(
    Array.isArray(browser.consoleIssues) && browser.consoleIssues.length === 0,
    `${browser.browser} emitted console warnings, errors, or page errors.`,
  );

  for (const state of ["initial", "navigated", "sectioned"]) {
    const comparison = browser.comparisons?.[state];
    assert(
      comparison?.byteIdentical === true &&
        comparison.maximumPixelDrift === 0 &&
        comparison.nearSha256 === expected.screenshots[state] &&
        comparison.farSha256 === expected.screenshots[state],
      `${browser.browser} ${state} near/far canvas comparison changed.`,
    );
    for (const scene of ["near", "far"]) {
      const screenshot = browser[scene].screenshots[state];
      const bytes = await readFile(resolve(evidenceDirectory, screenshot.path));
      assert(
        bytes.byteLength === screenshot.bytes &&
          digest(bytes) === screenshot.sha256 &&
          screenshot.sha256 === expected.screenshots[state],
        `${browser.browser} ${state} ${scene} screenshot digest changed.`,
      );
    }
  }
}

console.log(
  `[coordinate-precision] validated: 0.25 mm gap at 10,000 km · ` +
    `${farMeasurement.absoluteErrorMillimeters.toFixed(9)} mm error · ` +
    "headed Chrome/Firefox 0 px near/far drift",
);
