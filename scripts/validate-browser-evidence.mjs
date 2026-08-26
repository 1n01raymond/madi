import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDirectory = fileURLToPath(
  new URL("../artifacts/browser-matrix", import.meta.url),
);
const realEvidenceDirectory = await realpath(evidenceDirectory);
const evidence = JSON.parse(
  await readFile(resolve(evidenceDirectory, "browser-matrix.json"), "utf8"),
);
const compilerReport = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../artifacts/phase1/adafruit-pygamer/build-report.json", import.meta.url),
    ),
    "utf8",
  ),
);
const progressiveCompilerReport = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL(
        "../artifacts/phase1/repeated-fasteners-ap242/build-report.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
const progressiveGltf = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../artifacts/phase1/repeated-fasteners-ap242/scene.gltf", import.meta.url),
    ),
    "utf8",
  ),
);
const expectedTargetRanges = [0, 2, 1].map((chunkIndex) => {
  const chunk = progressiveGltf.extras.madi.progressive.targetChunks[chunkIndex];
  assert(chunk, `Missing progressive target chunk ${chunkIndex}.`);
  return `bytes=${chunk.byteOffset}-${chunk.byteOffset + chunk.byteLength - 1}`;
});
const fixtureManifest = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../fixtures/step/manifest.json", import.meta.url)),
    "utf8",
  ),
);
const fixture = fixtureManifest.fixtures.find(({ id }) => id === "adafruit-pygamer");
const fixtureBytes = await readFile(
  fileURLToPath(new URL("../fixtures/step/adafruit-pygamer.step", import.meta.url)),
);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.trim() !== "", `${label} must be non-empty.`);
}

assert(
  evidence.schemaVersion === "phase-1-browser-matrix.2",
  "Unsupported browser evidence schema.",
);
assert(Array.isArray(evidence.results) && evidence.results.length === 2, "Expected two results.");
assert(
  evidence.source.packageDigest === compilerReport.output.packageDigest,
  "Browser evidence and compiled glTF evidence must reference the same package digest.",
);
assert(
  evidence.source.progressivePackageDigest ===
    progressiveCompilerReport.output.packageDigest &&
    evidence.source.progressiveSourceDigest === progressiveCompilerReport.source.sourceDigest,
  "Browser progressive evidence and direct AP242 package identity differ.",
);
assert(
  fixture?.license === "MIT" && fixture.provenanceType === "upstream",
  "Canonical browser fixture must retain its upstream MIT provenance.",
);
const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");
assert(fixture.sha256 === fixtureDigest, "Canonical browser fixture checksum changed.");
assert(
  evidence.source.sourceDigest === `sha256:${fixtureDigest}` &&
    compilerReport.source.sourceDigest === evidence.source.sourceDigest,
  "Browser, compiler, and canonical STEP source digests differ.",
);

