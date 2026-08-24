#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hydratePhase0Evidence } from "./evidence-input.js";
import { compileSceneToGltf } from "./gltf.js";
import { writeCompiledPackage } from "./package-output.js";
import { validateCompiledGltf } from "./validate.js";

const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) {
  throw new TypeError(
    "Usage: naru-compile-phase1-evidence <phase0.scene.json> <output-directory>",
  );
}

const sourcePath = resolve(sourceArgument);
const serialized = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
const compiled = compileSceneToGltf(hydratePhase0Evidence(serialized));
const validation = validateCompiledGltf(compiled.document, compiled.binary);
if (!validation.ok) {
  throw new TypeError(
    `Compiled glTF validation failed: ${validation.issues
      .slice(0, 5)
      .map(({ code, path }) => `${code} at ${path}`)
      .join(", ")}`,
  );
}

const outputDirectory = await writeCompiledPackage(compiled, outputArgument);
console.log(
  `[compiler] wrote deterministic glTF package ${compiled.report.output.packageDigest}`,
);
console.log(`[compiler] output: ${outputDirectory}`);
