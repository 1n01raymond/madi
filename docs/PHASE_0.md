# Phase 0 Evidence Tracker

Status: In progress

Phase 0 validates the riskiest boundaries before MADI commits to a delivery
format or a full Studio product. The authoritative outcomes and exit criteria
remain in [the roadmap](ROADMAP.md); this document links each claim to
reproducible repository evidence.

## Bootstrap delivered

| Area | Evidence | Current limit |
|---|---|---|
| Workspace | pnpm workspace, strict TypeScript, ESLint, Vitest, Vite, and CI | Native jobs are not yet gated in CI |
| Scene IR | `@madi/scene-ir`, independent validator, and an OCCT-produced engineering scene artifact | The JSON evidence is not a frozen disk schema |
| WebGPU | multi-prototype `@madi/runtime-webgpu` scene plus a reproducible Chrome/Blink and Firefox/Gecko visual/picking matrix | Evidence currently covers one Windows/NVIDIA workstation, not the supported hardware matrix |
| OCCT | isolated native boundary plus a reproducible OCCT 7.9.3 STEPCAF/XDE evidence harness | The local machine still lacks CMake, a C++ compiler, and a native OCCT development package |
| Fixtures | two MADI-authored STEP files with provenance checks; the assembly is independently read through OCCT/XDE | An unsupported-entity diagnostic fixture is not selected yet |
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
  fixtures/step/repeated-fasteners.step \
  --scene artifacts/occt/repeated-fasteners.scene.json \
  --report artifacts/occt/repeated-fasteners.report.json
pnpm test
```

The WebGPU spike now renders three geometry prototypes as ten part occurrences.
The fastener geometry is uploaded once and instanced eight times. A separate
explicit-edge pass draws OCCT-derived polylines, an integer attachment records
object IDs, and a click resolves the selected occurrence to its revision-local
OCCT edge references. This remains feasibility evidence, not yet the scalable
streaming runtime API.

## Outcome checklist

- [x] Product requirements and scope are written.
- [ ] The first architecture decisions are reviewed and accepted.
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
| Repeated occurrences reuse geometry | Real STEP assembly shows one prototype referenced by multiple occurrences without duplicate geometry arrays | Passed: one fastener prototype feeds eight occurrence instances |
| Source edges survive selection | Picked edge or selected occurrence resolves through representation source map to an OCCT edge reference | Passed for occurrence selection: the matrix resolves object ID 2 to `center-rail` and 12 OCCT edge refs; primitive edge picking remains future work |
| Direct WebGPU works in two engines | Browser, OS, GPU, screenshot, adapter info, and picking result recorded | Passed on Chrome 151/Blink and Firefox 150/Gecko on Windows; screenshots, metadata, and hashes are in `artifacts/browser-matrix` |
| Unsupported data is reported | Known unsupported fixture produces stable diagnostic codes and a build report | Pending |

## Next pull requests

1. `codex/unsupported-entity-diagnostics`: add a fixture that exercises stable
   unsupported-data diagnostics and a build report.
2. `codex/accept-bootstrap-adrs`: accept or revise the decisions that the spikes
   support; keep unproven decisions proposed.

Phase 0 exits only when the roadmap criteria are demonstrated. A green bootstrap
CI run is necessary infrastructure, not completion evidence.
