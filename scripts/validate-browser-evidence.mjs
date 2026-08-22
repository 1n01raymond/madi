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
  evidence.schemaVersion === "phase-1-browser-matrix.1",
  "Unsupported browser evidence schema.",
);
assert(Array.isArray(evidence.results) && evidence.results.length === 2, "Expected two results.");
assert(
  evidence.source.packageDigest === compilerReport.output.packageDigest,
  "Browser evidence and compiled glTF evidence must reference the same package digest.",
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
}

assert(browsers.has("chrome") && browsers.has("firefox"), "Expected Chrome and Firefox.");
assert(engines.has("Blink") && engines.has("Gecko"), "Expected Blink and Gecko engines.");
console.log("[browser-evidence] verified 2 headed WebGPU engine results and screenshots");
