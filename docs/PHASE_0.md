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
| Scene IR | `@madi/scene-ir` types, repeated-prototype fixture, and independent validator | Logical in-memory contract only; no disk schema |
| WebGPU | `@madi/runtime-webgpu` and `apps/webgpu-spike` | One prototype batch; browser matrix results not yet published |
| OCCT | isolated CMake/XDE extraction executable | Local CMake, compiler, and OCCT prerequisites are not installed yet |
| Fixtures | licensed STEP manifest and validation policy | No external STEP fixture has passed license review yet |
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

The WebGPU spike renders one triangle prototype twice using a shared vertex and
index buffer, an occurrence instance buffer, a separate explicit-edge pass, and
an integer object-ID attachment. Clicking either occurrence reads its ID back
from the GPU. This is feasibility evidence, not yet a scalable runtime API.

## Outcome checklist

- [x] Product requirements and scope are written.
- [ ] The first architecture decisions are reviewed and accepted.
- [ ] At least one redistributable STEP precision fixture and one assembly
  fixture are selected with checksums and license evidence.
- [ ] Surface, explicit edge, instancing, and object-ID rendering are captured
  on two browser engines.
- [ ] The OCCT spike extracts an assembly from a licensed fixture and records
  prototype reuse, occurrences, transforms, names, units, colors, faces, and
  source edge references.
- [x] A benchmark result schema and executable smoke harness exist.

## Exit-criteria evidence

| Criterion | Required evidence | Status |
|---|---|---|
| STEP assembly validates as Scene IR | OCCT extraction converted to `EngineeringScene`; validator report committed as an artifact | Pending |
| Repeated occurrences reuse geometry | Real STEP assembly shows one prototype referenced by multiple occurrences without duplicate geometry arrays | Synthetic fixture passes; real source pending |
| Source edges survive selection | Picked edge or selected occurrence resolves through representation source map to an OCCT edge reference | Pending |
| Direct WebGPU works in two engines | Browser, OS, GPU, screenshot, adapter info, and picking result recorded | Pending |
| Unsupported data is reported | Known unsupported fixture produces stable diagnostic codes and a build report | Pending |

## Next pull requests

1. `test/step-fixtures`: select and license-review the first public STEP files.
2. `spike/occt-scene-ir`: build OCCT, extract XDE assembly data, and construct a
   validator-clean scene.
3. `spike/webgpu-browser-matrix`: automate the visual/picking smoke test in two
   WebGPU engines and publish the evidence.
4. `docs/accept-bootstrap-adrs`: accept or revise the decisions that the spikes
   support; keep unproven decisions proposed.

Phase 0 exits only when the roadmap criteria are demonstrated. A green bootstrap
CI run is necessary infrastructure, not completion evidence.
