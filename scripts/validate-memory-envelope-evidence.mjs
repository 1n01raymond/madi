// Validates the whole-process memory envelope records for the sixty5 IFC
// federation, on every engine the protocol has been repeated on. The point of
// the record is that every byte value names its owner, its lifetime, and how it
// was collected, so this validator checks the ledger definition as strictly as
// it checks the samples, and recomputes every claimed target outcome from the
// samples rather than trusting the recorded verdict.
//
// Two records are validated against one table: the Blink original and the Gecko
// repeat. Everything the engine cannot change -- the package, the phases, the
// budgets, the resident set those budgets admit -- is pinned once and then
// asserted equal across the two families, so the pair cannot drift apart
// silently. What the engine does change is declared per family: which heap
// estimators exist, and which predeclared targets the engine met.
//
// Digests, counts, budgets, and target verdicts below are pinned on purpose. A
// re-record that changes them must update this file deliberately -- never loosen
// a check to make a run pass, and never retarget the package digest silently:
// the sixty5 package this host compiles is host-local, and swapping it changes
// what the record is evidence of.
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
const GIB = 1024 * 1024 * 1024;

const families = [
  {
    id: "blink",
    directory: "artifacts/memory/sixty5-envelope",
    browserId: "chrome",
    engine: "Blink",
    // Blink reports performance.memory only behind this switch, so the record
    // has to show it was passed for the heap figures to mean anything.
    requiredLaunchArguments: ["--enable-precise-memory-info"],
    unsupportedLedgerIds: ["gpu.driverAllocationBytes"],
    targets: {
      "residency-decoded-within-budget": { met: true },
      "residency-gpu-within-budget": { met: true },
      "process-working-set-ceiling": { met: true, ceilingBytes: 4 * GIB },
      "js-heap-ceiling": { met: true, ceilingBytes: 2 * GIB },
      "forced-low-remains-usable": { met: true },
    },
  },
  {
    id: "gecko",
    directory: "artifacts/memory/sixty5-envelope-gecko",
    browserId: "firefox",
    engine: "Gecko",
    requiredLaunchArguments: [],
    // This engine exposes neither performance.memory nor
    // measureUserAgentSpecificMemory, so both page figures join the GPU driver
    // allocation as categories the record accounts for without measuring.
    unsupportedLedgerIds: [
      "gpu.driverAllocationBytes",
      "page.usedJsHeapBytes",
      "page.uaMemoryBytes",
    ],
    targets: {
      "residency-decoded-within-budget": { met: true },
      "residency-gpu-within-budget": { met: true },
      // Pinned NOT met, and not to be relaxed. This engine holds roughly twice
      // the resident pages Blink holds for a byte-identical resident set, and
      // exceeds the ceiling in the forced-low profile too, where the renderer
      // is holding 8 MB of geometry. The ceiling stays at the figure the Blink
      // record declared so the gap stays visible.
      "process-working-set-ceiling": { met: false, ceilingBytes: 4 * GIB },
      "heap-estimators-absent-not-zero": { met: true },
      "forced-low-remains-usable": { met: true },
    },
  },
];

const expectedPhases = [
  "hierarchy",
  "coarse-frame",
  "budget-limited",
  "navigation",
  "selection",
  "eviction",
];
// The phases whose resident set has settled. The coarse frame is sampled as
// soon as a first frame exists, so how many target chunks landed by then is a
// race -- it varies between runs of one engine, and is therefore not something
// to demand of two.
const settledPhases = ["budget-limited", "navigation", "selection", "eviction"];

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

