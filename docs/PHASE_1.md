# Phase 1 Evidence Tracker

Status: In progress

Phase 1 turns the feasibility path into a reproducible STEP-to-browser vertical
slice. The roadmap remains authoritative; this record distinguishes committed
evidence from planned behavior.

## First compiler slice

The first slice compiles the real OCCT-derived `EngineeringScene` into standard
glTF 2.0 JSON plus an external binary resource and a machine-readable build
report. It intentionally avoids defining a MADI CAD or delivery container.

| Signal | Evidence | Status |
|---|---|---|
| Deterministic output | Two compilations compare JSON, binary, and report bytes | Passed in `packages/compiler/test/gltf.test.ts` |
| Standards validation | Official Khronos glTF Validator checks JSON and external binary | Passed with 0 errors / 0 warnings |
| Prototype reuse | The canonical package reuses one 0603 mesh 26 times and one 0805 mesh 11 times; the focused regression keeps 8-way fastener reuse | Passed |
| Engineering edges | Canonical glTF line primitives retain 13,897 explicit OCCT edge segments | Passed |
| Source identity | Report source digest matches OCCT evidence; node/mesh `extras` retain IDs and refs | Passed for experimental profile |
| Independent package validation | Hashes, ranges, hierarchy, counts, and report parity are checked without compiler state | Passed by `pnpm phase1:evidence:check` |

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
| Scene opening | HTTP(S) glTF URLs are shareable through `?scene=`; a validated local `.gltf` + `.bin` pair loads entirely client-side and decodes its `File` in the Worker without a binary network request | Passed by source unit tests and the Chrome/Firefox browser matrix |
| Browser conformance | Headed Chrome/Blink and Firefox/Gecko emit no console warnings or errors | Passed by `pnpm browser:matrix` |

## Reproduce

```sh
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
pnpm browser:matrix
pnpm check
```

See `artifacts/phase1/README.md` for the compiled package,
`artifacts/browser-matrix/README.md` for reviewed screenshots, and
`packages/compiler/README.md` for the profile boundary.

## Not yet proven

- Direct local STEP AP242 input into the Phase 1 compiler entry point.
- Coarse and target LODs, partitioning, compression, and progressive loading.
- Useful first render before a delayed or large target-geometry payload completes.
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

Advance the new 100k heterogeneous/culling record into decision-quality evidence
before widening Studio UI. Replace procedural variants with a redistributable
engineering assembly or design-partner aggregate, isolate retained scene memory,
add GPU timestamp queries, and repeat clean runs on discrete and integrated GPU
profiles. Then add equivalent explicit-edge and bounded-residency slices. Keep
both committed browser matrices labeled as exploratory evidence until that
contract is complete.
