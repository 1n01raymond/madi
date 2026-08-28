/**
 * Compiles one IFC federation sample in its own process.
 *
 * Every cache state this record measures has to start from a process that has
 * never compiled anything: a second compile inside one process reuses a warm
 * module graph, a grown V8 heap, and an operating-system file cache that a
 * user reopening a model tomorrow does not have. The recorder therefore spawns
 * this script once per sample and reads the JSON it leaves behind.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
}

const configPath = resolve(repositoryRoot, argument("--config"));
const resultPath = resolve(repositoryRoot, argument("--result"));
const outputDirectory = resolve(repositoryRoot, argument("--output"));
const phase = argument("--phase");
const config = JSON.parse(await readFile(configPath, "utf8"));
// The probe run asks for the compiler's default glTF formatting; every sample
// run uses the compact formatting the config pins.
const compactJson = !process.argv.includes("--pretty") && config.compactJson === true;

const { compileIfcFederation } = await import(
  pathToFileURL(resolve(repositoryRoot, "packages/compiler/dist/index.js")).href
);

/** Committed evidence must stay portable: strip machine-absolute path prefixes. */
function portableText(text) {
  return text
    .replaceAll(repositoryRoot, "<repository>")
    .replaceAll(repositoryRoot.replaceAll("\\", "/"), "<repository>")
    // Stack frames name modules by file URL, whose path is percent-encoded.
    .replaceAll(pathToFileURL(repositoryRoot).href, "<repository>")
    .replaceAll(/[A-Za-z]:[/][^\s")]*/gu, "<path>");
}

const warnings = [];
const originalWarn = console.warn;
console.warn = (...parts) => {
  warnings.push(portableText(parts.map(String).join(" ")));
  originalWarn(...parts);
};

let result;
let failure;
const startedAt = performance.now();
try {
  result = await compileIfcFederation({
    documents: config.documents.map((document) => ({
      discipline: document.discipline,
      sourcePath: resolve(repositoryRoot, document.sourcePath),
      uriHint: document.uriHint,
    })),
    outputDirectory,
    cacheDirectory: resolve(repositoryRoot, config.cacheDirectory),
    threads: config.threads,
    ...(compactJson ? { compactJson: true } : {}),
    ...(config.pythonExecutable ? { pythonExecutable: config.pythonExecutable } : {}),
  });
} catch (error) {
  failure = {
    name: error instanceof Error ? error.name : "Error",
    message: portableText(error instanceof Error ? error.message : String(error)),
    stack: portableText(error instanceof Error ? (error.stack ?? "") : ""),
  };
}
const compileMilliseconds = Number((performance.now() - startedAt).toFixed(1));
console.warn = originalWarn;

await writeFile(
  resultPath,
  `${JSON.stringify(
    {
      phase,
      compactJson,
      compileMilliseconds,
      warnings,
      ...(failure ? { failure } : {}),
      ...(result
        ? {
            cache: result.cache,
            report: result.report,
            // The adapter keeps its own per-document artifact cache, so a run
            // records which documents it inspected and which it restored.
            documentArtifactCache: result.adapterReport?.documentArtifactCache ?? null,
            sources: result.sources.map(({ discipline, uriHint, sha256, byteLength }) => ({
              discipline,
              uriHint,
              sha256,
              byteLength,
            })),
          }
        : {}),
    },
    null,
    2,
  )}\n`,
);
if (failure) process.exitCode = 1;
