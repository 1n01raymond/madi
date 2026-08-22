import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(
  new URL("../fixtures/step/manifest.json", import.meta.url),
);
const fixtureDirectory = dirname(manifestPath);
const realFixtureDirectory = await realpath(fixtureDirectory);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.schemaVersion !== "0.2" || !Array.isArray(manifest.fixtures)) {
  throw new TypeError("fixtures/step/manifest.json has an unsupported shape.");
}

const required = [
  "id",
  "kind",
  "path",
  "sourcePath",
  "sourceUrl",
  "license",
  "licenseUrl",
  "licenseFile",
  "sha256",
  "purposes",
  "attribution",
  "generatedWith",
];
const generatedWithRequired = [
  "tool",
  "toolVersion",
  "binding",
  "bindingVersion",
  "kernel",
  "kernelVersion",
];
const fixtureKinds = new Set(["assembly", "precision-part"]);
const ids = new Set();
const paths = new Set();

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertHttpsUrl(value, label) {
  assertNonEmptyString(value, label);
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new TypeError(`${label} must use HTTPS.`);
  }
}

function fixtureFile(relativePath, label) {
  assertNonEmptyString(relativePath, label);
  if (isAbsolute(relativePath)) {
    throw new TypeError(`${label} must be relative to fixtures/step.`);
  }

  const absolutePath = resolve(fixtureDirectory, relativePath);
  const pathFromFixtureRoot = relative(fixtureDirectory, absolutePath);
  if (
    pathFromFixtureRoot === "" ||
    pathFromFixtureRoot === ".." ||
    pathFromFixtureRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromFixtureRoot)
  ) {
    throw new TypeError(`${label} escapes fixtures/step.`);
  }
  return absolutePath;
}

async function assertRegularFile(path, label) {
  const realPath = await realpath(path);
  const pathFromFixtureRoot = relative(realFixtureDirectory, realPath);
  if (
    pathFromFixtureRoot === "" ||
    pathFromFixtureRoot === ".." ||
    pathFromFixtureRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromFixtureRoot)
  ) {
    throw new TypeError(`${label} resolves outside fixtures/step.`);
  }

  const details = await stat(realPath);
  if (!details.isFile()) throw new TypeError(`${label} is not a regular file.`);
}

for (const [index, fixture] of manifest.fixtures.entries()) {
  for (const field of required) {
    if (!(field in fixture)) {
      throw new TypeError(`Fixture ${index} is missing ${field}.`);
    }
  }

  assertNonEmptyString(fixture.id, `Fixture ${index} id`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fixture.id)) {
    throw new TypeError(`Fixture ${index} has a non-canonical ID.`);
  }
  if (!fixtureKinds.has(fixture.kind)) {
    throw new TypeError(`Fixture ${fixture.id} has an unsupported kind.`);
  }
  if (ids.has(fixture.id)) throw new TypeError(`Duplicate fixture ID ${fixture.id}.`);
  if (paths.has(fixture.path)) throw new TypeError(`Duplicate fixture path ${fixture.path}.`);
  if (!/^[a-f0-9]{64}$/u.test(fixture.sha256)) {
    throw new TypeError(`Fixture ${fixture.id} has an invalid SHA-256 digest.`);
  }
  if (!Array.isArray(fixture.purposes) || fixture.purposes.length === 0) {
    throw new TypeError(`Fixture ${fixture.id} must declare at least one purpose.`);
  }
  if (
    fixture.purposes.some(
      (purpose) =>
        typeof purpose !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(purpose),
    ) ||
    new Set(fixture.purposes).size !== fixture.purposes.length
  ) {
    throw new TypeError(`Fixture ${fixture.id} has invalid or duplicate purposes.`);
  }

  assertNonEmptyString(fixture.license, `Fixture ${fixture.id} license`);
  assertNonEmptyString(fixture.attribution, `Fixture ${fixture.id} attribution`);
  assertHttpsUrl(fixture.sourceUrl, `Fixture ${fixture.id} sourceUrl`);
  assertHttpsUrl(fixture.licenseUrl, `Fixture ${fixture.id} licenseUrl`);

  if (typeof fixture.generatedWith !== "object" || fixture.generatedWith === null) {
    throw new TypeError(`Fixture ${fixture.id} generatedWith must be an object.`);
  }
  for (const field of generatedWithRequired) {
    assertNonEmptyString(
      fixture.generatedWith[field],
      `Fixture ${fixture.id} generatedWith.${field}`,
    );
  }

  const stepPath = fixtureFile(fixture.path, `Fixture ${fixture.id} path`);
  const sourcePath = fixtureFile(fixture.sourcePath, `Fixture ${fixture.id} sourcePath`);
  const licensePath = fixtureFile(fixture.licenseFile, `Fixture ${fixture.id} licenseFile`);
  if (![".step", ".stp"].includes(extname(stepPath).toLowerCase())) {
    throw new TypeError(`Fixture ${fixture.id} is not a STEP file.`);
  }

  await Promise.all([
    assertRegularFile(stepPath, `Fixture ${fixture.id} path`),
    assertRegularFile(sourcePath, `Fixture ${fixture.id} sourcePath`),
    assertRegularFile(licensePath, `Fixture ${fixture.id} licenseFile`),
  ]);

  const bytes = await readFile(stepPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== fixture.sha256) {
    throw new TypeError(
      `Fixture ${fixture.id} SHA-256 mismatch: expected ${fixture.sha256}, got ${digest}.`,
    );
  }

  const step = bytes.toString("utf8");
  if (
    step.includes("\uFFFD") ||
    !step.startsWith("ISO-10303-21;") ||
    !step.includes("\nHEADER;") ||
    !step.includes("\nDATA;") ||
    !step.trimEnd().endsWith("END-ISO-10303-21;")
  ) {
    throw new TypeError(`Fixture ${fixture.id} is not a valid UTF-8 STEP Part 21 envelope.`);
  }

  ids.add(fixture.id);
  paths.add(fixture.path);
}

const representedKinds = new Set(manifest.fixtures.map((fixture) => fixture.kind));
for (const requiredKind of fixtureKinds) {
  if (!representedKinds.has(requiredKind)) {
    throw new TypeError(`Fixture manifest must include at least one ${requiredKind}.`);
  }
}

console.log(
  `[fixtures] verified ${manifest.fixtures.length} STEP files (metadata, provenance, envelope, SHA-256)`,
);
