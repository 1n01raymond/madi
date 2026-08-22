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
