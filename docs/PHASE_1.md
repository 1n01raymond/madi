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

### Split Scene IR transport and the real-large boundary

The adapter no longer hands the compiler one expanded JSON document. It writes
structure-only JSON whose representation surfaces hold
`{encoding, byteOffset, byteLength}` references into a separate little-endian
geometry file, reports a SHA-256 for each half, and the compiler resolves those
references into typed-array views without copying.

| Signal | Evidence | Status |
|---|---|---|
| Transport equivalence | Digital Hub recompiles to the same `a6d5c0eecebf` package digest from the split pair | Passed |
| Intermediate reduction | One 81,805,061-byte document became a 39,135,637-byte structure plus a 28,134,848-byte geometry file | Passed |
| Hydration contract | Stream bounds, encodings, element alignment, unaligned buffers, and unencodable members are unit-checked | Passed in `packages/compiler/test/ifc-scene.test.ts` |
| Real-large extraction | The seven-document IFC2X3 sixty5 federation extracts 192,316 semantic entities, 78,173 geometric occurrences, 42,435 prototypes, and 4,866,386 unique triangles from 40,310,966 submitted | Passed, recorded in `artifacts/ifc/sixty5/` |
| Structure streaming | The compiler parses the structure document record by record in bounded chunks instead of one string, and reproduces the Digital Hub package digest byte for byte | Passed in `packages/compiler/test/ifc-structure-stream.test.ts` and the recompiled `artifacts/ifc/digital-hub/` record |
| Real-large compile | Its 631,943,761-byte structure exceeds the 536,870,888-byte maximum string length; the streaming reader compiles it into a Khronos-clean (0 errors / 0 warnings) 608.2 MB package — 78,173 renderable occurrences, 4,866,386 unique triangles — byte-identical across two full runs, peaking at ≈3.8 GB compiler RSS inside the default V8 heap | Passed, recorded in `artifacts/ifc/sixty5/` |

Splitting geometry out was necessary but not sufficient: the remaining bulk is
4,503,078 flattened property values and 188,319 occurrence records. The
record-streaming reader lifts the one-string ceiling without changing the
transport format; shrinking the structure itself (indexed properties) remains
a named follow-up.

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
- A browser, residency, or benchmark result for the compiled real-large sixty5
  federation. Its 608.2 MB package now exists with Khronos validation, but no
  runtime has consumed it.
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

On the compiler side the structure document now streams record by record, and
the sixty5 end-to-end compile evidence (package digest, Khronos validation,
determinism, peak memory) is recorded in `artifacts/ifc/sixty5/`. The next
compiler increment is shrinking the structure itself — the 4,503,078 flattened
property values dominate the resident scene — and the next evidence gate is a
browser result for that compiled real-large package.

In parallel, the repeated 100k record now carries GPU pass timestamps and a
backend-owned retained-resource census on the discrete host: the MADI surface
pass is sub-millisecond, so the ADR-0003 comparison at this tier is CPU-side,
and cross-session CPU-p95 variance (27.0% then 23.9% Chrome medians) is
itself recorded evidence. Remaining before the renderer decision: run the
locked matrix on an integrated-GPU profile (procedure committed with the
GPU-timing record), replace procedural variants with a redistributable
engineering assembly or design-partner aggregate, and add equivalent
explicit-edge and bounded-residency slices. Keep the committed browser
matrices labeled exploratory until those independent signals converge.
