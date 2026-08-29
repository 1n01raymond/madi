/**
 * Records what moving mesh-less hierarchy nodes out of the compiled document
 * costs and recovers, measured on real federations rather than a fixture.
 *
 * The node-field record (`artifacts/compiler/node-field-elision`) ranked this
 * lever first by an upper bound: every byte of every node that carries no mesh,
 * 21.88% of the engineering baseline's document. An upper bound is not a
 * saving. The nodes still have to be carried, so this record compares whole
 * packages -- document plus both sidecar resources -- and reports the document
 * change and the package change separately, because only one of them is a win
 * for a client that downloads everything.
 *
 * Each variant compiles in its own process because a federation-scale compile
 * peaks near 3 GB. The round-trip proof runs on Digital Hub, the largest model
 * whose two decoded packages fit in one process at once.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const modelArguments = process.argv.flatMap((value, at) => (
  value === "--model" ? [process.argv[at + 1]] : []
));
const models = (modelArguments.length > 0
  ? modelArguments
  : [
      "digital-hub=output/ifc/digital-hub-split4",
      "engineering-baseline=output/ifc/engineering-baseline",
    ]
).map((entry) => {
  const at = entry.indexOf("=");
  if (at <= 0) throw new TypeError(`--model expects <label>=<split directory>, got ${entry}`);
  return { label: entry.slice(0, at), input: entry.slice(at + 1) };
});
const workDirectory = argument("--work", "output/hierarchy-relocation");
const artifactDirectory = resolve(
  repositoryRoot,
  argument("--output", "artifacts/compiler/hierarchy-relocation"),
);
/** Digital Hub is small enough to hold two decoded packages at once. */
const roundTripLabel = argument("--round-trip", "digital-hub");
const heapMegabytes = argument("--heap-mb", "6144");
/** The upper bound this slice set out to test, from the record that ranked it. */
const rankingRecord = argument(
  "--ranking",
  "artifacts/compiler/node-field-elision/node-field-elision.json",
);

