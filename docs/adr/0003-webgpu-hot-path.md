# ADR-0003: Use a direct, data-oriented WebGPU rendering hot path

Status: Proposed
Reviewed: 2026-08-23

## Context

General-purpose web 3D engines provide excellent productivity, but very large
engineering scenes have unusual characteristics: static geometry, repeated
parts, hundreds of thousands of occurrences, explicit CAD edges, object-level
visibility, and progressive residency. A rich JS render object per occurrence
can make CPU traversal, memory, and state updates scale with total object count.

## Decision

- Runtime scene state is stored in dense tables, bitsets, and packed buffers.
- The main renderer targets WebGPU directly.
- No Three.js `Object3D` graph exists in the steady render hot path.
- TypeGPU may implement typed buffers/shaders behind a backend boundary.
- GPU compute culling and indirect rendering are optional measured techniques,
  not promises baked into the logical architecture.

## Consequences

### Positive

- Full control over allocation, batching, edge passes, picking, and residency.
- CPU/render behavior can be designed around engineering scenes.
- Runtime becomes an open reference for serious WebGPU scene processing.

### Negative

- More renderer, compatibility, testing, and debugging work.
- MADI cannot inherit every mature feature of a general engine.
- WebGPU implementation differences require broad conformance testing.

## Alternatives considered

- Three.js WebGPURenderer as the permanent scene/render abstraction.
- WebGL-only custom renderer.
- Native/cloud renderer that streams pixels to the browser.

## Validation

Phase 0 proves the feasibility sub-gate: one direct WebGPU path renders
instanced OCCT geometry, explicit edges, and object IDs in Chrome/Blink and
Firefox/Gecko. It does not prove that the custom path has a material advantage
over a general-purpose engine.

This ADR therefore remains Proposed. Acceptance requires equivalent Three.js
and direct-runtime workloads with published CPU time, memory, draw/batch, and
integration results. If the custom path produces no material advantage, the
decision must be revised before the runtime API hardens.

### Industrial decision contract

The decisive workload targets shipbuilding and process-plant review rather
than a generic triangle demo. It must combine repeated equipment with unique
geometry, deep occurrence identity, large spatial extents, dense interiors,
and object-level visibility. The public scale floor is 100,000 occurrences and
10 million submitted triangles; private design-partner scenes may supplement
but never replace reproducible public evidence.

The comparison pins an optimized Three.js baseline and gives both paths the
same source arrays, camera trace, resolution, visual features, culling policy,
and cache state. Renderer-isolated and end-to-end streaming results are
reported separately so compiler or network gains are not attributed to the
WebGPU hot path.

Before decision runs begin, the benchmark release locks these thresholds:

- continue the direct hot path when it reduces main-thread p95 by at least 25%
  or retained browser scene memory by at least 30% on a strategic industrial
  workload, while frame-time p95 is no more than 10% worse;
- also continue when bounded residency keeps the workload interactive inside a
  published low-memory budget that the optimized baseline cannot satisfy;
- revise this ADR toward Three.js when all material differences remain within
  10%, no bounded-residency advantage is demonstrated, and the custom path has
  higher integration or conformance cost.

No single metric or hardware profile decides the ADR. A result must reproduce
on the discrete reference profile and at least one integrated-GPU profile.

### First exploratory harness

The first committed industrial harness compares direct WebGPU with Three.js
WebGPURenderer 0.180.0 over the same 10,000-occurrence plant-style workload in
Chrome/Blink and Firefox/Gecko. It deliberately disables edges, culling, LOD,
streaming, and navigation-time picking. Its status is
`exploratory-not-adr-decision`: it validates workload parity, real-browser
automation, and result integrity but cannot accept or reject this ADR.

### Heterogeneous culling harness

The second committed record reaches 100,000 occurrences and 10,223,768
unculled triangles across 256 deterministic equipment variants. A shared
local-review trace exercises material frustum rejection. MADI uses reusable
dense CPU visibility tables and instance compaction; Three.js 0.180.0 uses one
optimized `BatchedMesh` with per-object culling and default opaque sorting.

This remains `exploratory-not-adr-decision`. The run is a single host session
without integrated-GPU coverage, GPU timestamps, repeated clean sessions,
isolated retained-memory accounting, bounded residency, or a real partner
assembly. Its outcome chooses the next experiment but does not satisfy the
industrial decision contract above.

### Fresh-process repeatability harness

The third record launches a new browser process for each of three repeats per
browser/backend and alternates backend order. Chrome shows a 27.0% median paired
CPU-p95 reduction and a 38.2% lower median backend scene-activation memory delta;
the CPU threshold holds in two of three pairs and the diagnostic memory
threshold in all three. Firefox shows a 10.0% median CPU reduction and exposes no
compatible memory measurement API.

The result supports continuing the investigation but does not accept this ADR.
It is still one host and adapter, browser behavior differs, the public workload
is procedural, and GPU timestamps, integrated-GPU coverage, bounded residency,
and a real industrial assembly remain missing.

### GPU timestamp and retained-resource census harness

The fourth record keeps the fresh-process, alternating-order matrix and adds
WebGPU `timestamp-query` pass timing plus a backend-owned retained-resource
census. Both Chrome and Firefox expose the feature on the discrete reference
host. The MADI surface pass is sub-millisecond there (Chrome median 0.459 ms,
p95 0.852 ms; Firefox median 0.297 ms), which relocates this decision to the
CPU side: with the GPU pass holding more than an order of magnitude of frame
headroom, the acceptance question is main-thread cost and retained memory,
not raster throughput. The census attributes scene memory symmetrically with
disclosed accounting (MADI exact allocations; Three.js a constructed floor
because its internals are not enumerable).

Cross-session variance is now measured rather than assumed: paired CPU-p95
reduction medians moved from 27.0% to 23.9% in Chrome between the two most
recent discrete-host sessions, with the 25% gate crossing in two versus one
of three pairs. This spread does not favor either outcome; it confirms that
only the contract's repeated, dual-profile reproduction can accept or revise
the hot-path decision. The integrated-GPU profile, bounded-residency slice,
and a real industrial assembly still gate acceptance.
