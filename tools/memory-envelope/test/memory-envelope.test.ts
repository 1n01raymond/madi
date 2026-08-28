import { describe, expect, it } from "vitest";

import {
  consistencyFailures,
  isByteValue,
  ledgerDefinitionFailures,
  median,
  recomputeTargets,
  runShapeFailures,
  sampleFailures,
  summaryFailures,
} from "../../../scripts/lib/memory-envelope.mjs";

const phases = [
  "hierarchy",
  "coarse-frame",
  "budget-limited",
  "navigation",
  "selection",
  "eviction",
];

/** A sample that passes every rule, so each test can break exactly one thing. */
function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: "budget-limited",
    atMilliseconds: 4_487,
    crossOriginIsolated: true,
    package: {
      documentBytes: 448_823_852,
      propertyIndexBytes: 0,
      spatialIndexBytes: 0,
      declaredGeometryBytes: 120_707_064,
    },
    residency: {
      budgetBytes: 67_108_864,
      decodedBytes: 66_686_508,
      gpuBytes: 66_783_808,
      budgetReached: true,
      selectionResidency: null,
    },
    renderer: {
      gpuVertexPoolBytes: 40_000_000,
      gpuBatchBufferBytes: 26_700_000,
      gpuUniformBytes: 256,
      gpuBufferBytes: 66_700_256,
      gpuAttachmentBytes: 10_560_000,
      cpuStagingBytes: 1_024,
    },
    page: {
      usedJsHeapBytes: 843_000_000,
      totalJsHeapBytes: 900_000_000,
      uaMemoryBytes: 300,
      uaMemoryByType: { JavaScript: 200, Canvas: 100 },
      uaMemoryUnavailableReason: null,
    },
    process: { processCount: 8, workingSetBytes: 1_050_000_000, privateBytes: 1_600_000_000 },
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: "default-budget",
    runIndex: 1,
    budgetBytes: 67_108_864,
    samples: phases.map((phase) => sample({ phase })),
    consoleIssues: [],
    selection: { semanticProperties: { state: "resolved", entryCount: 6 } },
    eviction: { observed: true, source: "selection", evictedTargetMeshCount: 3, selectionResidency: "target" },
    evictionQuiescence: { settled: true, waitedMilliseconds: 4_000, state: "ready|93|141|93|66783808" },
    screenshots: {},
    ...overrides,
  };
}

