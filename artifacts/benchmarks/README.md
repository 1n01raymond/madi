# Local benchmark artifacts

Machine-readable benchmark results can be written here during local runs. The
top-level ad hoc JSON outputs remain ignored because results are meaningful only
when command, commit, workload, and environment metadata travel together.

Reviewed evidence lives in a named subdirectory with its validator and scope.
The first such record is [`industrial-baseline`](industrial-baseline/README.md),
an exploratory 10k-occurrence MADI/Three.js browser matrix. It validates the
comparison harness but does not decide ADR-0003.

The second reviewed record is
[`heterogeneous-culling`](heterogeneous-culling/README.md): 256 prototypes,
100,000 occurrences, a local-review camera trace, and equivalent MADI dense CPU
culling versus Three.js `BatchedMesh` per-object culling. It remains exploratory.

The third record,
[`heterogeneous-repeatability`](heterogeneous-repeatability/README.md), repeats
that target three times per browser/backend in fresh processes, alternates
backend order, and measures backend scene-activation memory deltas in Chrome.

Source qualification is tracked separately under
[`../fixtures/external`](../fixtures/external/README.md). Those records verify
public STEP/IFC identity and inspectability; they contain no renderer timings.
