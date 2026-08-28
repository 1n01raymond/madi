import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { StreamedJsonDocument } from "./json-document.js";
import type { CompiledGltfPackage } from "./types.js";

/**
 * Writes a streamed document straight to the file, one chunk at a time.
 *
 * Synchronous on purpose: the writer hands over chunks synchronously, so
 * queueing them for an asynchronous write would rebuild in memory the exact
 * whole-document copy that streaming exists to avoid.
 */
function writeStreamedDocument(path: string, document: StreamedJsonDocument): void {
  const file = openSync(path, "w");
  try {
    document.write((chunk) => {
      let written = 0;
      while (written < chunk.byteLength) {
        written += writeSync(file, chunk, written, chunk.byteLength - written);
      }
    });
  } finally {
    closeSync(file);
  }
}

export async function writeCompiledPackage(
  compiled: CompiledGltfPackage,
  outputDirectoryArgument: string,
  adapterReport?: unknown,
): Promise<string> {
  const outputDirectory = resolve(outputDirectoryArgument);
  await mkdir(outputDirectory, { recursive: true });
  writeStreamedDocument(resolve(outputDirectory, "scene.gltf"), compiled.json);
  const writes: Promise<void>[] = [
    writeFile(resolve(outputDirectory, compiled.report.options.binaryUri), compiled.binary),
    writeFile(
      resolve(outputDirectory, "build-report.json"),
      `${JSON.stringify(compiled.report, null, 2)}\n`,
      "utf8",
    ),
  ];
  if (compiled.coarseBinary) {
    const coarseBinaryUri = compiled.report.options.coarseBinaryUri;
    if (!coarseBinaryUri) {
      throw new TypeError("Progressive package is missing its coarse resource URI.");
    }
    writes.push(writeFile(resolve(outputDirectory, coarseBinaryUri), compiled.coarseBinary));
  }
  if (compiled.spatialBinary) {
    if (!compiled.spatialBinaryUri) {
      throw new TypeError("Spatial index package is missing its resource URI.");
    }
    writes.push(
      writeFile(resolve(outputDirectory, compiled.spatialBinaryUri), compiled.spatialBinary),
    );
  }
  if (compiled.propertiesJson !== undefined && compiled.propertiesBinary !== undefined) {
    const { propertiesUri, propertiesBinaryUri } = compiled.report.options;
    if (!propertiesUri || !propertiesBinaryUri) {
      throw new TypeError("Property sidecar package is missing its resource URIs.");
    }
    writes.push(
      writeFile(resolve(outputDirectory, propertiesUri), compiled.propertiesJson, "utf8"),
      writeFile(resolve(outputDirectory, propertiesBinaryUri), compiled.propertiesBinary),
    );
  }
  if (adapterReport !== undefined) {
    writes.push(
      writeFile(
        resolve(outputDirectory, "adapter-report.json"),
        `${JSON.stringify(adapterReport, null, 2)}\n`,
        "utf8",
      ),
    );
  }
  await Promise.all(writes);
  return outputDirectory;
}
