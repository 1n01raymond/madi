# Phase 1 Evidence Tracker

Status: Complete (2026-08-28)

Phase 1 turns the feasibility path into a reproducible STEP-to-browser vertical
slice and retires selected source-adapter risks before Phase 2. The roadmap
remains authoritative; this record distinguishes committed evidence from
planned behavior. The five exit criteria and consolidated performance evidence
are summarized in the [Phase 1 completion report](PHASE_1_REPORT.md).

## First compiler slice

The first slice accepts local STEP AP242/AP214 through the isolated OCCT adapter
and compiles its validated `EngineeringScene` into standard glTF 2.0 JSON plus
an external binary resource and machine-readable adapter/compiler reports. The
expanded Scene IR is temporary. This intentionally avoids defining a NARU CAD
or delivery container.

| Signal | Evidence | Status |
|---|---|---|
| Deterministic output | Two compilations compare JSON, binary, and report bytes | Passed in `packages/compiler/test/gltf.test.ts` |
| Standards validation | Official Khronos glTF Validator checks JSON and external binary | Passed with 0 errors / 0 warnings |
| Prototype reuse | The canonical package reuses one 0603 mesh 26 times and one 0805 mesh 11 times; the focused regression keeps 8-way fastener reuse | Passed |
| Engineering edges | Canonical glTF line primitives retain 13,897 explicit OCCT edge segments | Passed |
| Source identity | Report source digest matches OCCT evidence; node/mesh `extras` retain IDs and refs | Passed for experimental profile |
| Independent package validation | Hashes, ranges, hierarchy, counts, and report parity are checked without compiler state | Passed by `pnpm phase1:evidence:check` |
| Direct AP242 input | `pnpm naru compile` preflights the Part 21 schema, runs OCCT STEPCAF/XDE, cross-checks source SHA-256, and removes temporary Scene IR | Passed with the checksum-locked `repeated-fasteners-ap242.step` package |
| Coarse/target split | Direct STEP output keeps target meshes in `scene.bin` and emits 3 reusable prototype AABBs in a 2.7 KiB `coarse.bin`; both remain standard external glTF buffers | Passed with 0 Khronos validator errors/warnings |
| Partial target delivery | Compiler records three non-overlapping prototype ranges that cover `scene.bin`; the Worker issues exact HTTP Range requests and promotes one target batch per completed range | Passed by package/runtime tests and headed Chrome/Firefox evidence |

### Early IFC federation risk slice

The separate `naru compile-ifc` entry now accepts repeated discipline/document
pairs and compiles IFC2X3/IFC4/IFC4X3 through pinned IfcOpenShell. The qualified
Digital Hub evidence covers four IFC4 documents, 14,675 semantic entities,
13,681 occurrences, 3,383 unique geometric prototypes, 913,520 unique
triangles, and 273,188 property values. All source hashes, the 81.8 MB temporary
Scene IR, and the 60.7 MB compiled package are digest-linked; Khronos validation
reports zero errors and warnings.

This slice also forced the runtime boundary to support one pickable IFC object
across multiple material-separated glTF surface primitives. It deliberately
reports `IFC_EDGE_EXTRACTION_DEFERRED` and zero explicit edge segments. The
compact result is checked by `pnpm ifc:federation:check`; large source and
compiled binaries remain outside Git.

E2.1 is now proven independently on the project-owned IFC4 wall fixture. The
current split.4 adapter preserves 12 OpenCascade face-boundary segments and
maps every segment to `IfcExtrudedAreaSolid#21`; the validator derives an
18-edge triangle-wireframe control from the 12 surface triangles and proves
that all six face diagonals are excluded. The edge and surface primitives reuse
one POSITION accessor, and Khronos validation reports zero errors and warnings.
See `artifacts/ifc/explicit-edges/` and run `pnpm ifc:edges:check`. Digital Hub
and sixty5 remain historical split.3 surface-only records rather than being
silently rewritten.

### Split Scene IR transport and the real-large boundary

The adapter no longer hands the compiler one expanded JSON document. It writes
structure-only JSON whose representation surfaces hold
`{encoding, byteOffset, byteLength}` references into a separate little-endian
geometry file, reports a SHA-256 for each half, and the compiler resolves those
references into typed-array views without copying.

