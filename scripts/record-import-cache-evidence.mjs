import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const workingRoot = resolve(repositoryRoot, "output/cache-evidence");
const artifactDirectory = resolve(
  repositoryRoot,
  process.argv[2] ?? "artifacts/cache",
);

const { compileStepFile, compileIfcFederation, readCompiledCacheEntry } =
  await import(
    pathToFileURL(resolve(repositoryRoot, "packages/compiler/dist/index.js")).href
  );

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const stepPython =
  process.env.NARU_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const ifcPython =
  process.env.NARU_IFC_PYTHON ??
  process.env.NARU_PYTHON ??
  (process.platform === "win32" ? "python" : "python3");

function adapterIdentity(executable, scriptPath) {
  const probe = spawnSync(executable, [scriptPath, "--identity"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert(probe.status === 0, `${scriptPath} --identity failed: ${probe.stderr}`);
  return JSON.parse(probe.stdout);
}

/** Hash every package resource plus both reports so runs can be compared byte for byte. */
async function identifyOutput(outputDirectory) {
  const names = (await readdir(outputDirectory)).sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const resources = [];
  for (const name of names) {
    const bytes = await readFile(join(outputDirectory, name));
    resources.push({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return resources;
}

function sameResources(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (resource, index) =>
        resource.path === right[index].path &&
        resource.bytes === right[index].bytes &&
        resource.sha256 === right[index].sha256,
    )
  );
}

async function corruptEntryResource(cacheDirectory, key, resourcePath) {
  const target = join(cacheDirectory, key, resourcePath);
  const bytes = await readFile(target);
  assert(bytes.byteLength > 0, `${resourcePath} in the cache entry is empty.`);
  bytes[0] ^= 0xff;
  await writeFile(target, bytes);
}

/** Committed evidence must stay portable: strip machine-absolute path prefixes. */
function portableText(text) {
  return text
    .replaceAll(repositoryRoot, "<repository>")
    .replaceAll(repositoryRoot.replaceAll("\\", "/"), "<repository>")
    .replaceAll(/[A-Za-z]:[\\/][^\s")]*/gu, "<path>");
}

async function captureWarnings(run) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => {
    warnings.push(portableText(parts.map(String).join(" ")));
    originalWarn(...parts);
  };
  try {
    const value = await run();
    return { value, warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function timedCompile(label, compile) {
  console.log(`[cache-evidence] ${label} ...`);
  const startedAt = performance.now();
  const { value: result, warnings } = await captureWarnings(compile);
  const elapsedMs = Number((performance.now() - startedAt).toFixed(1));
  console.log(
    `[cache-evidence] ${label}: cache ${result.cache.status} in ${(elapsedMs / 1000).toFixed(1)} s`,
  );
  return { result, elapsedMs, warnings };
}

async function recordSource({ id, compile, corruptResourcePath }) {
  const sourceRoot = join(workingRoot, id);
  await rm(sourceRoot, { recursive: true, force: true });
  const cacheDirectory = join(sourceRoot, "cache");
  const run = (phase) => compile(join(sourceRoot, phase), cacheDirectory);

  const cold = await timedCompile(`${id} cold`, () => run("cold"));
  assert(cold.result.cache.status === "miss", `${id} cold run must be a cache miss.`);
  const coldResources = await identifyOutput(join(sourceRoot, "cold"));

  const warm = await timedCompile(`${id} warm`, () => run("warm"));
  assert(warm.result.cache.status === "hit", `${id} warm run must be a cache hit.`);
  assert(
    warm.result.cache.key === cold.result.cache.key,
    `${id} warm run resolved a different cache key.`,
  );
  const warmResources = await identifyOutput(join(sourceRoot, "warm"));
  assert(
    sameResources(coldResources, warmResources),
    `${id} warm restore is not byte-identical to the cold compile.`,
  );

  await corruptEntryResource(cacheDirectory, cold.result.cache.key, corruptResourcePath);
  const corrupted = await timedCompile(`${id} corrupted-entry`, () => run("corrupted"));
  assert(
    corrupted.result.cache.status === "miss",
    `${id} corrupted-entry run must fall back to a miss.`,
  );
  assert(
    corrupted.result.cache.key === cold.result.cache.key,
    `${id} corrupted-entry run resolved a different cache key.`,
  );
  assert(
    corrupted.warnings.some((line) => line.includes("cache restore failed")),
    `${id} corrupted-entry run must report the failed restore.`,
  );
  const corruptedResources = await identifyOutput(join(sourceRoot, "corrupted"));
  assert(
    sameResources(coldResources, corruptedResources),
    `${id} fallback recompile is not byte-identical to the cold compile.`,
  );

  // The storage layer keeps failing closed: the manifest still parses, but the
  // corrupted resource no longer matches it, so later runs stay misses until
  // the host quarantines or rebuilds the entry.
  const entryAfterFallback = await readCompiledCacheEntry(
    cacheDirectory,
    cold.result.cache.key,
  );
  assert(entryAfterFallback, `${id} cache manifest must survive the fallback.`);
  const manifestResource = entryAfterFallback.resources.find(
    ({ path }) => path === corruptResourcePath,
  );
  assert(manifestResource, `${id} manifest lost ${corruptResourcePath}.`);
  const corruptedEntryDigest = sha256(
    await readFile(join(cacheDirectory, cold.result.cache.key, corruptResourcePath)),
  );
  assert(
    corruptedEntryDigest !== manifestResource.sha256,
    `${id} corrupted entry resource unexpectedly matches its manifest.`,
  );

  const packageDigest = cold.result.report.output.packageDigest;
  for (const [phase, { result }] of [
    ["warm", warm],
    ["corrupted", corrupted],
  ]) {
    assert(
      result.report.output.packageDigest === packageDigest,
      `${id} ${phase} run changed the package digest.`,
    );
  }

  return {
    cacheKey: cold.result.cache.key,
    packageDigest,
    resources: coldResources,
    runs: [
      { phase: "cold", cache: "miss", elapsedMs: cold.elapsedMs },
      { phase: "warm", cache: "hit", elapsedMs: warm.elapsedMs },
      {
        phase: "corrupted-entry",
        cache: "miss",
        elapsedMs: corrupted.elapsedMs,
        corruptedResource: corruptResourcePath,
        warnings: corrupted.warnings,
      },
    ],
    warmRestoreByteIdentical: true,
    fallbackRecompileByteIdentical: true,
    entryAfterFallback: "manifest-intact-resource-still-corrupt",
    warmSpeedup: Number((cold.elapsedMs / warm.elapsedMs).toFixed(1)),
  };
}

const stepSourcePath = resolve(repositoryRoot, "fixtures/step/adafruit-pygamer.step");
const stepAdapterScript = resolve(
  repositoryRoot,
  "native/adapter-occt/tools/extract_scene_ir.py",
);
const ifcFixtureDirectory = resolve(
  repositoryRoot,
  "output/external-fixtures/ifc-bench-digital-hub",
);
const ifcAdapterScript = resolve(
  repositoryRoot,
  "native/adapter-ifc/tools/extract_federation_scene_ir.py",
);
const ifcDocuments = [
  ["architecture", "arc.ifc"],
  ["heating", "heating.ifc"],
  ["plumbing", "plumbing.ifc"],
  ["ventilation", "ventilation.ifc"],
].map(([discipline, fileName]) => ({
  discipline,
  sourcePath: join(ifcFixtureDirectory, fileName),
  uriHint: `projects/digital_hub/${fileName}`,
}));
const ifcThreads = 6;

const stepIdentity = adapterIdentity(stepPython, stepAdapterScript);
const ifcIdentity = adapterIdentity(ifcPython, ifcAdapterScript);

const step = await recordSource({
  id: "step-adafruit-pygamer",
  corruptResourcePath: "scene.gltf",
  compile: (outputDirectory, cacheDirectory) =>
    compileStepFile({
      sourcePath: stepSourcePath,
      outputDirectory,
      cacheDirectory,
      pythonExecutable: stepPython,
    }),
});

const ifc = await recordSource({
  id: "ifc-digital-hub",
  corruptResourcePath: "scene.gltf",
  compile: (outputDirectory, cacheDirectory) =>
    compileIfcFederation({
      documents: ifcDocuments,
      outputDirectory,
      cacheDirectory,
      threads: ifcThreads,
      pythonExecutable: ifcPython,
    }),
});

const evidence = {
  schemaVersion: "naru.import-cache-evidence.1",
  recordedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
  },
  step: {
    source: {
      path: "fixtures/step/adafruit-pygamer.step",
      sha256: sha256(await readFile(stepSourcePath)),
    },
    adapter: stepIdentity,
    ...step,
  },
  ifc: {
    documents: await Promise.all(
      ifcDocuments.map(async ({ discipline, sourcePath, uriHint }) => ({
        discipline,
        uriHint,
        sha256: sha256(await readFile(sourcePath)),
      })),
    ),
    adapter: ifcIdentity,
    threads: ifcThreads,
    ...ifc,
  },
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  resolve(artifactDirectory, "import-cache-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);

console.log(
  `[cache-evidence] STEP cold ${(step.runs[0].elapsedMs / 1000).toFixed(1)} s -> ` +
    `warm ${(step.runs[1].elapsedMs / 1000).toFixed(1)} s (${step.warmSpeedup}x), ` +
    `package ${step.packageDigest.slice(0, 12)}`,
);
console.log(
  `[cache-evidence] IFC cold ${(ifc.runs[0].elapsedMs / 1000).toFixed(1)} s -> ` +
    `warm ${(ifc.runs[1].elapsedMs / 1000).toFixed(1)} s (${ifc.warmSpeedup}x), ` +
    `package ${ifc.packageDigest.slice(0, 12)}`,
);
