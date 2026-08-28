// Validates the whole-process memory envelope record for the sixty5 IFC
// federation. The point of the record is that every byte value names its owner,
// its lifetime, and how it was collected, so this validator checks the ledger
// definition as strictly as it checks the samples, and recomputes every claimed
// target outcome from the samples rather than trusting the recorded verdict.
//
// Digests, counts, and budgets below are pinned on purpose. A re-record that
// changes them must update this file deliberately -- never loosen a check to
// make a run pass, and never retarget the package digest silently: the sixty5
// package this host compiles is host-local, and swapping it changes what the
// record is evidence of.
//
// The record-shape rules live in scripts/lib/memory-envelope.mjs so they can be
// unit-tested against fixtures; this file owns the pins and the file system.
//
//   pnpm memory:envelope:check
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  consistencyFailures,
  ledgerDefinitionFailures,
  recomputeTargets,
  runShapeFailures,
  sampleFailures,
  summaryFailures,
} from "./lib/memory-envelope.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const recordDirectory = resolve(repositoryRoot, "artifacts/memory/sixty5-envelope");
const recordPath = resolve(recordDirectory, "memory-envelope.json");

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
function expect(actual, expected, label) {
  check(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
  );
}

const record = JSON.parse(readFileSync(recordPath, "utf8"));

expect(record.schemaVersion, "naru.memory-envelope.1", "schemaVersion");
expect(record.mode, "headed-phase-sampled-memory-ledger", "mode");
// Sampling the agent cluster forces a collection that costs seconds, so this
// record's milestone offsets are not comparable with the timing records.
check(
  typeof record.timingComparability === "string" &&
    record.timingComparability.includes("perturbed"),
  "The record must state that its milestone offsets are perturbed by memory sampling.",
);
expect(record.browser.id, "chrome", "browser.id");
expect(record.browser.engine, "Blink", "browser.engine");
expect(record.browser.headless, false, "browser.headless");
expect(record.browser.viewport.width, 1320, "browser.viewport.width");
expect(record.browser.viewport.height, 1000, "browser.viewport.height");
check(
  record.browser.launchArguments.includes("--enable-precise-memory-info"),
  "performance.memory needs --enable-precise-memory-info; the record must show it was passed.",
);
expect(record.host.platform, "win32", "host.platform");

// Pinned to the package the sixty5 first-frame record also serves, so the two
// records describe the same bytes. Not to be retargeted to make a run pass.
expect(
  record.source.packageDigest,
  "a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347",
  "source.packageDigest",
);
expect(record.source.buildReport, "artifacts/ifc/sixty5/build-report.json", "source.buildReport");
const resourceBytes = Object.fromEntries(
  record.source.resources.map((resource) => [resource.path, resource.bytes]),
);
expect(resourceBytes["scene.gltf"], 448_823_852, "scene.gltf bytes");
expect(resourceBytes["scene.bin"], 120_707_064, "scene.bin bytes");
expect(resourceBytes["properties.bin"], 31_179_862, "properties.bin bytes");

const expectedPhases = [
  "hierarchy",
  "coarse-frame",
  "budget-limited",
  "navigation",
  "selection",
  "eviction",
];
check(
  JSON.stringify(record.method.phases) === JSON.stringify(expectedPhases),
  `method.phases must be ${expectedPhases.join(", ")}`,
);
expect(record.method.runsPerProfile, 3, "method.runsPerProfile");
const profiles = Object.fromEntries(
  record.method.profiles.map((profile) => [profile.name, profile]),
);
expect(profiles["default-budget"]?.budgetBytes, 67_108_864, "default budget bytes");
expect(profiles["default-budget"]?.residencyMiB, null, "default profile residencyMiB");
expect(profiles["forced-low-budget"]?.budgetBytes, 8_388_608, "forced-low budget bytes");
expect(profiles["forced-low-budget"]?.residencyMiB, 8, "forced-low profile residencyMiB");
check(
  typeof record.method.evictionQuiescence === "string" &&
    record.method.evictionQuiescence.length > 0,
  "method.evictionQuiescence must state how the eviction sample treats a scheduler that " +
    "never goes quiet.",
);

failures.push(...ledgerDefinitionFailures(record.ledgerCategories));
// The category that cannot be measured must stay unmeasurable: recording a
// zero there would be the one fabrication this record exists to avoid.
const driverCategory = record.ledgerCategories.find(
  (category) => category.id === "gpu.driverAllocationBytes",
);
check(driverCategory !== undefined, "The ledger must account for GPU driver allocations.");
expect(driverCategory?.method, "unsupported", "gpu.driverAllocationBytes method");