/** Validates one record against the shared protocol and its own family row. */
function validateFamily(family) {
  const recordDirectory = resolve(repositoryRoot, family.directory);
  const record = JSON.parse(readFileSync(resolve(recordDirectory, "memory-envelope.json"), "utf8"));
  const at = (label) => `${family.id}: ${label}`;

  expect(record.schemaVersion, "naru.memory-envelope.1", at("schemaVersion"));
  expect(record.mode, "headed-phase-sampled-memory-ledger", at("mode"));
  // Every phase pauses for sampling, so this record's milestone offsets are not
  // comparable with the timing records.
  check(
    typeof record.timingComparability === "string" &&
      record.timingComparability.includes("perturbed"),
    at("the record must state that its milestone offsets are perturbed by memory sampling"),
  );
  expect(record.browser.id, family.browserId, at("browser.id"));
  expect(record.browser.engine, family.engine, at("browser.engine"));
  expect(record.browser.headless, false, at("browser.headless"));
  expect(record.browser.viewport.width, 1320, at("browser.viewport.width"));
  expect(record.browser.viewport.height, 1000, at("browser.viewport.height"));
  check(
    JSON.stringify(record.browser.launchArguments) ===
      JSON.stringify(family.requiredLaunchArguments),
    at(`browser.launchArguments must be ${JSON.stringify(family.requiredLaunchArguments)}`),
  );
  expect(record.host.platform, "win32", at("host.platform"));

  // Pinned to the package the sixty5 first-frame records also serve, so all of
  // them describe the same bytes. Not to be retargeted to make a run pass.
  expect(
    record.source.packageDigest,
    "a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347",
    at("source.packageDigest"),
  );
  expect(
    record.source.buildReport,
    "artifacts/ifc/sixty5/build-report.json",
    at("source.buildReport"),
  );
  const resourceBytes = Object.fromEntries(
    record.source.resources.map((resource) => [resource.path, resource.bytes]),
  );
  expect(resourceBytes["scene.gltf"], 448_823_852, at("scene.gltf bytes"));
  expect(resourceBytes["scene.bin"], 120_707_064, at("scene.bin bytes"));
  expect(resourceBytes["properties.bin"], 31_179_862, at("properties.bin bytes"));

  check(
    JSON.stringify(record.method.phases) === JSON.stringify(expectedPhases),
    at(`method.phases must be ${expectedPhases.join(", ")}`),
  );
  expect(record.method.runsPerProfile, 3, at("method.runsPerProfile"));
  const profiles = Object.fromEntries(
    record.method.profiles.map((profile) => [profile.name, profile]),
  );
  expect(profiles["default-budget"]?.budgetBytes, 67_108_864, at("default budget bytes"));
  expect(profiles["default-budget"]?.residencyMiB, null, at("default profile residencyMiB"));
  expect(profiles["forced-low-budget"]?.budgetBytes, 8_388_608, at("forced-low budget bytes"));
  expect(profiles["forced-low-budget"]?.residencyMiB, 8, at("forced-low profile residencyMiB"));
  check(
    typeof record.method.evictionQuiescence === "string" &&
      record.method.evictionQuiescence.length > 0,
    at("method.evictionQuiescence must state how the eviction sample treats a scheduler that " +
      "never goes quiet"),
  );

  failures.push(...ledgerDefinitionFailures(record.ledgerCategories).map(at));
  // The categories this engine cannot measure must stay unmeasurable: recording
  // a zero there would be the one fabrication this record exists to avoid.
  const unsupported = record.ledgerCategories
    .filter((category) => category.method === "unsupported")
    .map((category) => category.id)
    .sort();
  check(
    JSON.stringify(unsupported) === JSON.stringify([...family.unsupportedLedgerIds].sort()),
    at(`unsupported ledger categories must be exactly ${family.unsupportedLedgerIds.join(", ")}, ` +
      `found ${unsupported.join(", ") || "none"}`),
  );

  const expectedTargets = Object.keys(family.targets);
  check(
    JSON.stringify(record.declaredTargets.map((target) => target.id)) ===
      JSON.stringify(expectedTargets),
    at(`declaredTargets must be exactly ${expectedTargets.join(", ")}`),
  );
  for (const target of record.declaredTargets) {
    check(
      typeof target.statement === "string" && target.statement.length > 0,
      at(`declared target ${target.id} needs a statement`),
    );
    check(
      typeof target.metric === "string" && target.metric.length > 0,
      at(`declared target ${target.id} needs a metric`),
    );
    expect(
      target.ceilingBytes,
      family.targets[target.id]?.ceilingBytes,
      at(`declared target ${target.id} ceilingBytes`),
    );
  }
  return { record, recordDirectory, profiles, at };
}

