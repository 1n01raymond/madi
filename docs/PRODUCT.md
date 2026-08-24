# NARU Product Requirements

Status: Draft 0.1
Audience: maintainers, contributors, design partners, and embedding teams

## 1. Product thesis

Engineering data is authored across many specialized systems, but teams still
need a neutral place to open, combine, inspect, communicate, and automate that
data. Existing browser viewers are often vendor-specific, cloud-only,
application-centric, or built on rendering abstractions that become expensive
for very large assemblies.

NARU will provide an open engineering workspace and an embeddable runtime whose
first distinctive capability is a direct, data-oriented WebGPU path for massive
CAD/BIM scenes.

The product thesis has three parts:

1. Existing authoring systems remain authoritative and continue to produce
   native or neutral exchange documents.
2. A compiler can transform those documents into a semantic, progressively
   streamable engineering scene without turning that cache into a new source
   format.
3. A browser runtime and plugin platform can become shared infrastructure for
   viewers, design review, digital twins, internal engineering tools, research,
   and future authoring workbenches.

## 2. Vision

> Any engineering model, in any browser, at useful scale, under the user's
> control.

Long term, NARU should feel less like a file viewer and more like an open studio:
users can compose sources, build views, annotate decisions, run tools, automate
repetitive work, and install domain workbenches. The reference application is a
host for the ecosystem; the runtime and APIs are equally important products.

## 3. Product boundaries

### 3.1 We build

- a neutral Engineering Scene IR;
- source adapter contracts and open adapters for neutral formats;
- an offline/edge compiler for renderable scene artifacts;
- a progressive loader, cache, and WebGPU rendering runtime;
- CAD/AEC interaction primitives such as selection, visibility, sectioning,
  measurement, assembly navigation, and metadata lookup;
- a project/workspace document for non-destructive composition and review;
- a reference browser Studio; and
- a capability-scoped plugin and automation API.

### 3.2 We integrate

- Open CASCADE for STEP/IGES interpretation and tessellation;
- IFC parsers and BIM metadata adapters;
- glTF and 3D Tiles ecosystem components where appropriate;
- proprietary translators through separately distributed adapter plugins;
- enterprise identity, storage, PLM/PDM, and collaboration through host
  integrations rather than mandatory core services.

### 3.3 We do not build initially

- a production B-Rep/NURBS kernel;
- a replacement for commercial CAD source documents;
- a complete parametric part modeler;
- CAM toolpath generation, CAE solving, or manufacturing execution;
- a mandatory hosted service;
- proprietary format reverse engineering in the core project;
- real-time multi-user editing; or
- a new public CAD interchange standard.

These are sequencing choices, not permanent prohibitions. Exact-geometry and
authoring workbenches may be added after the scene platform is proven.

## 4. Target users and jobs

### 4.1 Engineering application developer

**Job:** Embed a large-model viewport and engineering interactions in an
existing web product without adopting a vendor's complete platform.

Needs:

- headless API and framework-neutral canvas integration;
- deterministic builds and self-hosted assets;
- documented memory, performance, and security behavior;
- stable object IDs and metadata queries;
- plugin points for proprietary systems.

### 4.2 Design reviewer

**Job:** Open a large assembly quickly, find relevant components, inspect a
section, measure, isolate, annotate, and share a repeatable view.

Needs:

- first useful frame before full download;
- search and assembly tree available early;
- trustworthy dimensions and source references;
- saved views and issue-friendly links;
- visual clarity through CAD edges and predictable clipping.

### 4.3 Manufacturing or digital-twin team

**Job:** Combine equipment, building, point/scan, and operational metadata in a
controlled deployment.

Needs:

- multiple source documents in one coordinate framework;
- model revision and source provenance;
- extensible metadata and event overlays;
- private-network and air-gapped deployment;
- selective loading and predictable GPU resource budgets.

### 4.4 Open-source researcher or tool author

**Job:** Prototype geometry processing, rendering, visualization, or agentic
engineering workflows against a stable, inspectable platform.

Needs:

- public schemas and APIs;
- reproducible datasets and benchmarks;
- readable architecture and decision history;
- extension mechanisms that avoid forking the core.

## 5. Core user workflows

### 5.1 Open and inspect a large assembly

1. User selects a source or compiled scene URL.
2. Manifest, source metadata, top-level hierarchy, and coarse bounds load.
3. Runtime renders a coarse but recognizable frame.
4. Visible geometry refines while interaction remains responsive.
5. User searches for a component and isolates it.
6. Selection reveals source path, occurrence path, properties, and revision.

