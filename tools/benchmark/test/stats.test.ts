import { describe, expect, it } from "vitest";

import { summarize } from "../src/stats.js";

describe("summarize", () => {
  it("reports deterministic median, p95, and worst samples", () => {
    const result = summarize([5, 1, 3, 4, 2, 100]);
    expect(result).toEqual({
      samples: 6,
      medianMs: 3,
      p95Ms: 100,
      worstMs: 100,
    });
  });

  it("rejects invalid samples", () => {
    expect(() => summarize([1, Number.NaN])).toThrow(/finite/u);
    expect(() => summarize([-1])).toThrow(/non-negative/u);
  });
});
