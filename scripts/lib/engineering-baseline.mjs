import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
  assetCachePath,
  findDataset,
  loadExternalFixtureManifest,
  validateExternalFixtureManifest,
} from "./external-fixtures.mjs";

export const engineeringBaselineEvidenceSchema = "naru.engineering-baseline-evidence.1";

const sixty5DesignSelection = [
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "architecture",
    discipline: "d-architecture",
    uriHint: "sixty5/design/arc.ifc",
  },
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "electrical",
    discipline: "d-electrical",
    uriHint: "sixty5/design/electrical.ifc",
  },
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "facade",
    discipline: "d-facade",
    uriHint: "sixty5/design/facade.ifc",
  },
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "kitchen",
    discipline: "d-kitchen",
    uriHint: "sixty5/design/kitchen.ifc",
  },
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "plumbing",
    discipline: "d-plumbing",
    uriHint: "sixty5/design/plumbing.ifc",
  },
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "structure",
    discipline: "d-structure",
    uriHint: "sixty5/design/str.ifc",
  },
  {
    datasetId: "ifc-bench-sixty5",
    assetId: "ventilation",
    discipline: "d-ventilation",
    uriHint: "sixty5/design/ventilation.ifc",
  },
];

const sixty5EngineeringCohort = [
  ["e-bvt-rwb-geelen-beton-10-10e-verdieping", "e-bvt-geelen-10"],
  ["e-bvt-rwb-geelen-beton-11-11e-verdieping", "e-bvt-geelen-11"],
  ["e-s1-rwb-geelen-beton-01-1e-verdieping", "e-s1-geelen-01"],
  ["e-s1-rwb-geelen-beton-02-2e-verdieping", "e-s1-geelen-02"],
  ["e-s1-rwb-geelen-beton-03-3e-verdieping", "e-s1-geelen-03"],
  ["e-s1-rwb-geelen-beton-04-4e-verdieping", "e-s1-geelen-04"],
  ["e-s1-rwb-geelen-beton-05-5e-verdieping", "e-s1-geelen-05"],
  ["e-s1-rwb-geelen-beton-06-6e-verdieping", "e-s1-geelen-06"],
  ["e-s1-rwb-geelen-beton-07-7e-verdieping", "e-s1-geelen-07"],
  ["e-s1-rwb-geelen-beton-08-8e-verdieping", "e-s1-geelen-08"],
  ["e-s1-rwb-geelen-beton-09-9e-verdieping", "e-s1-geelen-09"],
  ["e-s1-rwb-geelen-beton-10-10e-verdieping", "e-s1-geelen-10"],
  ["e-s1-rwb-geelen-beton-11-11e-verdieping", "e-s1-geelen-11"],
  ["e-s1-rwb-geelen-beton-12-12e-verdieping", "e-s1-geelen-12"],
  ["e-s1-rwb-geelen-beton-13-13e-verdieping", "e-s1-geelen-13"],
  ["e-s1-rwb-geelen-beton-14-14e-verdieping", "e-s1-geelen-14"],
  ["e-s1-rwb-geelen-beton-15-15e-verdieping", "e-s1-geelen-15"],
  ["e-s1-rwb-geelen-beton-16-16e-verdieping", "e-s1-geelen-16"],
  ["e-s1-rwb-geelen-beton-17-dakvloer", "e-s1-geelen-17"],
  ["e-s1-rwb-staalconstructie-aarts-1-6", "e-aarts-1-6"],
  ["e-s1-rwb-staalconstructie-aarts-6-8", "e-aarts-6-8"],
  ["e-s1-rwb-staalconstructie-aarts-9-12", "e-aarts-9-12"],
  ["e-s1-rwb-staalconstructie-aarts-13-17", "e-aarts-13-17"],
  ["e-s1-rwb-staalconstructie-aarts-schoren", "e-aarts-schoren"],
].map(([assetId, discipline]) => ({
  datasetId: "sixty5-engineering",
  assetId,
  discipline,
  uriHint: `sixty5/engineering/${assetId}.ifc`,
}));

/**
 * The Design package is the already-qualified sixty5 federation. The
 * Engineering cohort is the complete Geelen Beton and Aarts vendor-family
 * subset: it was fixed before package compilation and keeps semantic-only
 * source files instead of filtering them after observing geometry counts.
 */
export const engineeringBaselineSelection = Object.freeze([
  ...sixty5DesignSelection,
  ...sixty5EngineeringCohort,
]);

function assert(condition, message) {
  if (!condition) throw new TypeError(`[engineering-baseline] ${message}`);
}

async function digestFile(path) {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    byteLength += chunk.length;
  }
  return { byteLength, sha256: hash.digest("hex") };
}

export async function loadEngineeringBaselineSources() {
  const { manifest, sha256: manifestSha256 } = await loadExternalFixtureManifest();
  await validateExternalFixtureManifest(manifest, manifestSha256);

  const datasetIds = [...new Set(engineeringBaselineSelection.map(({ datasetId }) => datasetId))];
  const datasets = datasetIds.map((id) => findDataset(manifest, id));
  for (const dataset of datasets) {
    assert(dataset.status === "qualified", `fixture ${dataset.id} is not qualified`);
    assert(dataset.source.license === "CC-BY-4.0", `fixture ${dataset.id} license changed`);
  }

  const selected = [];
  for (const entry of engineeringBaselineSelection) {
    const dataset = findDataset(manifest, entry.datasetId);
    const asset = dataset.assets.find(({ id }) => id === entry.assetId);
    assert(asset?.role === "source" && asset.format === "ifc", `missing IFC ${entry.assetId}`);
    const sourcePath = assetCachePath(manifest, dataset, asset);
    const details = await stat(sourcePath);
    assert(details.isFile(), `${entry.assetId} is not a regular file`);
    const digest = await digestFile(sourcePath);
    assert(
      digest.byteLength === asset.byteLength && digest.sha256 === asset.sha256,
      `${entry.assetId} bytes or SHA-256 changed`,
    );
    selected.push({
      ...entry,
      sourcePath,
      byteLength: asset.byteLength,
      sha256: asset.sha256,
    });
  }

  const selectionIdentity = selected.map(
    ({ datasetId, assetId, discipline, uriHint, byteLength, sha256 }) => ({
      datasetId,
      assetId,
      discipline,
      uriHint,
      byteLength,
      sha256,
    }),
  );
  return {
    manifest,
    manifestSha256,
    datasets,
    selected: selectionIdentity,
    selectionSha256: createHash("sha256")
      .update(JSON.stringify(selectionIdentity))
      .digest("hex"),
    documents: selected.map(({ discipline, sourcePath, uriHint }) => ({
      discipline,
      sourcePath,
      uriHint,
    })),
  };
}
