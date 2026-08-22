# ADR-0001: Begin with an engineering scene studio and runtime

Status: Accepted
Accepted: 2026-08-23

## Context

The long-term vision is an open, extensible engineering studio for the Web. A
full parametric CAD replacement would require sketch solving, B-Rep operations,
topological naming, drawings, CAM/CAE integrations, collaboration, and years of
workflow refinement. Starting with that breadth would delay useful releases and
hide the distinctive large-scene/WebGPU hypothesis.

## Decision

The first product wedge is:

- ingest existing CAD/BIM sources;
- compile semantic, progressive engineering scenes;
- render and interact with massive assemblies in WebGPU;
- provide review/composition tools and an extension API.

Exact authoring is a future workbench, not a prerequisite for the runtime.

## Consequences

### Positive

- Earlier vertical slice and benchmarkable technical value.
- Existing commercial/open CAD tools become inputs rather than direct enemies.
- Runtime can be embedded independently of Studio.
- Plugin ecosystem can reveal which authoring features matter.

### Negative

- Some users will call the first releases a viewer rather than a studio.
- Display tessellation cannot provide every exact CAD operation.
- The architecture must preserve a path to source/exact services.

## Alternatives considered

- Build a full browser parametric CAD first.
- Build only a renderer library with no workspace or plugin vision.
- Build a hosted conversion/viewer SaaS as the primary product.

## Validation

Phase 0 connected a licensed STEP assembly to OCCT-derived Scene IR, reusable
occurrences, explicit edges, direct WebGPU rendering, and source-linked picking
on two browser engines. The committed [evidence tracker](../PHASE_0.md) shows
that this narrow scene/runtime wedge is technically coherent without first
building a parametric CAD system.

Acceptance fixes the implementation sequence, not the claim that the Studio is
already useful. Phase 1 must still demonstrate a review workflow and an
independent embedding sample. External demand will determine whether Studio or
the runtime receives more investment.
