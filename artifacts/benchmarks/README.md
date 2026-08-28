# Local benchmark artifacts

Machine-readable benchmark results can be written here during local runs. The
top-level ad hoc JSON outputs remain ignored because results are meaningful only
when command, commit, workload, and environment metadata travel together.

The [Phase 1 completion report](../../docs/PHASE_1_REPORT.md) presents these
records alongside startup, residency, cache, and spatial-demand evidence. It is
the public reproducible report required by the Phase 1 roadmap; the renderer
records below retain their `exploratory-not-adr-decision` status.

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

The fourth record,
[`heterogeneous-gpu-timing`](heterogeneous-gpu-timing/README.md), adds WebGPU
pass timestamps and a backend-owned retained-resource census to the same
repeated matrix. It proves the MADI surface pass is sub-millisecond on that
discrete host, so the ADR-0003 comparison at that tier is CPU-side.

The fifth record,
[`heterogeneous-gpu-timing-integrated`](heterogeneous-gpu-timing-integrated/README.md),
repeats the locked matrix on an Apple M4 Pro integrated GPU. Chrome reproduces
the CPU-p95 and memory continuation signals, while Firefox does not reproduce
the CPU-p95 advantage; the cross-host records remain exploratory.

Source qualification is tracked separately under
[`../fixtures/external`](../fixtures/external/README.md). Those records verify
public STEP/IFC identity and inspectability; they contain no renderer timings.
