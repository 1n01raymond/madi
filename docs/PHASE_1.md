# Phase 1 Evidence Tracker

Status: In progress

Phase 1 turns the feasibility path into a reproducible STEP-to-browser vertical
slice and retires selected source-adapter risks before Phase 2. The roadmap
remains authoritative; this record distinguishes committed evidence from
planned behavior.

## First compiler slice

The first slice accepts local STEP AP242/AP214 through the isolated OCCT adapter
and compiles its validated `EngineeringScene` into standard glTF 2.0 JSON plus
an external binary resource and machine-readable adapter/compiler reports. The
expanded Scene IR is temporary. This intentionally avoids defining a MADI CAD
or delivery container.

| Signal | Evidence | Status |
|---|---|---|
| Deterministic output | Two compilations compare JSON, binary, and report bytes | Passed in `packages/compiler/test/gltf.test.ts` |
| Standards validation | Official Khronos glTF Validator checks JSON and external binary | Passed with 0 errors / 0 warnings |
| Prototype reuse | The canonical package reuses one 0603 mesh 26 times and one 0805 mesh 11 times; the focused regression keeps 8-way fastener reuse | Passed |
| Engineering edges | Canonical glTF line primitives retain 13,897 explicit OCCT edge segments | Passed |
| Source identity | Report source digest matches OCCT evidence; node/mesh `extras` retain IDs and refs | Passed for experimental profile |
| Independent package validation | Hashes, ranges, hierarchy, counts, and report parity are checked without compiler state | Passed by `pnpm phase1:evidence:check` |
| Direct AP242 input | `pnpm madi compile` preflights the Part 21 schema, runs OCCT STEPCAF/XDE, cross-checks source SHA-256, and removes temporary Scene IR | Passed with the checksum-locked `repeated-fasteners-ap242.step` package |
| Coarse/target split | Direct STEP output keeps target meshes in `scene.bin` and emits 3 reusable prototype AABBs in a 2.7 KiB `coarse.bin`; both remain standard external glTF buffers | Passed with 0 Khronos validator errors/warnings |
| Partial target delivery | Compiler records three non-overlapping prototype ranges that cover `scene.bin`; the Worker issues exact HTTP Range requests and promotes one target batch per completed range | Passed by package/runtime tests and headed Chrome/Firefox evidence |

### Early IFC federation risk slice

The separate `madi compile-ifc` entry now accepts repeated discipline/document
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

## First browser runtime slice

The browser now consumes that compiled package directly. It reads the glTF node
graph and MADI identity metadata on the main thread, then fetches and decodes the
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
| Scene inspection | Tokenized hierarchy search covers names and source identity before geometry residency; viewport/tree/search selection share an occurrence property panel with bounded edge-reference previews | Passed by search unit tests and cross-browser interaction review |
| Scene opening | HTTP(S) glTF URLs are shareable through `?scene=`; a validated local `.gltf` plus all declared `.bin` resources load entirely client-side and decode their `File` objects in the Worker without a binary network request | Passed by source unit tests and the Chrome/Firefox browser matrix |
| Useful frame before target | Recorder holds the first target Range response, captures a 36-triangle/36-edge coarse frame, then releases all ranges and observes promotion to 2,076 triangles/181 edges | Passed in headed Chrome and Firefox |
| Mixed-residency frame | Recorder releases only the first 31.7 KiB range, captures 8 detailed fasteners alongside two retained coarse batches at 380 triangles/61 edges, then completes the remaining ranges | Passed in headed Chrome and Firefox |
| In-flight cancellation | A second browser run cancels while range 2/3 is pending, observes `Scene load cancelled.`, and proves that range 3/3 is never requested | Passed in headed Chrome and Firefox |
| Browser conformance | Headed Chrome/Blink and Firefox/Gecko emit no console warnings or errors | Passed by `pnpm browser:matrix` |

## Reproduce

```sh
pnpm phase1:compile:evidence
pnpm madi compile fixtures/step/repeated-fasteners-ap242.step \
  --output output/repeated-fasteners-ap242
pnpm phase1:evidence:check
pnpm browser:matrix
pnpm check
```

See `artifacts/phase1/README.md` for the compiled package,
`artifacts/browser-matrix/README.md` for reviewed screenshots, and
`packages/compiler/README.md` for the profile boundary.

## Not yet proven

- Shape-preserving LODs, spatial partitioning, compression, camera-driven
  reprioritization, and a general cache-aware eviction policy under a bounded
  residency budget. The current selection path can only restore retained coarse
  fallback batches.
- Full material, mass, PMI, and domain-specific property schemas remain pending.
- A repeated reference-hardware and integrated-GPU decision matrix for ADR-0003.
- Large-coordinate precision behavior required by ADR-0005.
- A public end-to-end review workflow and reproducible performance report.

The canonical fixture is Adafruit's real PyGamer electronics assembly,
redistributed unchanged under MIT with a pinned source commit and notice. Its
temporary 80.6 MB Scene IR JSON compiles to a 19.2 MB glTF package, exposing the
next concrete optimization targets: progressive partitions, compression, LOD,
and bounded residency.

## Next slice

The IFC-discovered 3,383 prototype ranges now coalesce into 45 deterministic
512 KiB target requests (one indivisible 1.12 MiB prototype remains whole),
and the browser reconciles only changed GPU batches under fixed 64 MiB decoded
and GPU admission caps. A selected target now pins its detail and evicts colder
target groups to their retained coarse fallbacks. The next scheduler increment
is persistent cache tiers and camera/view reprioritization.

In parallel, advance the repeated 100k record onto genuinely different hardware
before widening Studio UI. Add GPU timestamp queries and allocator/GPU retained-
memory accounting, run the locked matrix on an integrated-GPU profile, and
replace procedural variants with a redistributable engineering assembly or
design-partner aggregate. Then add equivalent explicit-edge and bounded-
residency slices. Keep the committed browser matrices labeled exploratory until
those independent signals converge.
