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
