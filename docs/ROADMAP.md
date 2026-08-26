# Roadmap

Status: Draft 0.1

The roadmap is evidence-gated rather than date-driven. A phase exits when its
criteria are demonstrated in the repository.

## Phase 0 — Architecture and feasibility

Status: Complete (2026-08-23). See the [evidence record](PHASE_0.md).

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

Status: Current.

### Compiler

Current evidence: the first deterministic package emits standard glTF 2.0 JSON,
external binary geometry, and build reports from local AP242/AP214 through the
isolated OCCT adapter. It preserves hierarchy, prototype reuse, explicit edges,
and source identity; expanded Scene IR is temporary. Direct STEP output now
separates prototype AABB proxies from target geometry in two standard glTF
buffers. Shape-preserving LOD and spatial chunks remain pending. See the
[Phase 1 tracker](PHASE_1.md).

The direct AP242 package also records deterministic prototype byte ranges over
`scene.bin`. The browser promotes each completed HTTP Range while retaining
coarse batches for unresolved prototypes. The current streaming order is static,
but a selected occurrence can pin its target detail and demote colder target
groups back to retained coarse batches under the same budgets. Camera-driven
reprioritization remains pending.

An early IFC risk slice now compiles the qualified four-discipline Digital Hub
federation through isolated IfcOpenShell into the same Scene IR and glTF path.
It proves document-scoped identity, hierarchy, mapped geometry reuse, material
groups, and flattened properties. Its 3,383 prototype ranges now coalesce into
45 static target requests; the browser reconciles stable GPU batches under
separate 64 MiB decoded/GPU admission budgets. A selected target can replace
colder detail with retained coarse fallbacks, preserving visibility and picking
identity. It is not the Phase 3 BIM workflow or a Phase 2 performance result:
spatial chunks, view-driven scheduling, and cache tiers remain pending. A
focused project-owned IFC4 wall now proves the E2.1 boundary path separately:
12 OpenCascade face-boundary segments survive into glTF with source-item
mapping while six triangle face diagonals are excluded. Analytic curve kinds,
richer edge classification, and a real-model edge re-record remain pending.

The adapter boundary now uses a split Scene IR transport — structure-only JSON
plus a digest-linked binary geometry file — which reproduces the same compiled
package while halving the document the compiler must parse. That was enough to
qualify the 839.9 MB seven-discipline `sixty5` federation as a source and to
extract 4.87M unique triangles from it, and it exposed the next boundary: the
initial 631.9 MB structure document was larger than one JavaScript string. The
compiler streams that document record by record; interning property keys
and key combinations at scene level shrank the structure to 419.5 MB — back
under one string, with the boundary crossing preserved in history — and
moving the property values into a deduplicated binary column file shrank it
further to 345.5 MB, with the compiler verifying the columns without ever
materializing a value. The compiled package republishes those properties as a
`madi.package-properties.1` sidecar (`properties.json` + the column file byte
for byte), so viewers resolve a picked occurrence's property sets without any
Scene IR intermediate; the Studio does exactly that, lazily per selection.
sixty5 compiles end to end into a recorded, Khronos-validated 608.2 MB
package. Headed Chrome now consumes that package: all 78,173 renderable
occurrences render, the fixed 64 MiB residency budgets hold, and picking
resolves the selected occurrence's lazily fetched property sets. The original
268.0 s first coarse frame (`artifacts/ifc/sixty5-browser/`) is reduced to a
12.796 s three-run median by shared coarse residency and a persistent document
Worker (`artifacts/ifc/sixty5-first-frame/`).

- local STEP AP242 input;
- XDE hierarchy, names, colors, units, transforms;
- coarse and target display tessellation;
- explicit CAD edges;
- deterministic manifest, hierarchy index, and fixed binary chunks;
- independent validator and build report.

### Runtime

Current evidence: the browser reads the compiled glTF hierarchy first, decodes
`scene.bin` in a Worker, transfers shared typed-array batches to direct WebGPU,
and preserves source-aware object picking in headed Chrome and Firefox. Orbit,
pan, zoom, fit, synchronized selection, hide/isolate, and one section plane are
implemented. Hierarchy/source-identity search and occurrence properties are
also available, including lazily resolved IFC property sets from the package
sidecar (search over property values is a deliberate Phase 1 exclusion). The
Studio opens shareable HTTP(S) scene URLs and validated local `.gltf`
packages with all declared `.bin` and `.json` resources without uploading
them. A delayed-network browser record proves a coarse WebGPU frame before the
target request completes and a mixed coarse/target frame after one prototype
range. User/scene replacement cancellation now stops an active range and its
Worker. Coalesced range promotion does not rebuild unchanged GPU buffers and
has a fixed admission cap. A selected occurrence can pin a requested target
chunk and replace colder target detail with retained coarse fallbacks;
camera navigation now re-ranks retained-coarse chunk bounds, cancels an
obsolete active Range/Worker decode, and applies the same order to residency
eviction. Spatial/screen-space policy and persistent cache tiers remain pending.

The camera-relative precision path is now decision evidence for ADR-0005. A
project-owned 0.25 mm gap is retained at a 10,000 km offset with
0.000000387 mm measured error, while headed Chrome and Firefox reproduce
byte-identical near/far frames through navigation, sectioning, and picking.
The record is `artifacts/precision/large-coordinates/`; real Safari remains a
graceful unsupported-browser capability result because it does not expose
WebGPU under the recorded default settings.

- manifest/hierarchy-first loading;
- Worker decode;
- direct WebGPU surfaces and edges;
- CPU frustum culling, prototype instancing, bounded buffer pools;
- click object picking;
- selection, hide/isolate, assembly tree, one section plane;
- disposal and basic device-loss handling;
- local stats overlay.

### Studio

Current evidence: the [public GitHub Pages demo](https://1n01raymond.github.io/naru/)
opens the qualified Digital Hub package by default and PyGamer as a secondary
scene. The deployment verifies the package digests before publishing and
smoke-checks the live app, package resources, and HTTP Range delivery.

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

- content-addressed persistent cache under the
  [import/cache product contract](IMPORT_AND_CACHE.md): cancellable background
  cold import, hierarchy/coarse preview in 5–15 s, unchanged reopen in 1–5 s,
  followed by dependency-safe per-discipline rebuild and authorized shared reuse
  (verified STEP/IFC whole-package storage and adapter-skipping orchestration
  implemented; pinned real-fixture timing evidence pending);
- view-prioritized scheduling and cancellation of obsolete camera work
  (coarse-bounds policy implemented; spatial/screen-space policy pending);
- dynamic memory budgets and persistent cache tiers (fixed admission budgets and
  selected-target eviction implemented);
- spatial/draw clustering;
- screen-space LOD policy;
- broader selected-object residency policy and multi-selection pinning;
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
- production-grade IFC adapter and BIM property workflow;
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

Decision: continue to Phase 1. The 2026-08-23 evidence review connected source
identity, explicit edges, and direct WebGPU rendering without making OCCT a
browser dependency. ADR-0003 remains proposed until its narrower performance
gate is measured. ADR-0005 was accepted on 2026-08-26 after its 0.25 mm detail
at 10,000 km precision gate passed in headed Chrome and Firefox.

### After Phase 1

Revisit custom delivery structures. If standards-based payloads meet startup,
memory, and semantic requirements, prefer them. Freeze a custom cache only when
measured gaps are material.

### After Phase 2

Decide whether NARU's strongest adoption path is Studio, embedded runtime, or
compiler infrastructure. Preserve all three boundaries, but concentrate
maintainer resources where external use appears.