/** Validates the runs, targets, screenshots and summary of one record. */
function validateRuns(family, { record, recordDirectory, profiles, at }) {
  expect(record.runs.length, 6, at("run count"));
  const byProfile = { "default-budget": [], "forced-low-budget": [] };
  for (const run of record.runs) {
    check(run.profile in byProfile, at(`run profile ${run.profile} is not declared`));
    byProfile[run.profile]?.push(run);
  }
  expect(byProfile["default-budget"].length, 3, at("default-budget runs"));
  expect(byProfile["forced-low-budget"].length, 3, at("forced-low-budget runs"));

  for (const run of record.runs) {
    const budgetBytes = profiles[run.profile]?.budgetBytes;
    failures.push(...runShapeFailures(run, expectedPhases, budgetBytes).map(at));
    for (const sample of run.samples) {
      const label = `${run.profile}#${run.runIndex} ${sample.phase}`;
      failures.push(...sampleFailures(label, sample).map(at));
      failures.push(...consistencyFailures(label, sample, run.budgetBytes).map(at));
    }
  }

  // An eviction cycle is one of the states this record claims to cover, so at
  // least one run has to have gone through one; a run that never needed to evict
  // says so in its own reason, which runShapeFailures already required.
  check(
    record.runs.some((run) => run.eviction.observed === true),
    at("no run observed an eviction cycle; the record cannot claim that phase"),
  );

  // Recompute each target from the samples; a recorded verdict is not evidence.
  const ceilingOf = (id) =>
    record.declaredTargets.find((target) => target.id === id)?.ceilingBytes;
  const recomputed = recomputeTargets(record, {
    workingSetBytes: ceilingOf("process-working-set-ceiling"),
    usedJsHeapBytes: ceilingOf("js-heap-ceiling"),
  });
  expect(
    record.targetOutcomes.length,
    Object.keys(family.targets).length,
    at("every declared target needs an outcome"),
  );
  for (const outcome of record.targetOutcomes) {
    const declared = family.targets[outcome.id];
    check(declared !== undefined, at(`targetOutcomes reports ${outcome.id}, which is not declared`));
    expect(outcome.met, recomputed[outcome.id], at(`target ${outcome.id} recomputed from samples`));
    // Pinned in both directions: a target this engine met must stay met, and the
    // one it missed must stay missed until a re-record is read and this table is
    // changed deliberately.
    expect(outcome.met, declared?.met, at(`target ${outcome.id} recorded verdict`));
  }

  // Screenshots are the proof that the forced-low budget still renders
  // something; check the committed bytes are the bytes the record describes.
  for (const run of record.runs) {
    for (const [name, shot] of Object.entries(run.screenshots)) {
      const label = at(`${run.profile}#${run.runIndex} ${name}`);
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
    // A capture requested behind a blocking sample is serviced only once the
    // drain releases the compositor, which once filed a budget-limited frame
    // under the coarse phase. Identical bytes are the signature of that mistake.
    const coarse = run.screenshots["coarse-frame.png"];
    const budgeted = run.screenshots["budget-limited.png"];
    check(
      !coarse || !budgeted || coarse.sha256 !== budgeted.sha256,
      at(`${run.profile}#${run.runIndex}: the coarse and budget-limited captures are the same ` +
        "image, so one of them does not depict the phase it is filed under"),
    );
  }
  check(
    byProfile["forced-low-budget"].some((run) => "coarse-frame.png" in run.screenshots),
    at("the forced-low profile must carry a coarse-frame capture proving it still renders"),
  );

  failures.push(...summaryFailures(record, "default-budget", record.summary.defaultBudget).map(at));
  failures.push(
    ...summaryFailures(record, "forced-low-budget", record.summary.forcedLowBudget).map(at),
  );
  check(
    record.summary.forcedLowBudget.medianResidentDecodedBytes <=
      profiles["forced-low-budget"].budgetBytes,
    at("the forced-low profile must keep decoded residency inside its own budget"),
  );
}

/**
 * The resident set a budget admits is a property of the package and the
 * scheduler, not of the engine that runs them. Reducing each settled phase to
 * one signature per family and requiring the signatures to be equal is the
 * check that keeps that claim honest: it is what makes the pair evidence that
 * the figure does not depend on one browser's own estimator.
 */
function residentSignatures(record, at) {
  const signatures = new Map();
  for (const run of record.runs) {
    for (const sample of run.samples) {
      if (!settledPhases.includes(sample.phase)) continue;
      const key = `${run.profile} ${sample.phase}`;
      const signature = JSON.stringify({
        decodedBytes: sample.residency.decodedBytes,
        gpuBytes: sample.residency.gpuBytes,
        chunksReady: sample.residency.chunksReady,
        gpuBufferBytes: sample.renderer.gpuBufferBytes,
      });
      const seen = signatures.get(key);
      if (seen === undefined) signatures.set(key, signature);
      else if (seen !== signature) {
        check(false, at(`${key}: settled resident set differs between runs, ${seen} vs ${signature}`));
      }
    }
  }
  return signatures;
}

/**
 * The application-level result of a run is engine-independent as well: the
 * same centre pick, the same source-aware property resolution, the same
 * status line, and the same number of colder groups displaced when the
 * pinned selection is admitted. One signature per profile, compared across
 * families, keeps those from drifting apart unnoticed.
 */
function outcomeSignatures(record, at) {
  const signatures = new Map();
  for (const run of record.runs) {
    const settled = run.samples.find((sample) => sample.phase === "budget-limited");
    const signature = JSON.stringify({
      selectedObjectId: run.selection.selectedObjectId,
      selectionResidency: run.selection.selectionResidency,
      propertyState: run.selection.semanticProperties.state,
      propertyEntries: run.selection.semanticProperties.entryCount,
      propertyLabel: run.selection.semanticProperties.countLabel,
      evictionSource: run.eviction.source,
      evictedTargetMeshCount: run.eviction.evictedTargetMeshCount,
      statusText: settled === undefined ? null : settled.statusText,
    });
    const seen = signatures.get(run.profile);
    if (seen === undefined) signatures.set(run.profile, signature);
    else if (seen !== signature) {
      check(
        false,
        at(`${run.profile}: settled run outcome differs between runs, ${seen} vs ${signature}`),
      );
    }
  }
  return signatures;
}
const validated = families.map((family) => {
  const context = validateFamily(family);
  validateRuns(family, context);
  return {
    family,
    ...context,
    signatures: residentSignatures(context.record, context.at),
    outcomes: outcomeSignatures(context.record, context.at),
  };
});

const [reference, ...repeats] = validated;
for (const repeat of repeats) {
  for (const [key, signature] of reference.signatures) {
    const observed = repeat.signatures.get(key);
    check(
      observed !== undefined,
      `${repeat.family.id}: ${key} has no settled sample to compare with ${reference.family.id}`,
    );
    if (observed !== undefined) {
      expect(
        observed,
        signature,
        `${repeat.family.id} vs ${reference.family.id}: resident set at ${key}`,
      );
    }
  }
  expect(
    repeat.signatures.size,
    reference.signatures.size,
    `${repeat.family.id}: settled phase count against ${reference.family.id}`,
  );
  for (const [profile, signature] of reference.outcomes) {
    expect(
      repeat.outcomes.get(profile),
      signature,
      `${repeat.family.id} vs ${reference.family.id}: run outcome in ${profile}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Memory envelope evidence is invalid:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
for (const { family, record } of validated) {
  const met = record.targetOutcomes.filter((outcome) => outcome.met).length;
  console.log(
    `Memory envelope evidence OK (${family.engine}): ${record.runs.length} runs, ` +
      `${record.ledgerCategories.length} ledger categories, ` +
      `${met}/${record.targetOutcomes.length} predeclared targets met; ` +
      `default working set ${record.summary.defaultBudget.medianWorkingSetBytes} B, ` +
      `forced-low ${record.summary.forcedLowBudget.medianWorkingSetBytes} B.`,
  );
}
console.log(
  `Resident set identical across ${validated.length} engines at ` +
    `${reference.signatures.size} settled profile/phase points.`,
);
