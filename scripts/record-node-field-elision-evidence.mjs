/**
 * Records where a compiled glTF document spends its bytes, and what the two
 * opt-in node-size levers actually recover on a real federation.
 *
 * Issue #85 asks for the measurement before the choice: the per-field split of
 * the engineering baseline's document, the levers ranked against that split
 * rather than against a small fixture, and proof that eliding a field changes
 * the document without changing what loads. Each variant compiles in its own
 * process because a federation-scale compile peaks near 3 GB; the round-trip
 * proof runs on Digital Hub, the largest model whose two documents fit in one
 * process at once.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { relative, resolve } from "node:path";

import { NODE_FIELD_VARIANTS } from "./lib/node-field-variants.mjs";

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
  : ["digital-hub=output/ifc/digital-hub-split4", "engineering-baseline=output/ifc/engineering-baseline"]
).map((entry) => {
  const at = entry.indexOf("=");
  if (at <= 0) throw new TypeError(`--model expects <label>=<split directory>, got ${entry}`);
  return { label: entry.slice(0, at), input: entry.slice(at + 1) };
});
const workDirectory = argument("--work", "output/node-fields");
const artifactDirectory = resolve(repositoryRoot, argument("--output", "artifacts/compiler/node-field-elision"));
/** Digital Hub is small enough to hold two decoded documents at once. */
const roundTripLabel = argument("--round-trip", "digital-hub");
/** The variant recompiled to show a repeat run is byte-identical. */
const determinismVariant = "both";
const heapMegabytes = argument("--heap-mb", "6144");

function run(script, args, note) {
  const started = performance.now();
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMegabytes}`, resolve(repositoryRoot, script), ...args],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (child.status !== 0) {
    throw new Error(`${note} failed with status ${child.status}.`);
  }
  process.stdout.write(child.stdout);
  return Number(((performance.now() - started) / 1000).toFixed(1));
}

const readJson = async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));

/** The option values a directory's own build report must show for its package
 * digest to be comparable with the `baseline` variant compiled here. */
const PIPELINE_OPTIONS = {
  jsonFormatting: "compact",
  resourceNames: "omitted",
  targetPayloadOrder: "spatial-leaf-anchor-v1",
  targetChunkByteBudget: 524_288,
};

/**
 * Compares the default variant against the package the sanctioned compile
 * pipeline already wrote next to the split, when that package used the same
 * options. Equality is what "the default output is unchanged" means at
 * federation scale; a directory compiled under another policy is reported as
 * not comparable rather than quietly skipped.
 */
async function comparePipeline(input, baselineDigest) {
  let report;
  try {
    report = await readJson(`${input}/build-report.json`);
  } catch {
    return { available: false, reason: "the split directory carries no build report" };
  }
  const mismatched = Object.entries(PIPELINE_OPTIONS)
    .filter(([key, value]) => report.options?.[key] !== value)
    .map(([key]) => key);
  if (mismatched.length > 0) {
    return {
      available: false,
      reason: `the directory's package used other options (${mismatched.join(", ")})`,
      packageDigest: report.output.packageDigest,
    };
  }
  return {
    available: true,
    packageDigest: report.output.packageDigest,
    matchesDefaultVariant: report.output.packageDigest === baselineDigest,
  };
}

async function measure(label, input, variant, suffix = "") {
  const output = `${workDirectory}/${label}-${variant}${suffix}.json`;
  const wallSeconds = run(
    "scripts/measure-node-fields.mjs",
    ["--input", input, "--variant", variant, "--label", label, "--output", output],
    `${label}/${variant}`,
  );
  return { ...(await readJson(output)), wallSeconds };
}

const fieldBytes = (measurement, field) => (
  measurement.fields.find((entry) => entry.field === field)?.bytes ?? 0
);

/**
 * Ranks the levers against one model's own document.
 *
 * A measured entry is a real compile difference. A candidate entry is an upper
 * bound read off the byte split -- the most a lever could ever recover if it
 * removed the field outright -- and is never presented as a saving.
 */
function rank(baseline, variants) {
  const total = baseline.measurement.compactBytes;
  const share = (bytes) => Number(((bytes / total) * 100).toFixed(2));
  // `both` is the combination, not a third lever; ranking it beside its own
  // halves would count the same bytes twice.
  const measured = Object.keys(NODE_FIELD_VARIANTS)
    .filter((variant) => variant !== "baseline" && variant !== "both")
    .map((variant) => {
      const bytes = baseline.measurement.rawBytes - variants[variant].measurement.rawBytes;
      return {
        lever: variant,
        kind: "measured",
        implemented: true,
        documentBytes: variants[variant].measurement.rawBytes,
        savedBytes: bytes,
        savedPercent: share(bytes),
      };
    });
  const { measurement } = baseline;
  const candidates = [
    {
      lever: "hierarchy-node-relocation",
      basis: "every byte of every node that carries no mesh",
      bytes: measurement.classes.meshless.bytes,
    },
    {
      lever: "tag-set-interning",
      basis: `extras.madi.tags across ${measurement.distinctTagSets} distinct sets`,
      bytes: fieldBytes(measurement, "extras.madi.tags"),
    },
    {
      lever: "default-visibility-elision",
      basis: `extras.madi.initialVisibility, default on ${measurement.facts.defaultVisibility} nodes`,
      bytes: fieldBytes(measurement, "extras.madi.initialVisibility"),
    },
    {
      lever: "node-name-elision",
      basis: `name across ${measurement.distinctNames} distinct names`,
      bytes: fieldBytes(measurement, "name"),
    },
  ].map((entry) => ({
    lever: entry.lever,
    kind: "candidate-upper-bound",
    implemented: false,
    basis: entry.basis,
    upperBoundBytes: entry.bytes,
    upperBoundPercent: share(entry.bytes),
  }));
  return [...measured, ...candidates].sort((left, right) => (
    (right.savedBytes ?? right.upperBoundBytes) - (left.savedBytes ?? left.upperBoundBytes)
  ));
}