const expectedTargets = [
  "residency-decoded-within-budget",
  "residency-gpu-within-budget",
  "process-working-set-ceiling",
  "js-heap-ceiling",
  "forced-low-remains-usable",
];
check(
  JSON.stringify(record.declaredTargets.map((target) => target.id)) ===
    JSON.stringify(expectedTargets),
  `declaredTargets must be exactly ${expectedTargets.join(", ")}`,
);
for (const target of record.declaredTargets) {
  check(
    typeof target.statement === "string" && target.statement.length > 0,
    `declared target ${target.id} needs a statement`,
  );
  check(
    typeof target.metric === "string" && target.metric.length > 0,
    `declared target ${target.id} needs a metric`,
  );
}
const ceilingOf = (id) =>
  record.declaredTargets.find((target) => target.id === id)?.ceilingBytes;
expect(ceilingOf("process-working-set-ceiling"), 4 * 1024 * 1024 * 1024, "process working-set ceiling");
expect(ceilingOf("js-heap-ceiling"), 2 * 1024 * 1024 * 1024, "JavaScript heap ceiling");

expect(record.runs.length, 6, "run count");
const byProfile = { "default-budget": [], "forced-low-budget": [] };
for (const run of record.runs) {
  check(run.profile in byProfile, `run profile ${run.profile} is not declared`);
  byProfile[run.profile]?.push(run);
}
expect(byProfile["default-budget"].length, 3, "default-budget runs");
expect(byProfile["forced-low-budget"].length, 3, "forced-low-budget runs");

for (const run of record.runs) {
  const budgetBytes = profiles[run.profile]?.budgetBytes;
  failures.push(...runShapeFailures(run, expectedPhases, budgetBytes));
  for (const sample of run.samples) {
    const label = `${run.profile}#${run.runIndex} ${sample.phase}`;
    failures.push(...sampleFailures(label, sample));
    failures.push(...consistencyFailures(label, sample, run.budgetBytes));
  }
}

// An eviction cycle is one of the states this record claims to cover, so at
// least one run has to have gone through one; a run that never needed to evict
// says so in its own reason, which runShapeFailures already required.
check(
  record.runs.some((run) => run.eviction.observed === true),
  "No run observed an eviction cycle; the record cannot claim that phase.",
);

// Recompute each target from the samples; a recorded verdict is not evidence.
const recomputed = recomputeTargets(record, {
  workingSetBytes: ceilingOf("process-working-set-ceiling"),
  usedJsHeapBytes: ceilingOf("js-heap-ceiling"),
});
expect(record.targetOutcomes.length, expectedTargets.length, "every declared target needs an outcome");
for (const outcome of record.targetOutcomes) {
  check(
    outcome.id in recomputed,
    `targetOutcomes reports ${outcome.id}, which is not a declared target`,
  );
  expect(outcome.met, recomputed[outcome.id], `target ${outcome.id} recomputed from the samples`);
  check(outcome.met === true, `Predeclared target ${outcome.id} was not met.`);
}

// Screenshots are the proof that the forced-low budget still renders something;
// check the committed bytes are the bytes the record describes.
for (const run of record.runs) {
  for (const [name, shot] of Object.entries(run.screenshots)) {
    const label = `${run.profile}#${run.runIndex} ${name}`;
    let bytes;
    try {
      bytes = readFileSync(resolve(recordDirectory, shot.path));
    } catch {
      failures.push(`${label}: screenshot ${shot.path} is missing`);
      continue;
    }
    expect(bytes.byteLength, shot.bytes, `${label} byte length`);
    expect(createHash("sha256").update(bytes).digest("hex"), shot.sha256, `${label} sha256`);
  }
  // A capture requested behind the blocking memory sample is serviced only once
  // the drain releases the compositor, which once filed a budget-limited frame
  // under the coarse phase. Identical bytes are the signature of that mistake.
  const coarse = run.screenshots["coarse-frame.png"];
  const budgeted = run.screenshots["budget-limited.png"];
  check(
    !coarse || !budgeted || coarse.sha256 !== budgeted.sha256,
    `${run.profile}#${run.runIndex}: the coarse and budget-limited captures are the same image, `
      + "so one of them does not depict the phase it is filed under.",
  );
}
check(
  byProfile["forced-low-budget"].some((run) => "coarse-frame.png" in run.screenshots),
  "The forced-low profile must carry a coarse-frame capture proving it still renders.",
);

failures.push(...summaryFailures(record, "default-budget", record.summary.defaultBudget));
failures.push(...summaryFailures(record, "forced-low-budget", record.summary.forcedLowBudget));
check(
  record.summary.forcedLowBudget.medianResidentDecodedBytes <=
    profiles["forced-low-budget"].budgetBytes,
  "The forced-low profile must keep decoded residency inside its own budget.",
);

if (failures.length > 0) {
  console.error("Memory envelope evidence is invalid:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `Memory envelope evidence OK: ${record.runs.length} runs, ` +
    `${record.ledgerCategories.length} ledger categories, ` +
    `${record.declaredTargets.length} predeclared targets met; ` +
    `default working set ${record.summary.defaultBudget.medianWorkingSetBytes} B, ` +
    `forced-low ${record.summary.forcedLowBudget.medianWorkingSetBytes} B.`,
);
