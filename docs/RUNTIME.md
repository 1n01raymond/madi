# WebGPU Runtime

Status: Draft 0.1

## 1. Mission

The browser runtime turns immutable compiled resources into an interactive
engineering scene under explicit network, CPU-memory, GPU-memory, and latency
budgets. It exposes semantic interaction without constructing one mutable
render object for every CAD occurrence.

## 2. Public API sketch

```ts
const runtime = await createMadiRuntime({
  device,
  budgets: {
    networkConcurrency: 8,
    decodedBytes: 512 * MiB,
    gpuBytes: 1024 * MiB,
    persistentCacheBytes: 4 * GiB,
  },
});

const view = runtime.createView({ canvas, camera: "perspective" });
const model = await runtime.open("/models/turbine/manifest.json", {
  signal: abortController.signal,
  onProgress,
});

view.attach(model);
model.visibility.hide([occurrenceId]);
model.selection.replace([occurrenceId]);
view.sections.set([{ normal: [1, 0, 0], distance: 0 }]);

const objectHit = await view.pickObject({ x, y });
const snapHit = await view.snap({ x, y, modes: ["vertex", "edge", "face"] });

await model.when("first-useful-frame");
model.dispose();
runtime.dispose();
```

The final API may differ. Required qualities are explicit ownership, abortable
operations, typed milestones/errors, separate object picking and precise
snapping, and deterministic disposal.

## 3. Packages and ownership

```text
runtime-core
├── manifest/schema validation
├── model tables and semantic API
├── streaming scheduler
├── cache abstraction
├── worker protocol
├── budgets and telemetry
└── backend interfaces

runtime-webgpu
├── GPU allocator
├── pipelines and shaders
├── view/frame graph
├── culling/LOD backend
├── picking and clipping
└── WebGPU capability/device recovery
```

The core can be unit-tested without a GPU. A future native or alternative
renderer may reuse the loader and semantic model.

## 4. Lifecycle and milestones

Model lifecycle:

```text
created
  -> manifest-ready
  -> hierarchy-ready
  -> coarse-renderable
  -> first-useful-frame
  -> target-view-ready
  -> fully-available (optional; may never be requested)
  -> disposing
  -> disposed
```

`first-useful-frame` requires:

- camera fitted or user camera respected;
- recognizable coarse visible content;
- interactive camera controls unblocked;
- hierarchy/search summary ready enough for navigation;
- no requirement that every object or property be downloaded.

Applications receive progress by meaningful stage and byte/residency estimates,
not a misleading single percentage when total demand is view-dependent.

## 5. Threading model

### Main thread

- public API and event delivery;
- camera/input integration provided by host or Studio;
- request priority summaries;
- GPU resource publication and command encoding;
- small model-table updates;
- plugin UI integration.

### Workers

- fetch where worker networking is appropriate;
- decompression and binary validation;
- semantic/index decoding;
- optional BVH/spatial acceleration construction;
- transformation into upload-ready typed arrays;
- expensive queries and snapping candidates.

Transferable buffers avoid copies. SharedArrayBuffer is optional because it
requires deployment headers; the baseline works without it.

## 6. Streaming scheduler

The scheduler combines demand signals:

```text
priority =
  visibility contribution
  + screen-space error
  + selected / hovered / measured boost
  + hierarchy/search request
  + motion prediction
  + starvation age
  - network cost
  - decode cost
  - residency pressure
```

It operates with bounded queues:

- manifest/index requests;
- compressed chunk fetches;
- decode tasks;
- GPU uploads;
- eviction candidates.

Cancellation is cooperative at every boundary. A camera move can demote or
cancel work before decode/upload, while partially useful shared prototype data
may remain requested.

## 7. Cache tiers

```text
remote/static source
    ↓
persistent compressed cache
    ↓
compressed in-memory queue
    ↓
decoded CPU cache
    ↓
GPU residency
```

Each tier has independent accounting and eviction. Content hashes allow cache
reuse across workspace revisions and model manifests. Selected content,
currently visible target LOD, and resources with active operations are pinned.

## 8. Model tables

The runtime decodes semantic convenience on demand while retaining dense tables
for scale.

Typical columns:

