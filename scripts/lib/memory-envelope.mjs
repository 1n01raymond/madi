// Record-shape rules for the whole-process memory envelope evidence.
//
// The functions here are pure: they take a parsed record (or one of its parts)
// and return failure strings. Reading the file, the pinned digests and counts,
// the on-disk screenshot checks, and the process exit live in
// scripts/validate-memory-envelope-evidence.mjs, so the rules that decide
// whether a ledger is internally honest can be unit-tested against fixtures.
//
// The rules never substitute a value they cannot find. A category that the
// platform does not expose stays `null` with a reason; a run that had nothing
// to evict says so. Turning either into a zero would make the record claim
// something it did not measure.

/**
 * How a byte figure was obtained. Every ledger category picks exactly one, so a
 * reader can tell a declared size from a counted allocation, and both from an
 * engine estimate.
 */
export const collectionMethods = new Set([
  "exact-declared",
  "exact-counted",
  "upper-bound",
  "browser-estimated",
  "os-sampled",
  "unsupported",
]);

/** A byte figure is a non-negative whole number, or an honest absence. */
export function isByteValue(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

/** The ledger must define every category it reports, and relate them soundly. */
export function ledgerDefinitionFailures(categories, minimumCategories = 18) {
  const failures = [];
  if (!Array.isArray(categories) || categories.length < minimumCategories) {
    failures.push(
      `The ledger must define at least ${minimumCategories} categories; found ` +
        `${Array.isArray(categories) ? categories.length : 0}.`,
    );
    if (!Array.isArray(categories)) return failures;
  }
  const ids = new Set(categories.map((category) => category.id));
  if (ids.size !== categories.length) failures.push("Ledger category ids must be unique.");
  for (const category of categories) {
    const label = `ledger category ${category.id}`;
    if (typeof category.owner !== "string" || category.owner.length === 0) {
      failures.push(`${label}: needs an owner`);
    }
    if (typeof category.lifetime !== "string" || category.lifetime.length === 0) {
      failures.push(`${label}: needs a lifetime`);
    }
    if (!collectionMethods.has(category.method)) {
      failures.push(`${label}: unknown collection method ${JSON.stringify(category.method)}`);
    }
    if (category.partOf !== null && !ids.has(category.partOf)) {
      failures.push(`${label}: partOf ${JSON.stringify(category.partOf)} is not a declared category`);
    }
    for (const included of category.includes ?? []) {
      if (!ids.has(included)) failures.push(`${label}: includes unknown category ${included}`);
    }
    // A category collected by no method at all must carry no number: that is
    // the whole difference between "unavailable" and "zero".
    if (category.method === "unsupported") {
      if (category.value !== null) {
        failures.push(`${label}: an unsupported category must report null, not ${category.value}`);
      }
      if (typeof category.note !== "string" || category.note.length === 0) {
        failures.push(`${label}: an unsupported category must say why it is unavailable`);
      }
    }
  }
  return failures;
}

/** Field-level rules for one sample, independent of the run it belongs to. */
export function sampleFailures(label, sample) {
  const failures = [];
  if (!Number.isSafeInteger(sample.atMilliseconds) || sample.atMilliseconds < 0) {
    failures.push(`${label}: atMilliseconds must be a non-negative whole number`);
  }
  if (sample.crossOriginIsolated !== true) {
    failures.push(`${label}: the page was not cross-origin isolated, so its memory sample is partial`);
  }
  for (const group of ["package", "residency", "renderer"]) {
    for (const [key, value] of Object.entries(sample[group] ?? {})) {
      if (typeof value === "boolean" || typeof value === "string" || value === null) continue;
      if (!isByteValue(value)) failures.push(`${label}: ${group}.${key} is not a byte value`);
    }
  }
  for (const key of ["usedJsHeapBytes", "totalJsHeapBytes", "uaMemoryBytes"]) {
    if (!isByteValue(sample.page?.[key])) failures.push(`${label}: page.${key} is not a byte value`);
  }
  if (!isByteValue(sample.process?.workingSetBytes) || !isByteValue(sample.process?.privateBytes)) {
    failures.push(`${label}: process figures are not byte values`);
  }
  if (!(sample.process?.processCount > 0)) {
    failures.push(`${label}: the browser process tree was empty when sampled`);
  }
  return failures;
}

/**
 * Totals a reader would add up must be the totals the record publishes, and no
 * sample may hold more target detail than the budget it declares.
 */
export function consistencyFailures(label, sample, runBudgetBytes) {
  const failures = [];
  const renderer = sample.renderer ?? {};
  const parts = [
    renderer.gpuVertexPoolBytes,
    renderer.gpuBatchBufferBytes,
    renderer.gpuUniformBytes,
  ];
  if (renderer.gpuBufferBytes !== null && parts.every((part) => part !== null)) {
    const sum = parts.reduce((total, part) => total + part, 0);
    if (renderer.gpuBufferBytes !== sum) {
      failures.push(
        `${label}: renderer.gpuBufferBytes ${renderer.gpuBufferBytes} is not the sum of its ` +
          `three parts (${sum}); the attachment upper bound must stay outside it`,
      );
    }
  }
  const residency = sample.residency ?? {};
  if (residency.budgetBytes !== null && residency.budgetBytes !== undefined) {
    if (residency.decodedBytes !== null && residency.decodedBytes > residency.budgetBytes) {
      failures.push(
        `${label}: decoded residency ${residency.decodedBytes} exceeds budget ${residency.budgetBytes}`,
      );
    }
    if (residency.gpuBytes !== null && residency.gpuBytes > residency.budgetBytes) {
      failures.push(
        `${label}: GPU residency ${residency.gpuBytes} exceeds budget ${residency.budgetBytes}`,
      );
    }
    if (runBudgetBytes !== undefined && residency.budgetBytes !== runBudgetBytes) {
      failures.push(
        `${label}: sampled budget ${residency.budgetBytes} is not the configured ${runBudgetBytes}`,
      );
    }
  }
  const page = sample.page ?? {};
  if (page.uaMemoryBytes === null || page.uaMemoryBytes === undefined) {
    if (typeof page.uaMemoryUnavailableReason !== "string" || page.uaMemoryUnavailableReason === "") {
      failures.push(`${label}: an absent user-agent memory sample must say why`);
    }
  } else {
    const typeTotal = Object.values(page.uaMemoryByType ?? {}).reduce((a, b) => a + b, 0);
    if (typeTotal !== page.uaMemoryBytes) {
      failures.push(
        `${label}: the user-agent memory breakdown (${typeTotal}) does not sum to ${page.uaMemoryBytes}`,
      );
    }
  }
  return failures;
}

/** Rules for one run: its phases, its console, its selection, its eviction. */
export function runShapeFailures(run, expectedPhases, budgetBytes) {
  const label = `${run.profile}#${run.runIndex}`;
  const failures = [];
  if (run.budgetBytes !== budgetBytes) {
    failures.push(`${label}: budgetBytes ${run.budgetBytes} is not the profile's ${budgetBytes}`);
  }
  const phases = run.samples.map((sample) => sample.phase);
  if (JSON.stringify(phases) !== JSON.stringify(expectedPhases)) {
    failures.push(`${label}: samples must cover ${expectedPhases.join(", ")} in order, found ${phases.join(", ")}`);
  }
  if (run.consoleIssues.length !== 0) {
    failures.push(`${label}: the browser emitted ${run.consoleIssues.length} console issues`);
  }
  const properties = run.selection?.semanticProperties;
  if (properties?.state !== "resolved" || !(properties.entryCount > 0)) {
    failures.push(`${label}: the source-aware selection did not resolve property entries`);
  }
  if (run.eviction?.observed === true) {
    if (!Number.isSafeInteger(run.eviction.evictedTargetMeshCount) ||
      run.eviction.evictedTargetMeshCount <= 0) {
      failures.push(`${label}: an observed eviction must report how many groups it evicted`);
    }
    if (run.eviction.selectionResidency !== "target") {
      failures.push(`${label}: an observed eviction must have admitted the picked chunk`);
    }
    if (run.eviction.source !== "selection" && run.eviction.source !== "probe") {
      failures.push(`${label}: an observed eviction must say which pick caused it`);
    }
  } else if (typeof run.eviction?.reason !== "string" || run.eviction.reason.length === 0) {
    failures.push(`${label}: a run that evicted nothing must say why`);
  }
  // The eviction sample is taken whether or not the scheduler went quiet, so the
  // run has to say which of the two it was; a churning budget is a result, not a
  // reason to leave the phase undescribed.
  const quiescence = run.evictionQuiescence;
  if (typeof quiescence?.settled !== "boolean") {
    failures.push(`${label}: the eviction phase must report whether the scheduler went quiet`);
  } else {
    if (!Number.isSafeInteger(quiescence.waitedMilliseconds) || quiescence.waitedMilliseconds < 0) {
      failures.push(`${label}: the eviction quiescence wait must be a non-negative whole number`);
    }
    if (
      quiescence.settled === false &&
      (typeof quiescence.reason !== "string" || quiescence.reason.length === 0)
    ) {
      failures.push(`${label}: a scheduler that never went quiet must say what kept moving`);
    }
  }
  return failures;
}

/** Lower median, so a reported figure is always one of the runs. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Recomputes every predeclared target from the samples, including the targets a
 * record does not declare -- the caller checks only the ids its own family
 * declared. A recorded verdict is
 * not evidence of itself, so the validator compares this against what the
 * recorder wrote rather than reading the verdict.
 */
export function recomputeTargets(record, ceilings) {
  const samples = record.runs.flatMap((run) => run.samples);
  const withinBudget = (read) =>
    samples.every((sample) => {
      const budget = sample.residency?.budgetBytes;
      const value = read(sample);
      return budget === null || budget === undefined || value === null || value <= budget;
    });
  const forcedLow = record.runs.filter((run) => run.profile === "forced-low-budget");
  return {
    "residency-decoded-within-budget": withinBudget((sample) => sample.residency.decodedBytes),
    "residency-gpu-within-budget": withinBudget((sample) => sample.residency.gpuBytes),
    "process-working-set-ceiling": samples.every(
      (sample) =>
        sample.process.workingSetBytes !== null &&
        sample.process.workingSetBytes <= ceilings.workingSetBytes,
    ),
    "js-heap-ceiling": samples.every(
      (sample) =>
        sample.page.usedJsHeapBytes !== null &&
        sample.page.usedJsHeapBytes <= ceilings.usedJsHeapBytes,
    ),
    // The target an engine without heap estimators declares instead. It passes
    // only if both figures are absent AND say why: a zero would satisfy neither
    // half, which is the point of measuring the absence.
    "heap-estimators-absent-not-zero": samples.every(
      (sample) =>
        sample.page.usedJsHeapBytes === null &&
        typeof sample.page.usedJsHeapUnavailableReason === "string" &&
        sample.page.usedJsHeapUnavailableReason.length > 0 &&
        sample.page.uaMemoryBytes === null &&
        typeof sample.page.uaMemoryUnavailableReason === "string" &&
        sample.page.uaMemoryUnavailableReason.length > 0,
    ),
    // Usable means the parts a person interacts with worked, not that the whole
    // model was resident: full target residency is explicitly not required.
    "forced-low-remains-usable":
      forcedLow.length > 0 &&
      forcedLow.every(
        (run) =>
          run.samples.some((sample) => sample.phase === "hierarchy") &&
          run.samples.some((sample) => sample.phase === "coarse-frame") &&
          run.selection?.semanticProperties?.state === "resolved" &&
          run.selection.semanticProperties.entryCount > 0,
      ),
  };
}

/** The summary must be the medians of the samples it claims to summarize. */
export function summaryFailures(record, profile, summary, phase = "budget-limited") {
  const failures = [];
  const samples = record.runs
    .filter((run) => run.profile === profile)
    .map((run) => run.samples.find((sample) => sample.phase === phase));
  if (samples.some((sample) => sample === undefined)) {
    failures.push(`${profile} summary: a run has no ${phase} sample to summarize`);
    return failures;
  }
  const compare = (key, values) => {
    const expected = median(values);
    if (summary[key] !== expected) {
      failures.push(`${profile} summary.${key}: expected ${expected}, found ${summary[key]}`);
    }
  };
  if (summary.runs !== samples.length) {
    failures.push(`${profile} summary.runs: expected ${samples.length}, found ${summary.runs}`);
  }
  compare("medianWorkingSetBytes", samples.map((sample) => sample.process.workingSetBytes));
  compare("medianUsedJsHeapBytes", samples.map((sample) => sample.page.usedJsHeapBytes));
  compare("medianResidentDecodedBytes", samples.map((sample) => sample.residency.decodedBytes));
  return failures;
}
