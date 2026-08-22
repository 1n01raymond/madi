import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../fixtures/step/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

if (manifest.schemaVersion !== "0.1" || !Array.isArray(manifest.fixtures)) {
  throw new TypeError("fixtures/step/manifest.json has an unsupported shape.");
}

const required = [
  "id",
  "path",
  "sourceUrl",
  "license",
  "licenseUrl",
  "sha256",
  "purposes",
  "attribution",
];
const ids = new Set();
const paths = new Set();

for (const [index, fixture] of manifest.fixtures.entries()) {
  for (const field of required) {
    if (!(field in fixture)) {
      throw new TypeError(`Fixture ${index} is missing ${field}.`);
    }
  }
  if (ids.has(fixture.id)) throw new TypeError(`Duplicate fixture ID ${fixture.id}.`);
  if (paths.has(fixture.path)) throw new TypeError(`Duplicate fixture path ${fixture.path}.`);
  if (!/^[a-f0-9]{64}$/u.test(fixture.sha256)) {
    throw new TypeError(`Fixture ${fixture.id} has an invalid SHA-256 digest.`);
  }
  if (!Array.isArray(fixture.purposes) || fixture.purposes.length === 0) {
    throw new TypeError(`Fixture ${fixture.id} must declare at least one purpose.`);
  }
  ids.add(fixture.id);
  paths.add(fixture.path);
}

console.log(`[fixtures] validated ${manifest.fixtures.length} STEP fixture entries`);
