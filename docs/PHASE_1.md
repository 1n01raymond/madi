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
| Prototype reuse | Eight fastener occurrence nodes reference one mesh | Passed |
| Engineering edges | glTF line primitives retain 181 explicit OCCT edge segments | Passed |
| Source identity | Report source digest matches OCCT evidence; node/mesh `extras` retain IDs and refs | Passed for experimental profile |
| Independent package validation | Hashes, ranges, hierarchy, counts, and report parity are checked without compiler state | Passed by `pnpm phase1:evidence:check` |

## First browser runtime slice

The browser now consumes that compiled package directly. It reads the glTF node
graph and MADI identity metadata on the main thread, then fetches and decodes the
external binary in a Worker before transferring packed typed arrays to the
direct WebGPU renderer. The Phase 0 Scene IR JSON is no longer a browser input.

| Signal | Evidence | Status |
|---|---|---|
| Hierarchy first | Recorder observes 12 occurrence records before the Worker requests `scene.bin` | Passed in Chrome and Firefox |
| Worker boundary | Binary fetch, accessor validation, decoding, and transferable collection run in `geometry.worker.ts` | Passed |
| Prototype reuse | Three GPU batches render 10 parts; eight fasteners share one mesh/buffer set | Passed |
| Engineering rendering | 2,076 unique triangles and 181 explicit edge segments reproduce the compiler report | Passed |
| Source picking | Center rail resolves glTF node 2, object ID 3, and 12 revision-local CAD edge refs | Passed |
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
- Orbit/pan/zoom, tree-driven selection, hide/isolate, and section interaction.
- The Three.js comparison required by ADR-0003.
- Large-coordinate precision behavior required by ADR-0005.
- A public end-to-end review workflow and reproducible performance report.

## Next slice

Turn the proof viewport into the first review interaction slice: orbit, pan,
zoom, fit, tree-to-viewport selection, and hide/isolate over the compiled glTF
node table. Keep scene identity independent from GPU residency and record the
interaction behavior in both browser engines.
