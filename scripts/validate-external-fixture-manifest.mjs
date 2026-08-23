import {
  loadExternalFixtureManifest,
  validateExternalFixtureManifest,
} from "./lib/external-fixtures.mjs";

const { manifest, sha256 } = await loadExternalFixtureManifest();
await validateExternalFixtureManifest(manifest, sha256);

const qualified = manifest.datasets.filter((dataset) => dataset.status === "qualified").length;
const registered = manifest.datasets.length - qualified;
console.log(
  `[external-fixtures] verified ${manifest.datasets.length} datasets ` +
    `(${qualified} qualified, ${registered} registered; metadata, licenses, evidence)`,
);