| Signal | Evidence | Status |
|---|---|---|
| Transport equivalence | Digital Hub recompiled to the same `a6d5c0eecebf` package digest from the split pair at split.1; under split.2 property indexing and split.3 value columns, `scene.bin`, `coarse.bin`, and every compiler count stay identical and `scene.gltf` differs only through the recorded `optionsDigest` (current digest `9b98866671eb` including the property sidecar, byte-identical across two full runs including adapter re-extraction) | Passed |
| Intermediate reduction | One 81,805,061-byte document became a 39,135,637-byte structure plus a 28,134,848-byte geometry file; property indexing (split.2) shrank the structure to 30,592,935 bytes, and property value columns (split.3) to 26,235,818 bytes plus a 2,260,991-byte column file — 67.9 % below the single document | Passed |
| Hydration contract | Stream bounds, encodings, element alignment, unaligned buffers, and unencodable members are unit-checked | Passed in `packages/compiler/test/ifc-scene.test.ts` |
| Real-large extraction | The seven-document IFC2X3 sixty5 federation extracts 192,316 semantic entities, 78,173 geometric occurrences, 42,435 prototypes, and 4,866,386 unique triangles from 40,310,966 submitted | Passed, recorded in `artifacts/ifc/sixty5/` |
| Structure streaming | The compiler parses the structure document record by record in bounded chunks instead of one string, and reproduces the Digital Hub package digest byte for byte | Passed in `packages/compiler/test/ifc-structure-stream.test.ts` and the recompiled `artifacts/ifc/digital-hub/` record |
| Real-large compile | The split.1 structure measured 631,943,761 bytes — past the 536,870,888-byte maximum string length — and the streaming reader compiled it into a Khronos-clean (0 errors / 0 warnings) 608.2 MB package, byte-identical across two full runs, peaking at ≈3.8 GB compiler RSS inside the default V8 heap (recorded at commit `41e6973`) | Passed; split.1 record preserved in history |
| Property indexing | Interning 35,510 keys / 299 key-sets (sixty5) and 1,656 / 279 (Digital Hub) once at scene level shrinks the sixty5 structure to 419,502,749 bytes (−33.6 %) — back under the maximum string length — while geometry, `scene.bin`, `coarse.bin`, every compiler count, and all resolvable property values stay unchanged | Passed, recorded in `artifacts/ifc/sixty5/` and `artifacts/ifc/digital-hub/` |
| Property value columns | Moving values into a binary column file (split.3: sixty5's 5,225,296 encoded entries deduplicate to 488,526 distinct values in a 31,179,862-byte file) shrinks the sixty5 structure to 345,472,410 bytes (−17.6 %); the compiler verifies row arity through typed-array views without materializing a value, sampled compile peak 3,845,181,440 bytes vs 4,043,804,672 at split.1 | Passed, recorded in `artifacts/ifc/sixty5/` and `artifacts/ifc/digital-hub/`; unit-checked in `packages/scene-ir/test/property-columns.test.ts` and `packages/compiler/test/ifc-scene.test.ts` |
| Property sidecar | The compiled package republishes the properties as `properties.json` (`madi.package-properties.1`: property index plus a sorted columnar semantic table) and `properties.bin` (the adapter column file byte for byte, digest-checked by the validator); `scene.gltf` points at them through `extras.madi.properties`, both join the package digest, and the STEP path stays byte-identical | Passed, recorded in `artifacts/ifc/digital-hub/` and `artifacts/ifc/sixty5/`; unit-checked in `packages/scene-ir/test/package-properties.test.ts` and `packages/compiler/test/gltf.test.ts` |

Splitting geometry out was necessary but not sufficient: the remaining bulk
was 4,503,078 flattened property values and 188,319 occurrence records. The
record-streaming reader lifts the one-string ceiling without changing the
transport format, property-key indexing (split.2) removed the repeated key
text, and property value columns (split.3) moved the values themselves into a
deduplicated binary file the compiler and browser resolve lazily
(`resolvePropertyEntries` in `@naru3d/scene-ir`); the remaining resident bulk is
the occurrence and semantic records themselves.

### Real-large browser residency

Headed Chrome now consumes that compiled sixty5 package end to end, with the
served bytes digest-verified against the committed build report before
recording. The record is `artifacts/ifc/sixty5-browser/`, checked by
`pnpm ifc:browser:check`.

| Signal | Evidence | Status |
|---|---|---|
| Real-large load | The 448.8 MB `scene.gltf` parses and lists 188,319 occurrence records in 3.3 s; the first coarse WebGPU frame with all 78,173 renderable occurrences appears at 268.0 s and the ready state at 323.3 s | Passed, recorded in headed Chrome 151 |
| Bounded residency | Under the default 64 MiB decoded/GPU budgets, promotion stops at 26 of 234 target chunks with 66,951,636 decoded / 60,644,136 GPU resident bytes; the other 208 chunks retain coarse fallbacks and `targetReady` reports `limited` | Passed; the resident set reproduced exactly across three package revisions |
| Standard delivery | All 28 `scene.bin` requests are HTTP 206 `bytes=` Ranges; the budget-limited frame renders 975,013 triangles and 466,452 coarse edge segments with zero console issues | Passed |
| Source picking | A center-canvas click resolves one concrete foundation beam to glTF node 148735, object ID 148736 | Passed |
| Property resolution | The first selection lazily fetches the 48.9 MB `properties.json`/`properties.bin` sidecar pair (one plain HTTP 200 each, no Range) and resolves the picked foundation beam's 6 property entries under its `IFC2X3` schema; the validator pins the entry set | Passed, recorded with the `madi.ifc-browser-residency.2` schema |
| First-frame boundary | The Worker decode of the 37.8 MB `coarse.bin` takes 6.6 s; the rest of the 264.7 s to the first frame sits on the main-thread document handoff and 42,588-batch construction path | Recorded as the named Phase 2 optimization input |

The Phase 2 follow-up in `artifacts/ifc/sixty5-first-frame/` closes that named
boundary without changing the compiled package, in five stages.

A persistent Worker owns the parsed glTF once, and `prototype-aabb-v1` is
rendered as one canonical box batch with an occurrence transform/target table.
That stage brought the first coarse frame to a 12.796 s median (12.553, 12.796,
13.378 s), a 95.23% reduction from the 268.013 s baseline.

The Studio then stopped materializing the whole assembly tree. The federation's
188,319 rows used to be 565,134 elements, 78,173 of them exposed as accessible
buttons; on a host whose accessibility mode is enabled, the browser process
saturates walking that tree and stops servicing its own network sockets, so the
coarse geometry request waits minutes for a response. Only the rows the
scrollport covers now exist, so the panel holds roughly thirty elements at any
federation size.

The residency drain then stopped giving up early. A chunk the byte budget
rejects is marked and skipped so the drain continues through the rest of the
demand, `ready` is stamped only once the scheduler goes idle, and GPU
visibility is reconciled through the changed batches. Three headed-Chrome runs
of that stage presented the first coarse frame at 4.232, 4.419, and 4.340 s
(4.340 s median, 4.419 s observed p95): a 98.38% reduction from the baseline,
and 61.75× faster than it. All three settle on the *same* endpoint — 93 of 234
target chunks, 66,927,984 decoded and 67,011,312 GPU bytes with 97,552 bytes of
headroom — and reach it at a 9.601 s median, against 15.807 s when the drain
stopped at the first rejection and 64.445 s before that. All 78,173 occurrences
remain visible and pickable and the same selected IFC properties resolve.

The fourth stage measures each target chunk's decoded and GPU cost once from
the parsed document's accessor counts, and refuses a chunk the budget cannot
take under any eviction the scheduler would perform where its range request
would have been issued. That endpoint was byte-identical to the stage above it
— the same 93 of 234 chunks and the same 66,927,984 / 67,011,312 bytes — but
reached from 93 requests and 94 Range responses instead of 234 and 245, with
141 chunks skipped untouched. Used JS heap at the ready sample fell from
1.788 GB to 1.481 GB and the ready state arrived at an 8.277 s median (7.669,
8.277, 8.459 s) against 9.601 s.
`packages/runtime-webgpu/test/compiled-gltf.test.ts` decodes a committed
fixture and asserts the predicted cost equals the decoded one for every chunk,
so the prediction cannot drift from the charge.

The committed record adds the fifth stage, which raises the endpoint itself. A
prototype mesh is split into one primitive per material but stores its vertex
pool once, and every primitive references the same POSITION and NORMAL
accessors; the runtime used to interleave and retain that pool once per
material group. It now decodes each pool once per mesh, hands the same
`Float32Array` to every sibling batch, charges residency for it once, and
refcounts one GPU vertex buffer behind it. Measured over all 234 chunks of this
package, total decoded cost falls from 230,730,336 to 129,154,008 bytes and the
largest single chunk from 75,373,776 to 1,334,976 — the 75 MB chunk was one
prototype with 111 material groups over a 28,045-vertex pool, and no chunk in
the package is individually unadmittable any more. Under the same 64 MiB
budget, three headed-Chrome runs settle on 111 of 234 chunks with 66,686,508
decoded and 66,783,808 GPU bytes, retaining 2,255,235 resident triangles
against 1,849,190 — 22% more geometry for 241,476 fewer decoded bytes — from
111 requests, 123 skips, and 113 Range responses. First coarse frame is a
4.283 s median (4.331, 4.283, 4.258 s; 98.40% below the baseline, 62.58×
faster), ready an 8.943 s median, and used JS heap at ready 1.625 GB for the
extra resident geometry.

### Persistent import cache

Both compile paths accept `--cache <dir>` (ADR-0009, Accepted). The recorded
product evidence in `artifacts/cache/` runs the pinned PyGamer STEP fixture and
the four-document Digital Hub federation three times each against one cache
directory, and `pnpm cache:check` pins the record.

| Signal | Evidence | Status |
|---|---|---|
| Verified warm reuse | Cold miss then warm hit with the same key and a byte-identical restored package: STEP 19.9 s → 1.7 s (11.4×), IFC 46.3 s → 0.5 s (96.2×) | Passed; single-run timings on one recorded host, not a distribution |
| Fail-closed corruption | Flipping one byte of the cached `scene.gltf` produces a reported failed restore, a byte-identical full recompile, and an entry that stays unpublishable (manifest intact, digest mismatched) | Passed |
| Identity-keyed invalidation | Keys include normalized source digests, the adapters' `--identity` fingerprints, a content hash of the compiler's own modules, and output-affecting options | Passed in `packages/compiler/test/compiled-cache.test.ts` and both orchestration test suites |

The recorded IFC package digest is the current split.4 explicit-edge toolchain
digest and deliberately differs from the historical split.3
`artifacts/ifc/digital-hub/` federation record; refreshing that record and the
deployed demo package it verifies is a separate tracked slice.

## First browser runtime slice

The browser now consumes that compiled package directly. It reads the glTF node
graph and NARU identity metadata on the main thread, then fetches and decodes the
external binary in a Worker before transferring packed typed arrays to the
direct WebGPU renderer. The Phase 0 Scene IR JSON is no longer a browser input.

| Signal | Evidence | Status |
|---|---|---|
| Hierarchy first | Recorder observes 87 occurrence records before the Worker requests the 14.8 MB `scene.bin` | Passed in Chrome and Firefox |
| Worker boundary | Binary fetch, accessor validation, decoding, and transferable collection run in `geometry.worker.ts` | Passed |
| Prototype reuse | 34 GPU batches render 85 parts; 26 tiny 0603 components share one mesh/buffer set | Passed |
| Engineering rendering | 162,838 unique triangles and 13,897 explicit edge segments reproduce the compiler report | Passed |
| Source picking | PyGamer joystick resolves glTF node 56, object ID 57, and 524 revision-local CAD edge refs | Passed |
| Review interaction | Orthographic orbit/pan/zoom/fit, synchronized canvas/tree selection, hide/isolate/show-all, and one axis-controlled section plane; surfaces, explicit edges, and picking share the clipping equation without rebuilding GPU resources | Passed by camera/visibility/section unit tests and browser interaction review |
| Scene inspection | Tokenized hierarchy search covers names and source identity before geometry residency; viewport/tree/search selection share an occurrence property panel with bounded edge-reference previews, and packages carrying the property sidecar resolve the selected occurrence's IFC property sets lazily through `resolvePropertyEntries` (search deliberately does not index property values in Phase 1) | Passed by search/sidecar unit tests and cross-browser interaction review |
| Scene opening | HTTP(S) glTF URLs are shareable through `?scene=`; a validated local `.gltf` plus all declared `.bin` resources load entirely client-side and decode their `File` objects in the Worker without a binary network request | Passed by source unit tests and the Chrome/Firefox browser matrix |
| Useful frame before target | Recorder holds the first target Range response, captures a 12-triangle/12-edge shared coarse frame, then releases all ranges and observes 2,088 resident triangles/193 resident edges including the retained shared fallback | Passed in headed Chrome and Firefox |
| Mixed-residency frame | Recorder releases only the first 31.7 KiB range and captures 8 detailed fasteners at 368 resident triangles/49 resident edges before completing the remaining ranges | Passed in headed Chrome and Firefox |
| Chunk-local decode | The session Worker prepares active float64 transforms and direct chunk-to-occurrence tables once; a transfer-detachment regression proves repeated single-occurrence Range decodes do not read the node graph again | Passed in `packages/runtime-webgpu/test/compiled-gltf.test.ts` |
| View-priority scheduling | Recorder holds the initial fastener Range, pans the camera, observes its Worker cancellation, and receives the newly hottest mounting-plate Range before releasing the obsolete response | Passed in headed Chrome and Firefox |
| Spatial demand scheduling | Optional `spatial.bin` is authenticated once; a transform-only localized oracle reduces 19→9/7 visited nodes, 10→1 tested occurrences, and 3→1 candidate chunks while cancelling the obsolete Range before its body is delivered | Passed in headed Chrome and Firefox; real-model gates remain |
| Spatial payload packing | Opt-in `spatial-leaf-anchor-v1` orders prototype blocks by dominant deterministic BVH leaf before byte-budget coalescing; Digital Hub reduces chunks 71→66, leaf references 1,458→882, and off-view bytes 637,689,824→383,315,164; explicit-edge sixty5 changes global chunks 324→325 but reduces leaf references 34,167→21,246 and off-view bytes 15,972,343,228→9,668,115,064, with unchanged useful/target/coarse bytes and Khronos-clean deterministic repeats | Focused oracle plus Digital Hub and sixty5 offline censuses passed; Digital Hub headed full-fit integration passed; localized real-model browser traces remain |
| Spatial localized demand | A scripted zoom and pan over the Digital Hub federation take the BVH query from 255/255 nodes, 128/128 leaves, and 5,152/5,152 occurrences to 109 nodes, 28 leaves, and 1,129 occurrences; on that identical view the compatibility package demands 52 of 71 chunks (23,065,180 of 35,962,344 target bytes) and the leaf-anchor package 42 of 66 (20,111,204 bytes), and 48 navigation queries cost p95 0.085 ms / 0.080 ms without a total-occurrence traversal | Passed in headed Chrome 151 on Windows over three runs per payload order |
| Spatial localized demand under a binding budget | The same trace over the sixty5 federation, whose 120,707,064 target bytes cannot fit the 67,108,864-byte residency budget, takes the query from 4,095/4,095 nodes, 2,048/2,048 leaves, and 78,173/78,173 occurrences to 889 nodes, 184 leaves, and 7,026 occurrences; on that identical view the compatibility package demands 209 of 234 chunks (107,337,264 bytes) and the leaf-anchor package 152 (78,875,544 bytes), every window stays inside the budget, and 48 navigation queries cost p95 0.405 ms / 0.330 ms | Passed in headed Chrome 151 on Windows over three runs per payload order; first coarse frame 4.213-4.388 s, inside the ADR-0008 15 s bound; Firefox and Safari repeats remain |
| In-flight cancellation | A second browser run cancels while range 2/3 is pending, observes `Scene load cancelled.`, and proves that range 3/3 is never requested | Passed in headed Chrome and Firefox |
| Browser conformance | Headed Chrome/Blink and Firefox/Gecko emit no console warnings or errors | Passed by `pnpm browser:matrix` |
| Safari capability | Real Safari 26.6.1 on macOS Sequoia loads all 87 hierarchy records under default settings, then reports that WebGPU is unavailable because `navigator.gpu` is absent; Apple enables WebGPU by default only in Safari 26 on macOS 26 (Tahoe) and newer OS releases | Graceful unsupported-browser result; rendering conformance not yet available |
| Public review | [GitHub Pages](https://1n01raymond.github.io/naru/) serves the qualified Digital Hub package by default and PyGamer as a secondary scene; deployment verifies the package digests and smoke-checks the live app, declared resources, and HTTP Range delivery | Passed by `.github/workflows/deploy-demo.yml` and `pnpm demo:smoke` |

## Large-coordinate precision

ADR-0005 is now accepted for the tessellated display path. Its project-owned
control places a 0.25 mm gap between two 40 mm plates near the origin and at a
10,000 km world offset. The compiler retains translations beyond its 10 nm f32
delivery-error budget; runtime transform composition stays in JavaScript number
precision; and the renderer subtracts high/low camera origins from high/low
instance translations before f32 projection. Section and picking use the same
relative frame.

| Signal | Evidence | Status |
|---|---|---|
| Measurement | Near and far packages both report 0.249999613 mm; absolute error is 0.000000387 mm against the 0.001 mm budget | Passed |
| Untreated risk | At 10,000,000 m the f32 ULP is 1 m and naive f32 plate centres collapse, yielding a −40 mm calculated gap | Recorded |
| Visual stability | Initial, fixed orbit/pan/zoom, and X-section canvases are byte-identical between near/far scenes in each engine | Passed with 0 px drift in headed Chrome 151 and Firefox 150 |
| Interaction | Both locations retain the same picked occurrence and produce no console issues | Passed |
| Standards/package integrity | Both packages pass Khronos glTF validation with 0 errors / 0 warnings; resources and screenshots are digest-pinned | Passed by `pnpm precision:check` |

See `artifacts/precision/large-coordinates/`. This does not upgrade the real
Safari capability result: Safari 26.6.1 on macOS Sequoia still lacks
`navigator.gpu` under the recorded default settings, because Apple ships
WebGPU enabled by default only with Safari 26 on macOS 26 (Tahoe) and newer
OS releases.

## Reproduce

```sh
pnpm phase1:compile:evidence
pnpm naru compile fixtures/step/repeated-fasteners-ap242.step \
  --output output/repeated-fasteners-ap242
pnpm phase1:evidence:check
pnpm ifc:edges:check
pnpm browser:matrix
pnpm safari:compatibility
pnpm precision:evidence
pnpm precision:check
pnpm cache:evidence
pnpm cache:check
pnpm demand:priority:check
pnpm demo:smoke
pnpm check
```

See `artifacts/phase1/README.md` for the compiled package,
`artifacts/browser-matrix/README.md` for reviewed Chrome/Firefox screenshots,
`artifacts/browser-safari/README.md` for the real-Safari capability record, and
`artifacts/precision/large-coordinates/README.md` for ADR-0005 evidence, and
`packages/compiler/README.md` for the profile boundary.

## Phase 2 and later evidence backlog

The items below are known limits and follow-up decision gates. They do not block
the Phase 1 exit criteria closed in the [completion report](PHASE_1_REPORT.md).

- Shape-preserving and screen-space LODs, compression,
  persistent cache tiers, and a general cache-aware eviction policy under a
  bounded residency budget. The optional ADR-0008 compiler sidecar, strict
  decoder, and frustum-demand scheduler have focused headed evidence, Digital
  Hub/sixty5 offline co-demand censuses, and headed Digital Hub and sixty5
  localized traces, the latter measuring demand where the residency budget
  actually binds; a non-Blink repeat of either is still pending, and so is the
  nested-view cross-check against ADR-0005. Historical packages continue
  through the retained-coarse chunk-bounds fallback.
- A demand ordering that is better from every viewpoint. Ordering by projected
  screen area beats the default distance ordering decisively on a close view
  and loses to it on a mid view of the same model
  (`artifacts/spatial-demand/sixty5-demand-priority/README.md`), so it ships
  opt-in; a blended or screen-space-error cost is unrecorded. The score is
  pixel agreement against an unbudgeted render of the same pose on one host,
  one browser, and two scripted camera poses — not a frame-time or bandwidth
  claim.
- Cross-host byte reproducibility of the IFC adapter. Re-extracting the
  qualified Digital Hub sources on Windows reproduces every count, the
  `properties.bin` column file, the compiled target/coarse byte lengths, and
  both `spatial.bin` sidecars byte for byte, but the Scene IR differs by 8
  bytes from the macOS record (`artifacts/spatial-demand/digital-hub-localized/README.md`),
  so the compiled package digests differ across hosts. The sixty5 spatial
  packages are pinned from this Windows host for the same reason
  (`artifacts/spatial-demand/sixty5-localized/README.md`). Determinism is proven
  per host, not across them.
- Full material, mass, PMI, and domain-specific property schemas remain
  pending, and Studio search does not index property values (a deliberate
  Phase 1 limit — the sidecar is resolved per selected occurrence only).
- A Firefox repeat and any benchmark or ADR-0003 renderer-decision claim for
  sixty5 remain unrecorded. The Chrome first-useful-frame boundary itself is now
  closed by `artifacts/ifc/sixty5-first-frame/`.
- A resident endpoint that covers the model. Sharing a prototype's vertex pool
  across its material groups removed the last individually unadmittable sixty5
  chunk and raised the endpoint to 111 of 234, but 123 chunks still do not fit
  a 64 MiB budget; covering the model needs LOD or a larger budget policy, not
  a smaller chunk.
- Additional repeated reference-hardware profiles for ADR-0003; the first
  Apple-Silicon integrated-GPU record now shows divergent Chrome and Firefox
  CPU-p95 outcomes.
- A reproducible public performance report. The deployed Studio and its package
  delivery are smoke-checked, but no public benchmark report is published yet.
- A current-toolchain (split.4 explicit-edge) re-record of the Digital Hub and
  sixty5 federation packages, including the released demo package that
  `deploy-demo.yml` digest-verifies, and a real-large cache-reopen
  distribution; the import-cache record pins the current Digital Hub digest
  while the federation record remains deliberately historical.

The canonical fixture is Adafruit's real PyGamer electronics assembly,
redistributed unchanged under MIT with a pinned source commit and notice. Its
temporary 80.6 MB Scene IR JSON compiles to a 19.2 MB glTF package, exposing the
next concrete optimization targets: progressive partitions, compression, LOD,
and bounded residency.

## Phase 2 implementation context

The IFC-discovered 3,383 prototype ranges now coalesce into 45 deterministic
512 KiB target requests (one indivisible 1.12 MiB prototype remains whole),
and the browser reconciles only changed GPU batches under fixed 64 MiB decoded
and GPU admission caps. A selected target now pins its detail and evicts colder
target groups to their retained coarse fallbacks. Camera navigation now
re-ranks retained-coarse chunk bounds, cancels obsolete Range/Worker
work, and updates eviction priority. The persistent Worker now prepares active
transforms and direct chunk occurrence membership once, eliminating node-graph
walks from later target Range decodes. The optional ADR-0008 path now queries a
compiler-built occurrence BVH and requests only visible-leaf target demand.
Opt-in leaf-anchor payload ordering now feeds that BVH partition back into the
existing byte-budget coalescer. The Digital Hub and sixty5 leaf censuses pass
with 39.89% and 39.47% less off-view payload respectively. The assembly list is
now virtualized, so hierarchy size no longer bounds the first frame. That
faster page exposes the remaining real-large residency defects directly: the
drain stops at the first chunk the byte budget rejects instead of skipping it
and continuing, and the status can stamp `ready` before the resident set has
settled — so the recorded endpoint shrank to 55 of 234 target chunks. The next
drain now skips rejected chunks and continues, `ready` waits for an idle
scheduler, and visibility is reconciled through changed batches only, so the
recorded endpoint is stable at 93 of 234 target chunks. Prefetch is now
estimate-gated: a chunk is priced from the parsed document before any bytes
move, and the 141 the budget cannot take are skipped rather than fetched and
decoded, holding the same endpoint from 93 requests instead of 234. The
endpoint itself has now moved: a prototype's vertex pool is decoded once and
shared by its material groups instead of copied per group, which cuts the
package's total chunk cost from 230,730,336 to 129,154,008 bytes, shrinks the
largest chunk from 75,373,776 to 1,334,976, and leaves no chunk that a 64 MiB
budget cannot hold on its own — the recorded endpoint is 111 of 234 chunks and
2,255,235 resident triangles. What remains is a budget-policy question rather
than a chunk-shape one. The Digital Hub localized trace is now recorded
(`artifacts/spatial-demand/digital-hub-localized/`): a localized view demands 52
of 71 chunks under the default order and 42 of 66 under leaf-anchor ordering,
which is the first browser-side confirmation that the offline off-view census
predicts what the scheduler actually asks for. Digital Hub fits the residency
budget whole, so that trace was repeated over sixty5, where it does not
(`artifacts/spatial-demand/sixty5-localized/`): the localized view demands 209
of 234 chunks under the default order against 152 under leaf-anchor ordering
— 27.3% fewer chunks and 26.5% fewer bytes, a wider margin than Digital Hub's
— while every window stays inside the 64 MiB budget and the first coarse frame
does not move. ADR-0008 now lacks only a non-Blink repeat and the nested-view
cross-check against ADR-0005. Screen-space priority is the increment that
follows from it and is now recorded
(`artifacts/spatial-demand/sixty5-demand-priority/`): the scheduler can order
demand by the clipped screen area a leaf projects to instead of by its distance
to the view centre, selected per session with `?demandPriority=screen-coverage`
and scored against a 192 MiB reference render of the identical pose. On a close
view it agrees with that reference in 99.12% of pixels against 64.95% for the
default ordering at the same 64 MiB budget; on a mid view the direction
reverses (93.86% against 96.31%). Area ordering is therefore opt-in, the
default ordering is unchanged byte for byte, and the validator pins which
policy wins per record. The next increments are a demand cost that blends
projected area with distance — neither policy is uniformly better — and
persistent cache tiers.

On the compiler side the structure document now streams record by record,
property keys and key combinations are interned once at scene level, and the
property values live in a deduplicated binary column file the compiler never
materializes — the sixty5 structure is down to 345,472,410 bytes with every
downstream output invariant verified in `artifacts/ifc/sixty5/`. The compiled
package now republishes those properties as the `madi.package-properties.1`
sidecar and the Studio resolves the selected occurrence's property sets
lazily through the same column reader; full-text search over property values
remains a deliberate Phase 1 exclusion. Focused E2.1 explicit IFC boundaries
are now recorded; analytic curve kinds, richer edge classification, and a
real-model edge re-record remain future increments. The browser gate for the
sixty5 package is now
recorded (`artifacts/ifc/sixty5-browser/`): loading, bounded residency,
picking, and lazy property resolution hold at real-large scale. The named
268.0 s main-thread first-frame path is now reduced to a 4.283 s median by
the shared-coarse/persistent-Worker follow-up, the virtualized assembly list,
skip-and-continue residency admission, estimate-gated prefetch, and a vertex
pool shared across a prototype's material groups in
`artifacts/ifc/sixty5-first-frame/`, which reaches a 111-chunk endpoint from
111 range requests. The ADR-0009 persistent import cache is
now recorded product evidence (`artifacts/cache/`): unchanged pinned sources
restore byte-identically in seconds instead of recompiling, and corrupt
entries fail closed. Spatial partitioning and a first screen-space demand
policy are now recorded; a view-independent demand cost and runtime cache
tiers remain the next runtime increments.

The first incremental IFC prerequisite is also implemented under proposed
ADR-0010: each compile and whole-package cache entry carries a deterministic
discipline dependency index, with focused changed/deleted/renamed and
cross-document reconciliation tests. The following increment now reuses
verified unchanged per-document adapter artifacts and proves its merged adapter
bytes against a clean build. Federation-wide compiled payload reuse and
complete-package equivalence are the next compiler increment.

In parallel, the repeated 100k record now carries GPU pass timestamps and a
backend-owned retained-resource census on both the discrete host and an Apple
M4 Pro integrated-GPU host. Chrome reproduces the continuation signals on the
integrated host, but Firefox does not reproduce the CPU-p95 advantage, making
the cross-browser variance itself decision evidence. Remaining before the
renderer decision: add more reference-hardware sessions, replace procedural
variants with a redistributable engineering assembly or design-partner
aggregate, and add equivalent explicit-edge and bounded-residency slices. Keep
the committed browser matrices labeled exploratory until those independent
signals converge.
