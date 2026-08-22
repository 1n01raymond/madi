import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hydratePhase0Evidence } from "./evidence-input.js";
import { compileSceneToGltf } from "./gltf.js";
import { validateCompiledGltf } from "./validate.js";

const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) {
  throw new TypeError(
    "Usage: madi-compile-phase1-evidence <phase0.scene.json> <output-directory>",
  );
}

const sourcePath = resolve(sourceArgument);
const outputDirectory = resolve(outputArgument);
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

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "scene.gltf"), compiled.json, "utf8"),
  writeFile(resolve(outputDirectory, "scene.bin"), compiled.binary),
  writeFile(
    resolve(outputDirectory, "build-report.json"),
    `${JSON.stringify(compiled.report, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(
  `[compiler] wrote deterministic glTF package ${compiled.report.output.packageDigest}`,
);
console.log(`[compiler] output: ${outputDirectory}`);