### 5.2 Section and measure

1. User creates one or more section planes.
2. Runtime updates surface visibility without rebuilding the whole scene.
3. When supported, the view shows section edges and caps with clear accuracy
   status.
4. User snaps to a vertex, edge, face, axis, or inferred feature.
5. Measurement result records units, precision, source references, and the
   approximation level used.

### 5.3 Compose an engineering workspace

1. User adds multiple source documents.
2. Each source is positioned through coordinate metadata or explicit transform.
3. User creates selection sets, views, annotations, and presentation states.
4. NARU saves only workspace intent plus source/cache references.
5. On reopen, sources are validated by revision/hash and caches are reused or
   rebuilt.

### 5.4 Embed NARU in another application

1. Host creates a runtime with explicit CPU/GPU/network budgets.
2. Host attaches a view to a canvas and loads a model.
3. Host maps its business IDs to scene object IDs.
4. Host controls selection and visibility and listens for interaction events.
5. Host installs only the plugin capabilities it trusts.

## 6. Functional requirements

Priority meanings: P0 is required for the first credible vertical slice, P1 for
the first broadly useful alpha, and P2 for later expansion.

### 6.1 Ingestion and provenance

| ID | Priority | Requirement |
|---|---:|---|
| ING-001 | P0 | Import STEP AP242 through an OCCT adapter. |
| ING-002 | P0 | Preserve product hierarchy, names, units, transforms, colors, and source references where available. |
| ING-003 | P0 | Record adapter/compiler version, source hash, options, warnings, and unsupported entities. |
| ING-004 | P1 | Import IFC geometry and property relationships through a separate adapter. |
| ING-005 | P1 | Import glTF as already-renderable scene content without routing it through OCCT. |
| ING-006 | P2 | Support licensed native translators through an out-of-tree adapter contract. |

### 6.2 Scene and workspace

| ID | Priority | Requirement |
|---|---:|---|
| SCN-001 | P0 | Represent prototypes separately from occurrences. |
| SCN-002 | P0 | Keep semantic hierarchy independent from render chunks and residency. |
| SCN-003 | P0 | Use deterministic IDs within one compiled revision. |
| SCN-004 | P1 | Provide cross-revision identity hints and explicit confidence; never silently claim stable topology. |
| SCN-005 | P1 | Save multiple sources, transforms, views, selection sets, annotations, and plugin data in a workspace. |
| SCN-006 | P1 | Detect missing, changed, and incompatible sources on workspace open. |

### 6.3 Streaming and runtime

| ID | Priority | Requirement |
|---|---:|---|
| RUN-001 | P0 | Load hierarchy and a first useful render without downloading the complete model. |
| RUN-002 | P0 | Decode payloads outside the main thread. |
| RUN-003 | P0 | Enforce configurable network, decoded-memory, and GPU-memory budgets. |
| RUN-004 | P0 | Prioritize visible and selected objects while avoiding starvation. |
| RUN-005 | P1 | Persist immutable chunks in browser cache with content-addressed keys. |
| RUN-006 | P1 | Cancel superseded requests and dispose model resources deterministically. |
| RUN-007 | P1 | Recover from WebGPU device loss by rebuilding resources from resident/cache data. |

### 6.4 Rendering and interaction

| ID | Priority | Requirement |
|---|---:|---|
| VIS-001 | P0 | Render shaded surfaces and explicit CAD edges. |
| VIS-002 | P0 | Support perspective and orthographic cameras. |
| VIS-003 | P0 | Support object selection, hover, hide, show, and isolate. |
| VIS-004 | P0 | Support at least one interactive section plane. |
| VIS-005 | P1 | Support multiple clip planes, section outlines, and a clearly labeled cap mode. |
| VIS-006 | P1 | Support transparent/x-ray emphasis without losing selected-object readability. |
| VIS-007 | P1 | Provide snapping and measurement separately from object picking. |
| VIS-008 | P2 | Support hidden-line and drawing-oriented rendering modes. |

### 6.5 Extensibility

| ID | Priority | Requirement |
|---|---:|---|
| EXT-001 | P0 | Publish a framework-neutral TypeScript runtime API. |
| EXT-002 | P1 | Load signed or locally approved plugins with declared capabilities. |
| EXT-003 | P1 | Allow plugins to add panels, commands, import adapters, properties, overlays, and analysis results. |
| EXT-004 | P1 | Version APIs and provide compatibility diagnostics. |
| EXT-005 | P2 | Support automation scripts with deterministic document transactions. |