describe("byte values", () => {
  it("accepts a whole non-negative count and an honest absence", () => {
    expect(isByteValue(0)).toBe(true);
    expect(isByteValue(120_707_064)).toBe(true);
    expect(isByteValue(null)).toBe(true);
  });

  it("rejects negatives, fractions, and values past the safe integer range", () => {
    expect(isByteValue(-1)).toBe(false);
    expect(isByteValue(1.5)).toBe(false);
    expect(isByteValue(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(isByteValue(undefined)).toBe(false);
  });
});

describe("ledger definition", () => {
  const categories = [
    { id: "a", owner: "o", lifetime: "l", method: "exact-declared", partOf: null },
    { id: "b", owner: "o", lifetime: "l", method: "exact-counted", partOf: "a", includes: ["a"] },
    {
      id: "gpu.driverAllocationBytes",
      owner: "o",
      lifetime: "l",
      method: "unsupported",
      partOf: null,
      value: null,
      note: "No web API exposes driver allocations.",
    },
  ];

  it("accepts a ledger whose relationships all resolve", () => {
    expect(ledgerDefinitionFailures(categories, 3)).toEqual([]);
  });

  it("rejects a category collected by a method the vocabulary does not define", () => {
    const broken = [{ ...categories[0], method: "guessed" }, ...categories.slice(1)];

    expect(ledgerDefinitionFailures(broken, 3).join(" ")).toContain("unknown collection method");
  });

  it("rejects a partOf or includes that names no declared category", () => {
    const dangling = [{ ...categories[1], partOf: "missing" }];

    expect(ledgerDefinitionFailures(dangling, 1).join(" ")).toContain("is not a declared category");
    expect(
      ledgerDefinitionFailures([{ ...categories[0], includes: ["nowhere"] }], 1).join(" "),
    ).toContain("includes unknown category");
  });

  it("refuses to let an unmeasurable category report a number", () => {
    const fabricated = [{ ...categories[2], value: 0 }];

    expect(ledgerDefinitionFailures(fabricated, 1).join(" ")).toContain(
      "an unsupported category must report null",
    );
  });

  it("requires an unmeasurable category to say why", () => {
    const silent = [{ ...categories[2], note: "" }];

    expect(ledgerDefinitionFailures(silent, 1).join(" ")).toContain("must say why it is unavailable");
  });

  it("requires an owner, a lifetime, unique ids, and the declared minimum", () => {
    expect(ledgerDefinitionFailures([{ ...categories[0], owner: "" }], 1).join(" ")).toContain(
      "needs an owner",
    );
    expect(ledgerDefinitionFailures([{ ...categories[0], lifetime: "" }], 1).join(" ")).toContain(
      "needs a lifetime",
    );
    expect(ledgerDefinitionFailures([categories[0], categories[0]], 1).join(" ")).toContain(
      "ids must be unique",
    );
    expect(ledgerDefinitionFailures(categories, 18).join(" ")).toContain("at least 18 categories");
  });
});

describe("sample rules", () => {
  it("accepts a well-formed sample", () => {
    expect(sampleFailures("s", sample())).toEqual([]);
  });

  it("rejects a sample taken without cross-origin isolation", () => {
    expect(sampleFailures("s", sample({ crossOriginIsolated: false })).join(" ")).toContain(
      "not cross-origin isolated",
    );
  });

  it("rejects a negative or fractional byte figure anywhere in the sample", () => {
    const bad = sample({ renderer: { ...(sample().renderer as object), cpuStagingBytes: -8 } });

    expect(sampleFailures("s", bad).join(" ")).toContain("renderer.cpuStagingBytes is not a byte value");
  });

  it("rejects a sample whose process tree was empty", () => {
    const bad = sample({ process: { processCount: 0, workingSetBytes: 1, privateBytes: 1 } });

    expect(sampleFailures("s", bad).join(" ")).toContain("process tree was empty");
  });
});

describe("internal consistency", () => {
  it("accepts totals that add up and residency inside its budget", () => {
    expect(consistencyFailures("s", sample(), 67_108_864)).toEqual([]);
  });

  it("catches an attachment bound folded into the buffer total", () => {
    const renderer = sample().renderer as Record<string, number>;
    const folded = sample({
      renderer: {
        ...renderer,
        gpuBufferBytes: Number(renderer.gpuBufferBytes) + Number(renderer.gpuAttachmentBytes),
      },
    });

    expect(consistencyFailures("s", folded, 67_108_864).join(" ")).toContain(
      "is not the sum of its three parts",
    );
  });

  it("catches decoded or GPU residency past the budget it declares", () => {
    const residency = sample().residency as Record<string, unknown>;
    const over = sample({ residency: { ...residency, decodedBytes: 67_108_865 } });

    expect(consistencyFailures("s", over, 67_108_864).join(" ")).toContain("exceeds budget");
  });

  it("catches a sample taken under a budget the run did not configure", () => {
    expect(consistencyFailures("s", sample(), 8_388_608).join(" ")).toContain(
      "is not the configured 8388608",
    );
  });

  it("requires an absent user-agent measurement to carry a reason", () => {
    const page = sample().page as Record<string, unknown>;
    const silent = sample({
      page: { ...page, uaMemoryBytes: null, uaMemoryUnavailableReason: null },
    });

    expect(consistencyFailures("s", silent, 67_108_864).join(" ")).toContain("must say why");
    const explained = sample({
      page: { ...page, uaMemoryBytes: null, uaMemoryUnavailableReason: "not exposed here" },
    });
    expect(consistencyFailures("s", explained, 67_108_864)).toEqual([]);
  });

  it("catches a user-agent breakdown that does not sum to its own total", () => {
    const page = sample().page as Record<string, unknown>;
    const skewed = sample({ page: { ...page, uaMemoryByType: { JavaScript: 199, Canvas: 100 } } });

    expect(consistencyFailures("s", skewed, 67_108_864).join(" ")).toContain("does not sum to 300");
  });
});

describe("run shape", () => {
  it("accepts a run that covered every phase cleanly", () => {
    expect(runShapeFailures(run(), phases, 67_108_864)).toEqual([]);
  });

  it("rejects a run whose phases are missing or out of order", () => {
    const reordered = run({ samples: [...phases].reverse().map((phase) => sample({ phase })) });

    expect(runShapeFailures(reordered, phases, 67_108_864).join(" ")).toContain("in order");
  });

  it("rejects console issues and an unresolved selection", () => {
    expect(runShapeFailures(run({ consoleIssues: ["boom"] }), phases, 67_108_864).join(" ")).toContain(
      "1 console issues",
    );
    const unresolved = run({
      selection: { semanticProperties: { state: "absent", entryCount: 0 } },
    });
    expect(runShapeFailures(unresolved, phases, 67_108_864).join(" ")).toContain(
      "did not resolve property entries",
    );
  });

  it("requires an observed eviction to have evicted something, and a quiet run to explain", () => {
    const empty = run({
      eviction: { observed: true, source: "probe", evictedTargetMeshCount: 0, selectionResidency: "target" },
    });
    expect(runShapeFailures(empty, phases, 67_108_864).join(" ")).toContain("how many groups it evicted");

    const unexplained = run({ eviction: { observed: false } });
    expect(runShapeFailures(unexplained, phases, 67_108_864).join(" ")).toContain("must say why");

    const explained = run({
      eviction: { observed: false, source: null, reason: "nothing had to be evicted" },
    });
    expect(runShapeFailures(explained, phases, 67_108_864)).toEqual([]);
  });

  it("makes an observed eviction name the pick that caused it", () => {
    const anonymous = run({
      eviction: { observed: true, evictedTargetMeshCount: 3, selectionResidency: "target" },
    });
    expect(runShapeFailures(anonymous, phases, 67_108_864).join(" ")).toContain(
      "must say which pick caused it",
    );
  });

  it("accepts a scheduler that never went quiet, but only with a stated reason", () => {
    const silent = run({ evictionQuiescence: { settled: false, waitedMilliseconds: 180_000 } });
    expect(runShapeFailures(silent, phases, 67_108_864).join(" ")).toContain("what kept moving");

    const stated = run({
      evictionQuiescence: {
        settled: false,
        waitedMilliseconds: 180_000,
        reason: "requests, skips kept changing for the whole 180 s wait.",
      },
    });
    expect(runShapeFailures(stated, phases, 67_108_864)).toEqual([]);

    const undescribed = run({ evictionQuiescence: undefined });
    expect(runShapeFailures(undescribed, phases, 67_108_864).join(" ")).toContain(
      "must report whether the scheduler went quiet",
    );
  });
});

describe("target recomputation", () => {
  const ceilings = { workingSetBytes: 4 * 1024 ** 3, usedJsHeapBytes: 2 * 1024 ** 3 };
  const record = {
    runs: [
      run(),
      run({ profile: "forced-low-budget", budgetBytes: 8_388_608, samples: phases.map((phase) =>
        sample({
          phase,
          residency: { budgetBytes: 8_388_608, decodedBytes: 8_000_000, gpuBytes: 8_100_000 },
        }),
      ) }),
    ],
  };

  it("recomputes every target from the samples rather than the recorded verdict", () => {
    expect(recomputeTargets(record, ceilings)).toEqual({
      "residency-decoded-within-budget": true,
      "residency-gpu-within-budget": true,
      "process-working-set-ceiling": true,
      "js-heap-ceiling": true,
      "forced-low-remains-usable": true,
    });
  });

  it("fails a target when a single sample breaches it", () => {
    const breached = {
      runs: [
        ...record.runs,
        run({ runIndex: 2, samples: [sample({ process: { processCount: 8, workingSetBytes: 5 * 1024 ** 3, privateBytes: 1 } })] }),
      ],
    };

    expect(recomputeTargets(breached, ceilings)["process-working-set-ceiling"]).toBe(false);
  });

  it("does not call the forced-low profile usable when no such run exists", () => {
    expect(recomputeTargets({ runs: [run()] }, ceilings)["forced-low-remains-usable"]).toBe(false);
  });

  it("keeps full target residency out of the usability target", () => {
    // A forced-low run holds a fraction of the model on purpose; usable means
    // the hierarchy, the coarse frame, and a source-aware selection worked.
    const partial = {
      runs: [
        run({
          profile: "forced-low-budget",
          budgetBytes: 8_388_608,
          samples: phases.map((phase) =>
            sample({ phase, residency: { budgetBytes: 8_388_608, decodedBytes: 120, gpuBytes: 128 } }),
          ),
        }),
      ],
    };

    expect(recomputeTargets(partial, ceilings)["forced-low-remains-usable"]).toBe(true);
  });
});

describe("summary medians", () => {
  it("reports the lower median, so a summary figure is always one of the runs", () => {
    expect(median([9, 3, 7])).toBe(7);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it("accepts a summary that matches the samples it claims to summarize", () => {
    const runs = [1_000, 3_000, 2_000].map((workingSetBytes, index) =>
      run({
        runIndex: index + 1,
        samples: phases.map((phase) =>
          sample({ phase, process: { processCount: 8, workingSetBytes, privateBytes: 1 } }),
        ),
      }),
    );
    const summary = {
      runs: 3,
      medianWorkingSetBytes: 2_000,
      medianUsedJsHeapBytes: 843_000_000,
      medianResidentDecodedBytes: 66_686_508,
    };

    expect(summaryFailures({ runs }, "default-budget", summary)).toEqual([]);
    expect(
      summaryFailures({ runs }, "default-budget", { ...summary, medianWorkingSetBytes: 3_000 }).join(" "),
    ).toContain("expected 2000, found 3000");
  });

  it("reports a missing phase instead of summarizing what is not there", () => {
    const runs = [run({ samples: [sample({ phase: "hierarchy" })] })];

    expect(summaryFailures({ runs }, "default-budget", { runs: 1 }).join(" ")).toContain(
      "has no budget-limited sample",
    );
  });
});
