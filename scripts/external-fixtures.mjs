#!/usr/bin/env node

import { relative } from "node:path";

import {
  fetchDataset,
  findDataset,
  inspectDataset,
  loadExternalFixtureManifest,
  repositoryRoot,
  resolveRepositoryOutput,
  validateExternalFixtureManifest,
  verifyDataset,
  writeInspection,
} from "./lib/external-fixtures.mjs";

function usage() {
  console.log(`Usage:
  pnpm fixtures:external list
  pnpm fixtures:external fetch <dataset-id> [--asset <asset-id>] [--allow-large]
  pnpm fixtures:external verify <dataset-id>
  pnpm fixtures:external inspect <dataset-id> [--output <repo-relative.json>]

Downloads are explicit and remain under output/external-fixtures. The real-large
tier additionally requires --allow-large.`);
}

function parseOptions(arguments_) {
  const options = { allowLarge: false, assetIds: [], output: undefined };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--allow-large") {
      options.allowLarge = true;
    } else if (argument === "--asset") {
      const id = arguments_[index + 1];
      if (!id || id.startsWith("--")) throw new TypeError("--asset requires an asset ID.");
      options.assetIds.push(id);
      index += 1;
    } else if (argument === "--output") {
      const path = arguments_[index + 1];
      if (!path || path.startsWith("--")) throw new TypeError("--output requires a path.");
      options.output = path;
      index += 1;
    } else {
      throw new TypeError(`Unknown option: ${argument}`);
    }
  }
  return options;
}

const [command, datasetId, ...optionArguments] = process.argv.slice(2);
if (!command || command === "help" || command === "--help") {
  usage();
  process.exitCode = command ? 0 : 1;
} else {
  const { manifest, sha256 } = await loadExternalFixtureManifest();
  await validateExternalFixtureManifest(manifest, sha256, { validateEvidence: false });

  if (command === "list") {
    if (datasetId !== undefined) throw new TypeError("list does not take a dataset ID.");
    for (const dataset of manifest.datasets) {
      const size = (dataset.expectedDownloadBytes / 1_000_000).toFixed(1);
      const guard = dataset.requiresAllowLarge ? " --allow-large" : "";
      console.log(
        `${dataset.id.padEnd(24)} ${dataset.status.padEnd(10)} ${dataset.tier.padEnd(11)} ` +
          `${size.padStart(7)} MB${guard}`,
      );
    }
  } else {
    if (!datasetId) {
      usage();
      throw new TypeError(`${command} requires a dataset ID.`);
    }
    const dataset = findDataset(manifest, datasetId);
    const options = parseOptions(optionArguments);

    if (command === "fetch") {
      if (options.output) throw new TypeError("fetch does not support --output.");
      console.log(`[external-fixtures] fetching ${dataset.id}`);
      const results = await fetchDataset(manifest, dataset, {
        allowLarge: options.allowLarge,
        assetIds: options.assetIds.length === 0 ? undefined : options.assetIds,
      });
      for (const result of results) {
        const action = result.downloaded ? "downloaded" : "reused";
        console.log(`  ${action} ${result.id}: ${relative(repositoryRoot, result.path)}`);
      }
    } else if (command === "verify") {
      if (options.allowLarge || options.output || options.assetIds.length > 0) {
        throw new TypeError("verify does not take options.");
      }
      const verified = await verifyDataset(manifest, dataset);
      console.log(`[external-fixtures] verified ${verified.length} files for ${dataset.id}`);
    } else if (command === "inspect") {
      if (options.allowLarge || options.assetIds.length > 0) {
        throw new TypeError("inspect only supports --output.");
      }
      const inspection = await inspectDataset(manifest, sha256, dataset);
      const outputArgument =
        options.output ?? `${manifest.cacheDirectory}/${dataset.id}/inspection.json`;
      const normalizedOutput = outputArgument.replaceAll("\\", "/");
      if (
        !normalizedOutput.startsWith(`${manifest.cacheDirectory}/`) &&
        !normalizedOutput.startsWith("artifacts/fixtures/external/")
      ) {
        throw new TypeError(
          "Inspection output must stay under the fixture cache or reviewed evidence directory.",
        );
      }
      const output = resolveRepositoryOutput(outputArgument, "Inspection output");
      await writeInspection(output, inspection);
      console.log(
        `[external-fixtures] inspected ${inspection.summary.fileCount} files / ` +
          `${inspection.summary.entityCount.toLocaleString("en-US")} entities -> ` +
          relative(repositoryRoot, output),
      );
    } else {
      usage();
      throw new TypeError(`Unknown command: ${command}`);
    }
  }
}
