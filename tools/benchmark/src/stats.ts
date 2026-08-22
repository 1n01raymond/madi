export interface Distribution {
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

export function summarize(samples: readonly number[]): Distribution {
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new RangeError("Benchmark samples must be finite non-negative numbers.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    worstMs: sorted.at(-1) ?? 0,
  };
}
