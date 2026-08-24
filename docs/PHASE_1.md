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
| Transport equivalence | Digital Hub recompiled to the same `a6d5c0eecebf` package digest from the split pair at split.1; under split.2 property indexing, `scene.bin`, `coarse.bin`, and every compiler count stay identical and `scene.gltf` differs only through the recorded `optionsDigest` (current digest `98399341020d`) | Passed |
| Intermediate reduction | One 81,805,061-byte document became a 39,135,637-byte structure plus a 28,134,848-byte geometry file; property indexing (split.2) then shrank the structure to 30,592,935 bytes — 62.6 % below the single document | Passed |
| Hydration contract | Stream bounds, encodings, element alignment, unaligned buffers, and unencodable members are unit-checked | Passed in `packages/compiler/test/ifc-scene.test.ts` |
| Real-large extraction | The seven-document IFC2X3 sixty5 federation extracts 192,316 semantic entities, 78,173 geometric occurrences, 42,435 prototypes, and 4,866,386 unique triangles from 40,310,966 submitted | Passed, recorded in `artifacts/ifc/sixty5/` |
| Structure streaming | The compiler parses the structure document record by record in bounded chunks instead of one string, and reproduces the Digital Hub package digest byte for byte | Passed in `packages/compiler/test/ifc-structure-stream.test.ts` and the recompiled `artifacts/ifc/digital-hub/` record |
| Real-large compile | The split.1 structure measured 631,943,761 bytes — past the 536,870,888-byte maximum string length — and the streaming reader compiled it into a Khronos-clean (0 errors / 0 warnings) 608.2 MB package, byte-identical across two full runs, peaking at ≈3.8 GB compiler RSS inside the default V8 heap (recorded at commit `41e6973`) | Passed; split.1 record preserved in history |
| Property indexing | Interning 35,510 keys / 299 key-sets (sixty5) and 1,656 / 279 (Digital Hub) once at scene level shrinks the sixty5 structure to 419,502,749 bytes (−33.6 %) — back under the maximum string length — while geometry, `scene.bin`, `coarse.bin`, every compiler count, and all resolvable property values stay unchanged | Passed, recorded in `artifacts/ifc/sixty5/` and `artifacts/ifc/digital-hub/` |

Splitting geometry out was necessary but not sufficient: the remaining bulk is
4,503,078 flattened property values and 188,319 occurrence records. The
record-streaming reader lifts the one-string ceiling without changing the
transport format, and property-key indexing (split.2) removed the repeated key
text; encoding the property values themselves in a binary column form remains
a named follow-up.

### Real-large browser residency

Headed Chrome now consumes that compiled sixty5 package end to end, with the
served bytes digest-verified against the committed build report before
recording. The record is `artifacts/ifc/sixty5-browser/`, checked by
`pnpm ifc:browser:check`.

| Signal | Evidence | Status |
|---|---|---|
| Real-large load | The 448.8 MB `scene.gltf` parses and lists 188,319 occurrence records in 3.5 s; the first coarse WebGPU frame with all 78,173 renderable occurrences appears at 264.6 s and the ready state at 323.8 s | Passed, recorded in headed Chrome 151 |
| Bounded residency | Under the default 64 MiB decoded/GPU budgets, promotion stops at 26 of 234 target chunks with 66,951,636 decoded / 60,644,136 GPU resident bytes; the other 208 chunks retain coarse fallbacks and `targetReady` reports `limited` | Passed; the resident set reproduced exactly across two runs |
| Standard delivery | All 27 `scene.bin` requests are HTTP 206 `bytes=` Ranges; the budget-limited frame renders 975,013 triangles and 466,452 coarse edge segments with zero console issues | Passed |
| Source picking | A center-canvas click resolves one concrete foundation beam to glTF node 148735, object ID 148736 | Passed |
| First-frame boundary | The Worker decode of the 37.8 MB `coarse.bin` takes 7.3 s; the rest of the 261.1 s to the first frame sits on the main-thread document handoff and 42,588-batch construction path | Recorded as the named Phase 2 optimization input |

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
| Safari capability | Real Safari 18.6 loads 87 hierarchy records under default settings, then reports that WebGPU is unavailable because `navigator.gpu` is absent | Graceful unsupported-browser result; rendering conformance not yet available |

## Reproduce

```sh
pnpm phase1:compile:evidence
pnpm madi compile fixtures/step/repeated-fasteners-ap242.step \
  --output output/repeated-fasteners-ap242
pnpm phase1:evidence:check
pnpm browser:matrix
pnpm safari:compatibility
pnpm check
```

See `artifacts/phase1/README.md` for the compiled package,
`artifacts/browser-matrix/README.md` for reviewed Chrome/Firefox screenshots,
`artifacts/browser-safari/README.md` for the real-Safari capability record, and
`packages/compiler/README.md` for the profile boundary.

## Not yet proven

- Shape-preserving LODs, spatial partitioning, compression, camera-driven
  reprioritization, and a general cache-aware eviction policy under a bounded
  residency budget. The current selection path can only restore retained coarse
  fallback batches.
- Full material, mass, PMI, and domain-specific property schemas remain pending.
- A useful first frame at real-large scale. The recorded sixty5 browser result
  (`artifacts/ifc/sixty5-browser/`) proves loading, bounded residency, and
  picking, but its 264.6 s first coarse frame is dominated by the main-thread
  per-prototype batch path; no run yet demonstrates an early frame there. A
  Firefox repeat and any benchmark or ADR-0003 claim for sixty5 also remain
  unrecorded.
- Additional repeated reference-hardware profiles for ADR-0003; the first
  Apple-Silicon integrated-GPU record now shows divergent Chrome and Firefox
  CPU-p95 outcomes.
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
property keys and key combinations are interned once at scene level — the
sixty5 structure is down to 419,502,749 bytes with every downstream output
invariant verified in `artifacts/ifc/sixty5/`. The next compiler increment is
a binary column encoding for the property values themselves — they still
dominate the resident scene. The browser gate for that package is now
recorded (`artifacts/ifc/sixty5-browser/`): loading, bounded residency, and
picking hold at real-large scale, and the 264.6 s first coarse frame names the
next runtime increment — cutting the main-thread per-prototype batch path
that dominates it.

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