const browsers = new Set();
const engines = new Set();
for (const [resultIndex, result] of evidence.results.entries()) {
  const label = `results[${resultIndex}]`;
  assertNonEmptyString(result.browser, `${label}.browser`);
  assertNonEmptyString(result.browserEngine, `${label}.browserEngine`);
  assertNonEmptyString(result.browserVersion, `${label}.browserVersion`);
  assert(!browsers.has(result.browser), `${label}.browser must be unique.`);
  assert(!engines.has(result.browserEngine), `${label}.browserEngine must be unique.`);
  browsers.add(result.browser);
  engines.add(result.browserEngine);

  assert(result.headless === false, `${label} must be a headed visual record.`);
  assert(result.adapter?.isFallbackAdapter === false, `${label} used a fallback adapter.`);
  assert(Array.isArray(result.consoleIssues), `${label}.consoleIssues must be an array.`);
  assert(result.consoleIssues.length === 0, `${label} contains browser console issues.`);
  for (const [key, expectedValue] of Object.entries(evidence.expected)) {
    assert(
      result.observed?.[key] === expectedValue,
      `${label}.observed.${key} does not match the expected value.`,
    );
  }
  assert(
    typeof result.observed?.pickPoint?.x === "number" &&
      result.observed.pickPoint.x >= 0 &&
      result.observed.pickPoint.x <= 1 &&
      typeof result.observed?.pickPoint?.y === "number" &&
      result.observed.pickPoint.y >= 0 &&
      result.observed.pickPoint.y <= 1,
    `${label}.observed.pickPoint must be normalized to the viewport.`,
  );

  const screenshotPath = result.screenshot?.path;
  assertNonEmptyString(screenshotPath, `${label}.screenshot.path`);
  assert(!isAbsolute(screenshotPath), `${label}.screenshot.path must be relative.`);
  assert(extname(screenshotPath).toLowerCase() === ".png", `${label} screenshot must be PNG.`);
  const screenshot = resolve(evidenceDirectory, screenshotPath);
  const screenshotFromRoot = relative(evidenceDirectory, screenshot);
  assert(
    screenshotFromRoot !== "" &&
      screenshotFromRoot !== ".." &&
      !screenshotFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(screenshotFromRoot),
    `${label}.screenshot.path escapes the evidence directory.`,
  );
  const realScreenshot = await realpath(screenshot);
  const realScreenshotFromRoot = relative(realEvidenceDirectory, realScreenshot);
  assert(
    realScreenshotFromRoot !== "" &&
      realScreenshotFromRoot !== ".." &&
      !realScreenshotFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(realScreenshotFromRoot),
    `${label}.screenshot.path resolves outside the evidence directory.`,
  );

  const screenshotStats = await stat(realScreenshot);
  const screenshotBytes = await readFile(realScreenshot);
  assert(screenshotStats.isFile(), `${label} screenshot must be a regular file.`);
  assert(screenshotStats.size === result.screenshot.bytes, `${label} screenshot size changed.`);
  assert(
    screenshotBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    `${label} screenshot has an invalid PNG signature.`,
  );
  assert(
    createHash("sha256").update(screenshotBytes).digest("hex") === result.screenshot.sha256,
    `${label} screenshot digest changed.`,
  );

  const progressive = result.observed?.progressive;
  assert(progressive?.coarseVisibleBeforeTarget === true, `${label} missed the coarse frame.`);
  assert(
    progressive?.targetRequestSawCoarseReady === true,
    `${label} requested target geometry before coarse readiness.`,
  );
  assert(progressive?.targetPromoted === true, `${label} did not promote target geometry.`);
  assert(
    progressive?.firstTargetChunkPromoted === true,
    `${label} did not expose a partial target frame.`,
  );
  assert(
    progressive?.partialTriangles === "368" && progressive?.partialEdges === "49",
    `${label} partial target geometry counts changed.`,
  );
  assert(
    progressive?.targetResponsesPartial === true &&
      JSON.stringify(progressive?.targetRangeRequests) === JSON.stringify(expectedTargetRanges),
    `${label} target Range request sequence changed.`,
  );
  assert(
    progressive?.coarseTriangles === "12" && progressive?.coarseEdges === "12",
    `${label} coarse geometry counts changed.`,
  );
  assert(
    progressive?.targetTriangles === "2,088" && progressive?.targetEdges === "193",
    `${label} target geometry counts changed.`,
  );
  assert(
    progressive?.cancellation?.activeRangeAborted === true &&
      progressive?.cancellation?.requestsBeforeCancel === 2 &&
      progressive?.cancellation?.noFurtherRequests === true &&
      progressive?.cancellation?.status === "Scene load cancelled.",
    `${label} did not cancel the active target range cleanly.`,
  );
  const viewPriority = progressive?.viewPriority;
  const progressiveChunks = progressiveGltf.extras.madi.progressive.targetChunks;
  const initialChunk = progressiveChunks.find(({ id }) => id === viewPriority?.initialSchedulerChunk);
  const replacementChunk = progressiveChunks.find(
    ({ id }) => id === viewPriority?.replacementSchedulerChunk,
  );
  const rangeFor = (chunk) =>
    chunk ? `bytes=${chunk.byteOffset}-${chunk.byteOffset + chunk.byteLength - 1}` : undefined;
  assert(
    initialChunk?.id === progressiveChunks[0]?.id &&
      replacementChunk?.id === progressiveChunks[1]?.id &&
      viewPriority?.initialRange === rangeFor(initialChunk) &&
      viewPriority?.replacementRange === rangeFor(replacementChunk) &&
      viewPriority?.obsoleteRangeCancelled === true &&
      viewPriority?.replacementRequestedBeforeRelease === true,
    `${label} did not replace obsolete camera-priority work.`,
  );
  const coarseScreenshotPath = progressive?.coarseScreenshot?.path;
  assertNonEmptyString(coarseScreenshotPath, `${label}.progressive.coarseScreenshot.path`);
  assert(!isAbsolute(coarseScreenshotPath), `${label} coarse screenshot path must be relative.`);
  assert(extname(coarseScreenshotPath).toLowerCase() === ".png", `${label} coarse screenshot must be PNG.`);
  const coarseScreenshot = resolve(evidenceDirectory, coarseScreenshotPath);
  const coarseFromRoot = relative(evidenceDirectory, coarseScreenshot);
  assert(
    coarseFromRoot !== "" &&
      coarseFromRoot !== ".." &&
      !coarseFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(coarseFromRoot),
    `${label} coarse screenshot path escapes the evidence directory.`,
  );
  const realCoarseScreenshot = await realpath(coarseScreenshot);
  const realCoarseFromRoot = relative(realEvidenceDirectory, realCoarseScreenshot);
  assert(
    realCoarseFromRoot !== "" &&
      realCoarseFromRoot !== ".." &&
      !realCoarseFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(realCoarseFromRoot),
    `${label} coarse screenshot resolves outside the evidence directory.`,
  );
  const coarseScreenshotBytes = await readFile(realCoarseScreenshot);
  assert(
    coarseScreenshotBytes.byteLength === progressive.coarseScreenshot.bytes,
    `${label} coarse screenshot size changed.`,
  );
  assert(
    coarseScreenshotBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    `${label} coarse screenshot has an invalid PNG signature.`,
  );
  assert(
    createHash("sha256").update(coarseScreenshotBytes).digest("hex") ===
      progressive.coarseScreenshot.sha256,
    `${label} coarse screenshot digest changed.`,
  );
  const partialScreenshotPath = progressive?.partialScreenshot?.path;
  assertNonEmptyString(partialScreenshotPath, `${label}.progressive.partialScreenshot.path`);
  assert(!isAbsolute(partialScreenshotPath), `${label} partial screenshot path must be relative.`);
  assert(
    extname(partialScreenshotPath).toLowerCase() === ".png",
    `${label} partial screenshot must be PNG.`,
  );
  const partialScreenshot = resolve(evidenceDirectory, partialScreenshotPath);
  const partialFromRoot = relative(evidenceDirectory, partialScreenshot);
  assert(
    partialFromRoot !== "" &&
      partialFromRoot !== ".." &&
      !partialFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(partialFromRoot),
    `${label} partial screenshot path escapes the evidence directory.`,
  );
  const realPartialScreenshot = await realpath(partialScreenshot);
  const realPartialFromRoot = relative(realEvidenceDirectory, realPartialScreenshot);
  assert(
    realPartialFromRoot !== "" &&
      realPartialFromRoot !== ".." &&
      !realPartialFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(realPartialFromRoot),
    `${label} partial screenshot resolves outside the evidence directory.`,
  );
  const partialScreenshotBytes = await readFile(realPartialScreenshot);
  assert(
    partialScreenshotBytes.byteLength === progressive.partialScreenshot.bytes,
    `${label} partial screenshot size changed.`,
  );
  assert(
    partialScreenshotBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    `${label} partial screenshot has an invalid PNG signature.`,
  );
  assert(
    createHash("sha256").update(partialScreenshotBytes).digest("hex") ===
      progressive.partialScreenshot.sha256,
    `${label} partial screenshot digest changed.`,
  );
  const viewScreenshotPath = viewPriority?.screenshot?.path;
  assertNonEmptyString(viewScreenshotPath, `${label}.progressive.viewPriority.screenshot.path`);
  assert(!isAbsolute(viewScreenshotPath), `${label} view-priority screenshot path must be relative.`);
  assert(
    extname(viewScreenshotPath).toLowerCase() === ".png",
    `${label} view-priority screenshot must be PNG.`,
  );
  const viewScreenshot = resolve(evidenceDirectory, viewScreenshotPath);
  const viewFromRoot = relative(evidenceDirectory, viewScreenshot);
  assert(
    viewFromRoot !== "" &&
      viewFromRoot !== ".." &&
      !viewFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(viewFromRoot),
    `${label} view-priority screenshot path escapes the evidence directory.`,
  );
  const realViewScreenshot = await realpath(viewScreenshot);
  const realViewFromRoot = relative(realEvidenceDirectory, realViewScreenshot);
  assert(
    realViewFromRoot !== "" &&
      realViewFromRoot !== ".." &&
      !realViewFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(realViewFromRoot),
    `${label} view-priority screenshot resolves outside the evidence directory.`,
  );
  const viewScreenshotBytes = await readFile(realViewScreenshot);
  assert(
    viewScreenshotBytes.byteLength === viewPriority.screenshot.bytes,
    `${label} view-priority screenshot size changed.`,
  );
  assert(
    viewScreenshotBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    `${label} view-priority screenshot has an invalid PNG signature.`,
  );
  assert(
    createHash("sha256").update(viewScreenshotBytes).digest("hex") ===
      viewPriority.screenshot.sha256,
    `${label} view-priority screenshot digest changed.`,
  );
}

assert(browsers.has("chrome") && browsers.has("firefox"), "Expected Chrome and Firefox.");
assert(engines.has("Blink") && engines.has("Gecko"), "Expected Blink and Gecko engines.");
console.log("[browser-evidence] verified 2 headed WebGPU engine results and screenshots");
