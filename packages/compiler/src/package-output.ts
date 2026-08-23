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
    writeFile(resolve(outputDirectory, "scene.bin"), compiled.binary),
    writeFile(
      resolve(outputDirectory, "build-report.json"),
      `${JSON.stringify(compiled.report, null, 2)}\n`,
      "utf8",
    ),
  ];
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
