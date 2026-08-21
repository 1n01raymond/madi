# Roadmap

Status: Draft 0.1

The roadmap is evidence-gated rather than date-driven. A phase exits when its
criteria are demonstrated in the repository.

## Phase 0 — Architecture and feasibility

### Outcomes

- product requirements and scope;
- accepted first architecture decisions;
- selected redistributable STEP fixtures;
- small WebGPU prototype proving surface + explicit edge + object ID rendering;
- OCCT spike proving assembly/prototype/occurrence extraction;
- benchmark harness skeleton.

### Exit criteria

- one STEP assembly produces a validated in-memory Scene IR;
- one prototype appears in multiple occurrences without geometry duplication;
- OCCT source edge references survive into a rendered selection demo;
- direct WebGPU buffer layout and object picking work on two browser engines;
- risks and unsupported source data are reported rather than ignored.

## Phase 1 — Vertical slice (`0.1.0-alpha`)

### Compiler

- local STEP AP242 input;
- XDE hierarchy, names, colors, units, transforms;
- coarse and target display tessellation;
- explicit CAD edges;
- deterministic manifest, hierarchy index, and fixed binary chunks;
- independent validator and build report.

### Runtime

- manifest/hierarchy-first loading;
- Worker decode;
- direct WebGPU surfaces and edges;
- CPU frustum culling, prototype instancing, bounded buffer pools;
- click object picking;
- selection, hide/isolate, assembly tree, one section plane;
- disposal and basic device-loss handling;
- local stats overlay.

### Studio

- open local/URL compiled scene;
- orbit/pan/zoom and fit;
- hierarchy search and properties;
- selection/hide/isolate/section;
- diagnostic and performance panels.

### Exit criteria

- public end-to-end demo;
- useful frame before full target geometry is resident;
- source occurrence selection maps back to source reference;
- no total-scene traversal in the steady navigation hot path;
- reproducible benchmark report.

## Phase 2 — Large-scene alpha (`0.2.x`)

- content-addressed persistent cache;
- view-prioritized scheduling and cancellation;
- memory budgets and eviction;
- spatial/draw clustering;
- screen-space LOD policy;
- selected-object residency boost;
- multi-view support;
- improved sections, measurement, and snapping;
- workspace with sources, views, selection sets, and annotations;
- framework-neutral embedding examples.

### Exit criteria

- baseline public scene with 100k+ occurrences and 10M+ triangles;
- cold/warm startup, frame, memory, and interaction results published;
- forced low-memory scenario remains functional;
- workspace reopens against unchanged source and detects changed source.

## Phase 3 — Open platform beta (`0.3.x`)

- plugin manifest, capabilities, commands, panels, namespaced workspace data;
- worker analysis API and bounded overlays;
- IFC adapter and BIM property workflow;
- glTF/standards-based input/output profile;
- self-host deployment example;
- source resolver/compile service contract;
- safe mode and plugin compatibility diagnostics;
- broader browser/GPU conformance matrix.

### Exit criteria

- two non-core plugins maintained independently;
- runtime embedded in an app other than Studio;
- STEP and IFC sources coexist in one workspace;
- private-network deployment documentation validated by a design partner.

## Phase 4 — Production hardening (`0.4+`)

- schema/API compatibility policy backed by tests;
- fuzzed decoders and parser isolation guidance;
- incremental compilation/chunk reuse where adapters support it;
- revision comparison and identity confidence tools;
- signed/self-hosted plugin distribution;
- accessibility and localization completion for Studio core;
- release, migration, and long-term support policy.

## Future workbenches

These are explicitly outside the initial critical path:

- exact section/measurement service backed by B-Rep;
- assembly composition and constraints;
- sketch and parametric feature editing;
- drawing/PMI/GD&T workbench;
- clash/clearance and rules engines;
- point clouds and simulation result fields;
- collaborative review and issue federation;
- agent-accessible engineering commands.

## Workstreams

The implementation can be organized into parallel but integrated tracks:

| Track | First responsibility |
|---|---|
| IR & schema | typed IDs, validation, fixtures, manifest experiments |
| OCCT adapter | STEP assembly, tessellation, edge/source mapping |
| Compiler | normalization, instancing, chunking, reports |
| Runtime core | loading, tables, scheduling, cache, Workers |
| WebGPU | allocators, surfaces, edges, picking, clipping |
| Studio | reference UX, tree, properties, diagnostics |
| Benchmarks | datasets, traces, baselines, result publication |
| Plugins | capability model and first example after vertical slice |

## Go/no-go checkpoints

### After Phase 0

Continue only if source identity, explicit edges, and direct WebGPU rendering can
be connected without making OCCT a browser dependency.

### After Phase 1

Revisit custom delivery structures. If standards-based payloads meet startup,
memory, and semantic requirements, prefer them. Freeze a custom cache only when
measured gaps are material.

### After Phase 2

Decide whether MADI's strongest adoption path is Studio, embedded runtime, or
compiler infrastructure. Preserve all three boundaries, but concentrate
maintainer resources where external use appears.