function run(script, args, note) {
  const started = performance.now();
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMegabytes}`, resolve(repositoryRoot, script), ...args],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (child.status !== 0) throw new Error(`${note} failed with status ${child.status}.`);
  process.stdout.write(child.stdout);
  return Number(((performance.now() - started) / 1000).toFixed(1));
}

const readJson = async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));

async function measure(label, input, variant, suffix = "") {
  const output = `${workDirectory}/${label}-${variant}${suffix}.json`;
  const wallSeconds = run(
    "scripts/measure-hierarchy-relocation.mjs",
    ["--input", input, "--variant", variant, "--label", label, "--output", output],
    `${label}/${variant}`,
  );
  return { ...(await readJson(output)), wallSeconds };
}

/**
 * The upper bound the ranking record published for this model, so the record
 * can state plainly how much of it survived once the sidecar was paid for.
 */
async function upperBound(label) {
  let ranking;
  try {
    ranking = await readJson(rankingRecord);
  } catch {
    return { available: false, reason: "the node-field ranking record is not readable" };
  }
  const model = ranking.models?.find((entry) => entry.label === label);
  const lever = model?.ranking?.find((entry) => entry.lever === "hierarchy-node-relocation");
  if (!lever) return { available: false, reason: `that record measured no ${label} model` };
  return {
    available: true,
    source: rankingRecord,
    basis: lever.basis,
    upperBoundBytes: lever.upperBoundBytes,
    upperBoundPercent: lever.upperBoundPercent,
  };
}

const percent = (part, whole) => Number(((part / whole) * 100).toFixed(2));

const recorded = [];
for (const { label, input } of models) {
  const baseline = await measure(label, input, "baseline");
  const relocated = await measure(label, input, "relocated");
  const repeat = await measure(label, input, "relocated", "-repeat");
  const sidecarBytes = (relocated.sidecar.json?.bytes ?? 0) + (relocated.sidecar.columns?.bytes ?? 0);
  const documentSaved = baseline.document.bytes - relocated.document.bytes;
  const packageSaved = baseline.packageBytes - relocated.packageBytes;
  const nodesRemoved = baseline.counts.gltfNodeCount - relocated.counts.gltfNodeCount;
  recorded.push({
    label,
    input,
    sourceStructure: baseline.sourceStructure,
    occurrenceCount: baseline.counts.occurrenceCount,
    renderableOccurrenceCount: baseline.counts.renderableOccurrenceCount,
    baseline: {
      options: baseline.options,
      documentBytes: baseline.document.bytes,
      documentSha256: baseline.document.sha256,
      packageBytes: baseline.packageBytes,
      packageDigest: baseline.packageDigest,
      gltfNodeCount: baseline.counts.gltfNodeCount,
      compileSeconds: baseline.timings.compileSeconds,
      peakResidentBytes: baseline.peakResidentBytes,
      nodeSplit: baseline.nodeSplit,
    },
    relocated: {
      options: relocated.options,
      documentBytes: relocated.document.bytes,
      documentSha256: relocated.document.sha256,
      packageBytes: relocated.packageBytes,
      packageDigest: relocated.packageDigest,
      gltfNodeCount: relocated.counts.gltfNodeCount,
      compileSeconds: relocated.timings.compileSeconds,
      peakResidentBytes: relocated.peakResidentBytes,
      nodeSplit: relocated.nodeSplit,
      sidecar: { ...relocated.sidecar, totalBytes: sidecarBytes },
    },
    // Where the document's change came from. The remainder is the pointer the
    // document gains; a ledger that does not close means something else moved.
    documentLedger: {
      nodeArrayBytes: relocated.nodeSplit.nodeArrayBytes - baseline.nodeSplit.nodeArrayBytes,
      sceneArrayBytes: relocated.nodeSplit.sceneArrayBytes - baseline.nodeSplit.sceneArrayBytes,
      remainderBytes:
        -documentSaved -
        (relocated.nodeSplit.nodeArrayBytes - baseline.nodeSplit.nodeArrayBytes) -
        (relocated.nodeSplit.sceneArrayBytes - baseline.nodeSplit.sceneArrayBytes),
    },
    delta: {
      documentBytes: -documentSaved,
      documentPercent: -percent(documentSaved, baseline.document.bytes),
      packageBytes: -packageSaved,
      packagePercent: -percent(packageSaved, baseline.packageBytes),
      sidecarBytes,
      // What the document shed minus what the sidecar costs; the package delta
      // must equal it, or some other resource moved too.
      netBytes: -(documentSaved - sidecarBytes),
      netMatchesPackage: documentSaved - sidecarBytes === packageSaved,
      relocatedNodes: nodesRemoved,
      relocatedNodePercent: percent(nodesRemoved, baseline.counts.gltfNodeCount),
    },
    upperBound: await upperBound(label),
    determinism: {
      repeats: 2,
      documentDigests: [relocated.document.sha256, repeat.document.sha256],
      packageDigests: [relocated.packageDigest, repeat.packageDigest],
      sidecarDigests: [
        relocated.sidecar.columns?.sha256 ?? null,
        repeat.sidecar.columns?.sha256 ?? null,
      ],
      identical:
        relocated.document.sha256 === repeat.document.sha256 &&
        relocated.packageDigest === repeat.packageDigest &&
        relocated.sidecar.columns?.sha256 === repeat.sidecar.columns?.sha256,
    },
  });
}

const roundTripModel = models.find((model) => model.label === roundTripLabel);
if (!roundTripModel) throw new TypeError(`--round-trip names no measured model: ${roundTripLabel}`);
const roundTripPath = `${workDirectory}/${roundTripLabel}-roundtrip.json`;
run(
  "scripts/verify-hierarchy-relocation-roundtrip.mjs",
  ["--input", roundTripModel.input, "--label", roundTripLabel, "--output", roundTripPath],
  `${roundTripLabel} round trip`,
);
const roundTrip = await readJson(roundTripPath);

const evidence = {
  schemaVersion: "naru.hierarchy-relocation.1",
  recordedAt: new Date().toISOString(),
  mode: "relocated-hierarchy-package-comparison",
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
  },
  method: {
    variants:
      "`baseline` is today's default output; `relocated` adds only " +
      "relocateHierarchyNodes. Both use the engineering baseline's option " +
      "policy (compact JSON, omitted resource names, spatial index, " +
      "leaf-anchor payload order).",
    packageBytes:
      "Every resource the build report declares, the document included, so the " +
      "sidecar the lever adds is charged against the bytes it removes.",
    roundTrip:
      "Both packages are decoded through the runtime loader. The assembly tree " +
      "must come back entry for entry -- names, depths, identities -- and every " +
      "occurrence must keep its world transform bit for bit.",
  },
  models: recorded,
  roundTrip,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  resolve(artifactDirectory, "hierarchy-relocation.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
for (const model of recorded) {
  console.log(
    `[relocation] ${model.label}: document ${model.delta.documentPercent}%, ` +
      `package ${model.delta.packagePercent}%, sidecar ${model.delta.sidecarBytes} B, ` +
      `${model.delta.relocatedNodes} nodes relocated`,
  );
}
console.log(
  `[relocation] wrote ${relative(repositoryRoot, artifactDirectory)}; ` +
    `round trip ${roundTrip.mismatchCount} mismatches`,
);
