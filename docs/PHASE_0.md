# Phase 0 Evidence Tracker

Status: Complete (2026-08-23)

Phase 0 validates the riskiest boundaries before NARU commits to a delivery
format or a full Studio product. The authoritative outcomes and exit criteria
remain in [the roadmap](ROADMAP.md); this document links each claim to
reproducible repository evidence.

## Bootstrap delivered

| Area | Evidence | Current limit |
|---|---|---|
| Workspace | pnpm workspace, strict TypeScript, ESLint, Vitest, Vite, and CI | Native jobs are not yet gated in CI |
| Scene IR | `@naru3d/scene-ir`, independent validator, and an OCCT-produced engineering scene artifact | The JSON evidence is not a frozen disk schema |
| WebGPU | multi-prototype `@naru3d/runtime-webgpu` scene plus a reproducible Chrome/Blink and Firefox/Gecko visual/picking matrix | Evidence currently covers one Windows/NVIDIA workstation, not the supported hardware matrix |
| OCCT | isolated native boundary plus a reproducible OCCT 7.9.3 STEPCAF/XDE evidence harness | The local machine still lacks CMake, a C++ compiler, and a native OCCT development package |
| Fixtures | three NARU-authored STEP files plus one pinned MIT-licensed Adafruit electronics assembly; all carry checksum and license checks | The unsupported case covers one AP214 semantic entity, not the broader STEP feature matrix |
| Benchmarks | machine-readable Scene IR validation microbenchmark | Bootstrap smoke metric, not a rendering performance claim |

## Reproduce the bootstrap

Requires Node.js 22.12 or newer and pnpm 11.

```sh
pnpm install
pnpm check
pnpm dev
pnpm benchmark -- --iterations 1000 --out artifacts/benchmarks/scene-ir.json
pnpm native:check
```

The browser matrix is an explicit GPU test and is not part of the portable CI
gate. Install the pinned Firefox build once, then record to the ignored local
output directory:

```sh
pnpm exec playwright install firefox
pnpm browser:matrix
```

To regenerate the OCCT evidence with the Python binding harness, activate a
temporary virtual environment and run:

```sh
python -m pip install -r native/adapter-occt/tools/requirements-evidence.txt
python native/adapter-occt/tools/extract_scene_ir.py \
  fixtures/step/adafruit-pygamer.step \
  --scene output/occt/adafruit-pygamer.scene.json \
  --report artifacts/occt/adafruit-pygamer.report.json
python native/adapter-occt/tools/extract_scene_ir.py \
  fixtures/step/repeated-fasteners.step \
  --scene artifacts/occt/repeated-fasteners.scene.json \
  --report artifacts/occt/repeated-fasteners.report.json
python native/adapter-occt/tools/extract_scene_ir.py \
  fixtures/step/unsupported-layer-assignment.step \
  --scene artifacts/occt/unsupported-layer-assignment.scene.json \
  --report artifacts/occt/unsupported-layer-assignment.report.json
pnpm check
```

The current WebGPU proof renders the real PyGamer electronics assembly as 34
shared meshes and 85 part occurrences. One 0603 package is uploaded once and
instanced 26 times. A separate explicit-edge pass draws OCCT-derived polylines,
an integer attachment records object IDs, and a click resolves the joystick to
524 revision-local edge references. The original repeated-fastener assembly
remains the compact regression fixture. This is still feasibility evidence, not
the scalable streaming runtime API.

## Outcome checklist

- [x] Product requirements and scope are written.
- [x] The first architecture decisions are reviewed: ADRs 0001, 0002, 0004,
  and 0006 are accepted; ADRs 0003 and 0005 remain proposed with explicit
  benchmark and precision gates.
- [x] At least one redistributable STEP precision fixture and one assembly
  fixture are selected with checksums and license evidence.
- [x] Surface, explicit edge, instancing, and object-ID rendering are captured
  on two browser engines.
- [x] The OCCT spike extracts an assembly from a licensed fixture and records
  prototype reuse, occurrences, transforms, names, units, colors, faces, and
  source edge references.
- [x] A benchmark result schema and executable smoke harness exist.

## Exit-criteria evidence

| Criterion | Required evidence | Status |
|---|---|---|
| STEP assembly validates as Scene IR | OCCT extraction converted to `EngineeringScene`; validator report committed as an artifact | Passed: `apps/webgpu-spike/test/evidence.test.ts` hydrates and validates the committed scene |
| Repeated occurrences reuse geometry | Real STEP assembly shows one prototype referenced by multiple occurrences without duplicate geometry arrays | Passed: one PyGamer 0603 prototype feeds 26 occurrence instances; the focused fixture still proves 8-way fastener reuse |
| Source edges survive selection | Picked edge or selected occurrence resolves through representation source map to an OCCT edge reference | Passed for occurrence selection: the matrix resolves object ID 57 to the PyGamer joystick and 524 OCCT edge refs; primitive edge picking remains future work |
| Direct WebGPU works in two engines | Browser, OS, GPU, screenshot, adapter info, and picking result recorded | Passed on Chrome 151/Blink and Firefox 150/Gecko on Windows; screenshots, metadata, and hashes are in `artifacts/browser-matrix` |
| Unsupported data is reported | Known unsupported fixture produces stable diagnostic codes and a build report | Passed: AP214 layer entity `#2135` resolves to `OCCT_UNSUPPORTED_PRESENTATION_LAYER_ASSIGNMENT`; Scene IR, build report, and preserved geometry are enforced by `pnpm occt:diagnostics:check` |

## Phase 1 handoff

- Build the deterministic STEP AP242 compiler slice without freezing the
  evidence JSON as a delivery format.
- Add the comparable Three.js workload required to decide ADR-0003.
- Add large-coordinate visual and measurement cases required to decide
  ADR-0005.
- Turn the evidence viewer into the first review workflow: tree, properties,
  visibility, sectioning, and diagnostics.

Phase 0 exited after every roadmap criterion was demonstrated and the first ADR
review was recorded. The native C++ OCCT target, broad GPU coverage, large-scene
performance, and production delivery format remain Phase 1 or later work; this
completion is not a production-readiness claim.
