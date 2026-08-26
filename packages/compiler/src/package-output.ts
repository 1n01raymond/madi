import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CompiledGltfPackage } from "./types.js";

export async function writeCompiledPackage(
  compiled: CompiledGltfPackage,
  outputDirectoryArgument: string,
  adapterReport?: unknown,
): Promise<string> {
  const outputDirectory = resolve(outputDirectoryArgument);
  await mkdir(outputDirectory, { recursive: true });
  const writes: Promise<void>[] = [
    writeFile(resolve(outputDirectory, "scene.gltf"), compiled.json, "utf8"),
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
