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

## Reproduce

```sh
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
pnpm check
```

See `artifacts/phase1/README.md` for the committed result and
`packages/compiler/README.md` for the profile boundary.

## Not yet proven

- Direct local STEP AP242 input into the Phase 1 compiler entry point.
- Coarse and target LODs, partitioning, compression, and progressive loading.
- Runtime consumption of `scene.gltf` / `scene.bin` in a Worker.
- Hierarchy-first interaction before geometry residency.
- The Three.js comparison required by ADR-0003.
- Large-coordinate precision behavior required by ADR-0005.
- A public end-to-end review workflow and reproducible performance report.

## Next slice

Load the compiled glTF package in the browser without reconstructing the Phase 0
Scene IR JSON. The runtime should fetch hierarchy/metadata first, decode binary
geometry in a Worker, preserve occurrence/source identity, and render the same
surface, edge, and picking result.