const recorded = [];
for (const { label, input } of models) {
  const variants = {};
  for (const variant of Object.keys(NODE_FIELD_VARIANTS)) {
    variants[variant] = await measure(label, input, variant);
  }
  const repeat = await measure(label, input, determinismVariant, "-repeat");
  const baseline = variants.baseline;
  recorded.push({
    label,
    input,
    sourceStructure: baseline.sourceStructure,
    counts: baseline.counts,
    document: {
      bytes: baseline.measurement.rawBytes,
      nodeArrayBytes: baseline.measurement.elementBytes,
      nodeArrayPercent: Number(
        ((baseline.measurement.elementBytes / baseline.measurement.compactBytes) * 100).toFixed(2),
      ),
      nodeCount: baseline.measurement.elementCount,
      topLevel: baseline.measurement.topLevel,
      nodeFields: baseline.measurement.fields,
      nodeClasses: baseline.measurement.classes,
      nodeFacts: baseline.measurement.facts,
      distinctTagSets: baseline.measurement.distinctTagSets,
      distinctNames: baseline.measurement.distinctNames,
    },
    variants: Object.fromEntries(
      Object.entries(variants).map(([variant, value]) => [variant, {
        options: value.options,
        documentBytes: value.measurement.rawBytes,
        packageDigest: value.packageDigest,
        compileSeconds: value.compileSeconds,
      }]),
    ),
    determinism: {
      variant: determinismVariant,
      repeats: 2,
      packageDigests: [variants[determinismVariant].packageDigest, repeat.packageDigest],
      documentBytes: [
        variants[determinismVariant].measurement.rawBytes,
        repeat.measurement.rawBytes,
      ],
      identical:
        variants[determinismVariant].packageDigest === repeat.packageDigest &&
        variants[determinismVariant].measurement.rawBytes === repeat.measurement.rawBytes,
    },
    combined: {
      variant: "both",
      documentBytes: variants.both.measurement.rawBytes,
      savedBytes: baseline.measurement.rawBytes - variants.both.measurement.rawBytes,
      savedPercent: Number(
        (((baseline.measurement.rawBytes - variants.both.measurement.rawBytes)
          / baseline.measurement.compactBytes) * 100).toFixed(2),
      ),
      // The levers touch disjoint members, so their savings must add exactly.
      additive:
        baseline.measurement.rawBytes - variants.both.measurement.rawBytes ===
        (baseline.measurement.rawBytes - variants.identifiers.measurement.rawBytes) +
          (baseline.measurement.rawBytes - variants.transforms.measurement.rawBytes),
    },
    pipelinePackage: await comparePipeline(input, baseline.packageDigest),
    ranking: rank(baseline, variants),
  });
}

const roundTripModel = models.find((model) => model.label === roundTripLabel);
if (!roundTripModel) throw new TypeError(`--round-trip names no measured model: ${roundTripLabel}`);
const roundTripPath = `${workDirectory}/${roundTripLabel}-roundtrip.json`;
run(
  "scripts/verify-node-field-roundtrip.mjs",
  ["--input", roundTripModel.input, "--label", roundTripLabel, "--output", roundTripPath],
  `${roundTripLabel} round trip`,
);
const roundTrip = await readJson(roundTripPath);

const evidence = {
  schemaVersion: "naru.node-field-elision.1",
  recordedAt: new Date().toISOString(),
  mode: "compiled-document-byte-split",
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
  },
  method: {
    byteAccounting:
      "Compact-equivalent: whitespace outside strings is ignored, and a member's " +
      "key, colon, value, and following comma are all charged to that member.",
    sharedOptions:
      "Every variant compiles with the engineering baseline's option policy " +
      "(compact JSON, omitted resource names, spatial index, leaf-anchor payload order).",
    roundTrip:
      "Both documents are decoded through the runtime loader and compared " +
      "occurrence by occurrence; transforms must match bit for bit.",
  },
  models: recorded,
  roundTrip,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  resolve(artifactDirectory, "node-field-elision.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
for (const model of recorded) {
  const top = model.ranking[0];
  console.log(
    `[node-fields] ${model.label}: document ${model.document.bytes} B, nodes ` +
      `${model.document.nodeArrayPercent}%, top lever ${top.lever} ` +
      `${top.savedBytes ?? top.upperBoundBytes} B`,
  );
}
console.log(
  `[node-fields] wrote ${relative(repositoryRoot, artifactDirectory)}; ` +
    `round trip ${roundTrip.mismatchCount} mismatches`,
);
