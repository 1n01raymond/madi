/**
 * Records what a compiled package reader does with a malformed package.
 *
 * ADR-0011 bounds a remote package before it is parsed or allocated, and
 * `SECURITY.md` promises that the parsers and binary decoders are fuzzed. Both
 * claims rest on the same invariant: every rejection leaves through the
 * declared error class -- `CompiledGltfError` for the glTF loader,
 * `SpatialDemandIndexError` for the demand sidecar -- and nothing else escapes
 * a reader. This campaign mutates committed packages under a fixed seed and
 * counts how each execution ended, so "fuzzed" is a number rather than a claim.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildPackageFuzzTargets,
  controlledErrorNames,
  fuzzCorpora,
  loadFuzzCorpora,
  spatialDemandSeed,
} from "./lib/package-fuzz-targets.mjs";
import { runPackageFuzzCampaign } from "./lib/package-fuzz.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};

const iterations = Number(argument("--iterations", "20000"));
const seed = Number(argument("--seed", "20260829"));
const artifactDirectory = resolve(
  repositoryRoot,
  argument("--output", "artifacts/security/package-fuzz"),
);

const runtime = await import(
  pathToFileURL(resolve(repositoryRoot, "packages/runtime-webgpu/dist/index.js")).href
);
const { encodeSpatialDemandIndex } = await import(
  pathToFileURL(resolve(repositoryRoot, "packages/compiler/dist/index.js")).href
);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const corpora = await loadFuzzCorpora(repositoryRoot, fuzzCorpora);
const recordedCorpora = [];
for (const corpus of corpora) {
  const documentBytes = await readFile(resolve(repositoryRoot, corpus.directory, "scene.gltf"));
  recordedCorpora.push({
    id: corpus.id,
    directory: corpus.directory,
    document: { byteLength: documentBytes.byteLength, sha256: digest(documentBytes) },
    nodeCount: corpus.document.nodes.length,
    meshCount: corpus.document.meshes.length,
    accessorCount: corpus.document.accessors.length,
    targetBuffer: { byteLength: corpus.target.byteLength, sha256: digest(corpus.target) },
    ...(corpus.coarse
      ? { coarseBuffer: { byteLength: corpus.coarse.byteLength, sha256: digest(corpus.coarse) } }
      : {}),
  });
}

const spatial = spatialDemandSeed(encodeSpatialDemandIndex);
const targets = buildPackageFuzzTargets({ corpora, runtime, spatial });

const startedAt = performance.now();
const campaign = runPackageFuzzCampaign({
  targets,
  iterations,
  seed,
  controlledErrorNames,
});
const elapsedSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(1));

const evidence = {
  schemaVersion: "naru.package-fuzz-evidence.1",
  recordedAt: new Date().toISOString(),
  mode: "seeded-malformed-package-campaign",
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
  },
  contract: {
    controlledErrorNames,
    statement:
      "A reader may accept a mutated package or refuse it through a declared " +
      "error class. Any other thrown value is an uncontrolled outcome and a defect.",
    readers: [
      "parseCompiledGltf",
      "inspectCompiledHierarchy",
      "prepareCompiledGltfDecoder",
      "decodeCompiledGltf",
      "decodeSpatialDemandIndex",
      "querySpatialDemandIndex",
    ],
  },
  method: {
    determinism:
      "Each execution draws from a mulberry32 stream seeded by the campaign " +
      "seed, the target label, and the iteration, so the same seed reproduces " +
      "the same counts on any host.",
    documentMutation:
      "One to three operators (replace, delete, duplicate, truncate, swap, " +
      "scale, retype, chain) applied to members reachable from the roots that " +
      "decide what the loader allocates.",
    binaryMutation:
      "One operator (intact, truncate, flip, grow) applied to a copy of the " +
      "buffer the target decodes; the committed bytes are never modified.",
    accounting:
      "An operator that finds nothing of its kind at the drawn path is counted " +
      "as a no-op rather than retried, so the histogram is an honest account.",
  },
  corpora: recordedCorpora,
  spatialSeed: {
    source: "encodeSpatialDemandIndex over a fixed synthetic occurrence set",
    occurrenceCount: spatial.options.gltfNodeCount,
    targetChunkCount: spatial.options.targetChunkCount,
    byteLength: spatial.bytes.byteLength,
    sha256: digest(spatial.bytes),
  },
  elapsedSeconds,
  campaign,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  resolve(artifactDirectory, "package-fuzz-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(
  `[package-fuzz] ${campaign.totals.executions} executions over ${campaign.targets.length} ` +
    `targets in ${elapsedSeconds} s: ${campaign.totals.accepted} accepted, ` +
    `${campaign.totals.rejected} rejected, ${campaign.totals.uncontrolled} uncontrolled`,
);
console.log(`[package-fuzz] wrote ${relative(repositoryRoot, artifactDirectory)}`);
if (campaign.totals.uncontrolled > 0) {
  for (const sample of campaign.uncontrolledSamples) {
    console.log(`[package-fuzz] uncontrolled ${sample.target}#${sample.iteration}: ${sample.detail}`);
  }
}