- occurrence parent/prototype/semantic indices;
- local transform or transform handle;
- world transform cache for visible/changed occurrences;
- visibility, selection, emphasis, and availability bitsets;
- bounds and spatial node references;
- representation/chunk references;
- source reference and property-page references.

Tree APIs return paged handles and iterators. They do not recursively materialize
the entire hierarchy as nested JS objects.

## 9. GPU resource model

### Allocation

- pooled storage, vertex, index, edge, and staging buffers;
- alignment-aware suballocation with explicit ownership per chunk;
- deferred destruction after submitted GPU work is complete;
- fragmentation stats and controlled compaction/rebuild;
- resource labels in development builds.

### Scene state

- transforms and object flags in storage buffers;
- representation/draw metadata indexed by dense IDs;
- material table with compact overrides;
- chunk-local decode parameters/origins;
- per-view visibility/LOD outputs;
- object ID mapping for picking.

TypeGPU can define typed buffer layouts and shader functions, but raw WebGPU
resources remain reachable behind a narrow backend seam.

## 10. Visibility and drawing strategy

Implementation order:

1. CPU coarse frustum culling over a compact spatial hierarchy.
2. Large batches and prototype instancing.
3. Reusable render bundles or bounded command templates where useful.
4. GPU fine culling and LOD classification after profiling.
5. Occlusion techniques only when their latency and pass cost win on target
   scenes.

Compute-generated indirect arguments can set non-visible batches to zero, but
the architecture does not assume native-style multi-draw-indirect availability.
The benchmark suite records CPU command encode time and draw count separately.

## 11. Render passes

### Surface pass

- engineering-friendly physically based or simple shaded materials;
- reversed depth where supported/beneficial;
- camera-relative transforms;
- clip distances/discard policy consistent with section passes;
- object/feature IDs available to optional attachments.

### Edge pass

- explicit boundary/sharp/seam edge streams;
- stable screen-space widths implemented as expanded geometry or shader logic;
- depth comparison/bias policy that avoids z-fighting;
- runtime silhouette classification as a separate optional feature;
- selected/emphasized edge styling without material duplication.

### Transparency and emphasis

The initial renderer uses controlled sorted/coarse transparency suitable for
ghosting and selected context. Order-independent transparency is evaluated only
if engineering workflows justify its memory/pass cost.

### Overlay pass

Annotations, measurements, axes, grids, manipulators, and plugin overlays use a
separate API and resource budget. DOM labels and GPU overlays can coexist.

## 12. Picking

### Object picking

- render compact occurrence/object ID into an integer or encoded target;
- read a small pixel region asynchronously;
- map dense GPU ID to occurrence and semantic/source references;
- pipeline readbacks to avoid blocking the render loop;
- allow on-demand pass for click and optional lower-rate hover updates.

### Precise snapping

Snapping is not the same as object picking. It may use:

- primitive ID and barycentric data;
- CPU BVH over resident display geometry;
- edge/vertex acceleration structures;
- source-exact evaluation through an optional service/adapter session.

Every result carries `accuracy.kind` and tolerance.

## 13. Sections and clipping

P0 supports visual clipping against one plane. P1 separates:

- surface clipping;
- section outline extraction;
- cap rendering;
- exact vs display-derived intersection;
- multiple planes/boxes.

A simple shader discard must not be labeled an exact section. Cap generation may
use stencil/multipass display techniques or compiler/runtime geometry, with
accuracy disclosed.

## 14. Precision

The runtime keeps camera and scene anchors in JavaScript number (double) and
uploads local f32 transforms/positions.

For each view:

1. choose camera-relative origin;
2. compose occurrence/document transforms in double precision;
3. split or subtract large translation before f32 upload;
4. decode quantized positions relative to prototype/chunk origin;
5. validate that estimated projected error remains below profile tolerance.

Bounds and scheduling use double-precision CPU representations where large
coordinate ranges require them.

## 15. Multiple views

One runtime/model can serve multiple canvases or viewports. Immutable geometry
and material resources are shared on one device; cameras, clip state,
visibility overrides, LOD demand, and pick targets are per view. The scheduler
merges demand while enforcing a configurable fairness policy.