## 7. Non-functional requirements

### 7.1 Performance

Initial targets are hypotheses until the benchmark suite exists.

- 100,000+ occurrences and 10 million+ triangles in the baseline public scene.
- First useful frame target under 2 seconds on the reference desktop profile,
  warm CDN edge, cold browser cache, and documented network conditions.
- Navigation target of 60 FPS at 1080p on the reference desktop profile after
  visible content has reached its target LOD.
- Main-thread p95 long task under 50 ms during navigation and progressive load.
- No per-frame traversal proportional to total semantic object count.
- Selection feedback target under 100 ms, with hover latency reported
  separately because GPU readback may be asynchronous.

### 7.2 Accuracy

- Unit and coordinate conversion must be explicit and testable.
- Rendering precision must support local millimeter details inside large site
  coordinates through local origins and camera-relative transforms.
- Measurements must state whether they use exact source geometry, display
  tessellation, or a derived approximation.
- Source topology references must not be presented as stable when the source
  adapter cannot guarantee them.

### 7.3 Portability

- Chromium, Firefox, and Safari WebGPU implementations are tested where
  available.
- Unsupported devices fail with actionable capability diagnostics.
- A WebGL fallback is optional and must not constrain the WebGPU architecture;
  the first vertical slice may be WebGPU-only.
- Runtime APIs must not depend on React, Vue, or another UI framework.

### 7.4 Security and privacy

- Self-hosted operation is possible without a NARU-operated service.
- No telemetry is enabled in the core runtime by default.
- File and decoder limits prevent unbounded allocation and decompression.
- Plugin capabilities are explicit and revocable.
- Workspace files contain no credentials.

### 7.5 Maintainability

- Logical IR, serialization, compiler, runtime, and Studio remain separate
  packages with dependency direction enforced by tests.
- Serialized payloads carry version and feature requirements.
- Public APIs have typed errors and lifecycle semantics.
- Performance regressions are visible in CI or scheduled benchmark runs.

## 8. Experience principles

1. **Useful before complete.** Show hierarchy and recognizable geometry early.
2. **Never hide approximation.** Distinguish coarse display, exact display, and
   source-exact operations.
3. **Selection is sacred.** Users must always know what source object and
   occurrence they are acting on.
4. **Large scenes stay navigable.** Loading, search, and analysis must not make
   camera interaction feel blocked.
5. **Power without mandatory complexity.** Basic review is approachable; deep
   automation is available through commands and plugins.
6. **Portable intent.** Views, annotations, and selection sets should survive
   cache rebuilds when source identity permits.

## 9. Success metrics

### Project health

- successful external reproduction of the benchmark suite;
- at least three independently maintained source or domain plugins;
- stable documented API used by at least two applications other than Studio;
- issue response and release cadence appropriate to maintainer capacity.

### Product evidence

- a public model demonstrating 100k+ occurrences;
- measurable startup or memory advantage over a documented baseline;
- one self-hosted design partner workflow;
- one multi-source workspace combining different engineering domains;
- no source-data upload required for the reference local workflow.

## 10. Risks and countermeasures

| Risk | Impact | Countermeasure |
|---|---|---|
| Attempting to clone a full CAD product | Project never reaches a coherent release | Hold the first wedge to scene ingestion, review, runtime, and plugins. |
| A custom format becomes the product | Ecosystem and compatibility burden | Treat serialization as replaceable; standards first; benchmark before freezing. |
| WebGPU feature gaps undermine GPU-driven claims | CPU overhead remains high | Design coarse batches, instancing, and render bundles; profile before compute complexity. |
| Source IDs change across exports | Annotations and comparisons drift | Preserve source paths, expose confidence, support adapter-specific identity maps. |
| OCCT and native translators dominate complexity | Slow build and legal friction | Isolate adapters, publish neutral fixtures, keep browser runtime independent. |
| Open source lacks sustainable maintenance | Security and compatibility decay | Modular governance, paid services allowed by license, small stable core. |

## 11. Open product questions

- Which second public assembly should extend the PyGamer electronics baseline
  into the 100k+ occurrence performance target?
- Does the first Studio release need IFC, or should IFC follow after the STEP
  vertical slice?
- Which workspace operations require exact B-Rep access rather than display
  geometry?
- What is the smallest useful plugin UI surface?
- Should the first deployment be fully local, static-hosted, or paired with a
  reference compilation service?
- Which cross-revision identity guarantees are feasible for STEP AP242 exports?
