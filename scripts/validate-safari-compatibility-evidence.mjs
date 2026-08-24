import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDirectory = fileURLToPath(
  new URL("../artifacts/browser-safari", import.meta.url),
);
const realEvidenceDirectory = await realpath(evidenceDirectory);
const evidence = JSON.parse(
  await readFile(resolve(evidenceDirectory, "safari-compatibility.json"), "utf8"),
);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.trim() !== "", `${label} must be non-empty.`);
}

assert(
  evidence.schemaVersion === "madi.safari-compatibility.1",
  "Unsupported Safari compatibility evidence schema.",
);
assert(evidence.mode === "default-browser-settings", "Safari evidence must use default settings.");
assert(evidence.host?.platform === "darwin", "Safari evidence must be recorded on macOS.");
assert(evidence.host?.architecture === "arm64", "Expected the Apple Silicon evidence host.");
assert(evidence.browser?.name === "Safari", "Expected real Safari, not Playwright WebKit.");
assert(evidence.browser?.headless === false, "Safari evidence must be a headed record.");
assertNonEmptyString(evidence.browser?.version, "browser.version");
assert(evidence.browser?.platformName === "macOS", "Safari platform name changed.");
assertNonEmptyString(evidence.browser?.platformVersion, "browser.platformVersion");
assertNonEmptyString(evidence.browser?.platformBuildVersion, "browser.platformBuildVersion");
assert(
  evidence.source?.fixture === "fixtures/step/adafruit-pygamer.step" &&
    evidence.source?.gltf === "artifacts/phase1/adafruit-pygamer/scene.gltf",
  "Safari evidence source identity changed.",
);
assert(evidence.outcome === "webgpu-unavailable", "Reviewed Safari outcome changed.");
assert(evidence.observed?.webGpuAvailable === false, "Reviewed Safari unexpectedly exposed WebGPU.");
assert(evidence.observed?.hierarchyReady === true, "Safari did not load hierarchy first.");
assert(evidence.observed?.hierarchyRecords === 87, "Safari hierarchy record count changed.");
assert(evidence.observed?.brandLoaded === true, "Safari did not load the MADI brand asset.");
assert(evidence.observed?.state === "error", "Safari capability state must be error.");
assert(
  evidence.observed?.status === "WebGPU is unavailable in this browser.",
  "Safari capability diagnostic changed.",
);
assert(
  evidence.observed?.title === "MADI · Compiled glTF to WebGPU",
  "Safari application title changed.",
);
assert(Array.isArray(evidence.limitations) && evidence.limitations.length === 2, "Expected limitations.");

const screenshotPath = evidence.screenshot?.path;
assertNonEmptyString(screenshotPath, "screenshot.path");
assert(!isAbsolute(screenshotPath), "Safari screenshot path must be relative.");
assert(extname(screenshotPath).toLowerCase() === ".png", "Safari screenshot must be PNG.");
const screenshot = resolve(evidenceDirectory, screenshotPath);
const screenshotFromRoot = relative(evidenceDirectory, screenshot);
assert(
  screenshotFromRoot !== "" &&
    screenshotFromRoot !== ".." &&
    !screenshotFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(screenshotFromRoot),
  "Safari screenshot path escapes the evidence directory.",
);
const realScreenshot = await realpath(screenshot);
const realScreenshotFromRoot = relative(realEvidenceDirectory, realScreenshot);
assert(
  realScreenshotFromRoot !== "" &&
    realScreenshotFromRoot !== ".." &&
    !realScreenshotFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(realScreenshotFromRoot),
  "Safari screenshot resolves outside the evidence directory.",
);
const screenshotStats = await stat(realScreenshot);
const screenshotBytes = await readFile(realScreenshot);
assert(screenshotStats.isFile(), "Safari screenshot must be a regular file.");
assert(screenshotStats.size === evidence.screenshot.bytes, "Safari screenshot size changed.");
assert(
  screenshotBytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "Safari screenshot has an invalid PNG signature.",
);
assert(
  createHash("sha256").update(screenshotBytes).digest("hex") === evidence.screenshot.sha256,
  "Safari screenshot digest changed.",
);

console.log(
  `[safari-compatibility] verified Safari ${evidence.browser.version} default-settings capability record`,
);