## 16. Device and capability management

Startup records:

- adapter/device limits and optional features;
- buffer/texture limits;
- timestamp query support;
- compression texture features;
- preferred canvas format;
- profile compatibility.

The compiler profile declares minimum runtime requirements. The runtime can
choose an alternate payload profile when the manifest offers one.

On `device.lost`:

1. stop submissions and reject pending GPU operations with typed status;
2. retain semantic/model state and reusable compressed/decoded data within
   budgets;
3. request a replacement adapter/device according to host policy;
4. recreate pipelines, allocators, and visible resident chunks;
5. emit degraded/recovered events.

## 17. Error handling

Public errors contain:

- stable code;
- user-safe message;
- stage and affected model/chunk/object when known;
- recoverable flag and retry guidance;
- underlying cause in development mode without leaking sensitive metadata.

One malformed optional chunk should not invalidate an otherwise usable model.
Required hierarchy/schema failure stops model open.

## 18. Plugin-facing capabilities

Runtime capabilities include:

- read scene hierarchy and properties;
- observe selection/view/progress;
- request object visibility/emphasis transactions;
- add overlay renderables with quotas;
- register commands and analysis results;
- request network or source access only when host grants it.

Plugins never receive mutable GPU allocator internals. Advanced renderer plugins
may be added later behind a reviewed unsafe/experimental capability.

## 19. Testing

### Unit

- scheduler priorities and starvation;
- budget accounting and eviction;
- model table queries;
- ID/source mapping;
- manifest/feature negotiation;
- coordinate conversions;
- lifecycle and disposal.

### Integration

- deterministic manifest/chunk fixture load;
- corrupted/truncated chunk rejection;
- worker cancellation and transfer;
- GPU buffer allocation/release;
- device loss simulation;
- multi-view demand merging.

### Visual

- canonical images for surfaces, CAD edges, selection, sections, precision, and
  LOD transitions across supported browsers/GPUs;
- thresholds account for backend rasterization differences while preserving
  semantic pixels and gross geometry.

### Performance

- startup milestones;
- navigation frame distributions;
- main-thread long tasks;
- decode throughput;
- CPU/GPU memory peaks;
- picking latency;
- behavior under forced low budgets.

## 20. First implementation slice

- one model and one view;
- direct WebGPU surface and explicit edge rendering;
- fixed chunk layout with simple allocators;
- manifest/hierarchy load followed by coarse and display chunks;
- Worker decode;
- CPU coarse culling and prototype instancing;
- object-ID click picking;
- hide/isolate/select and one clip plane;
- stats overlay and deterministic disposal.

No GPU compute culling is required to call the first slice successful. It is
added only when a public benchmark shows the bottleneck.

The Phase 1 evidence app now opens the compiled glTF node graph before geometry,
decodes the external binary in a Worker, transfers three reusable prototype
batches, and renders per-occurrence transforms, source colors, explicit CAD
edges, an isometric bounds fit, and integer object picking. Selecting an
occurrence resolves its glTF node and revision-local OCCT edge references.
Visibility, navigation, clipping, hierarchy inspection, and local/URL package
opening are implemented. A progressive package can now decode and render
prototype AABBs from `coarse.bin`, then replace GPU batches with `scene.bin`
target geometry while preserving node-derived object IDs. Target prototype
ranges are fetched and decoded one at a time; unresolved prototypes keep their
coarse batches. Selecting an unresolved occurrence can pin its requested target
and demote colder target groups to their retained coarse fallbacks within the
same decoded/GPU budgets. Scene replacement or an explicit user cancellation
aborts the active range, terminates its Worker, and prevents later ranges from
starting. Camera-driven scheduling across spatial chunks, cancellation of
obsolete view work, persistent cache tiers, and broader eviction policy remain
unimplemented.

The reproducible browser smoke command is `pnpm browser:matrix`. Its committed
Phase 1 run covers Chrome/Blink and Firefox/Gecko with the same compiled package,
hierarchy-before-binary assertion, viewport, pick coordinate, expected
occurrence/source mapping, and console-error policy. See
`artifacts/browser-matrix` for exact versions, adapter disclosure, screenshots,
and hashes.
