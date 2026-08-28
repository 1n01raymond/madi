# Phase 1 completion report

Status: Complete (2026-08-28)

Phase 1 proves one reproducible source-to-browser vertical slice. NARU can
compile licensed STEP and IFC sources into standard glTF, open the hierarchy
before target geometry, render and inspect the result through direct WebGPU,
and keep a real-large scene useful under a fixed residency budget. This is an
alpha milestone, not a production-readiness or universal renderer-performance
claim.

The detailed capability ledger remains in [the Phase 1 evidence
tracker](PHASE_1.md). This report closes the roadmap exit criteria and presents
the already-reviewed performance records as one public, reproducible summary.

## Exit decision

| Roadmap criterion | Reproducible evidence | Result |
|---|---|---|
| Public end-to-end demo | The deployed Studio opens the qualified Digital Hub package and PyGamer fallback; deployment verifies package digests, resources, and HTTP Range delivery ([demo instructions](../apps/webgpu-spike/README.md)) | Passed |
| Useful frame before full target residency | Chrome and Firefox show a shared coarse frame before held target Ranges complete ([browser matrix](../artifacts/browser-matrix/README.md)); sixty5 reaches its all-occurrence coarse frame in a 4.283 s three-run median while only 111 of 234 target chunks fit the 64 MiB budget ([real-large record](../artifacts/ifc/sixty5-first-frame/README.md)) | Passed |
| Selection maps to source identity | PyGamer selection resolves the joystick and its CAD edge references; sixty5 selection resolves a foundation beam and six IFC properties ([STEP record](../artifacts/browser-matrix/README.md), [IFC record](../artifacts/ifc/sixty5-browser/README.md)) | Passed |
| No total-scene traversal in steady navigation | Prepared chunk-occurrence tables remove hierarchy walks from target decode, the assembly list is virtualized, and the optional BVH scheduler limits localized sixty5 demand to 184 of 2,048 leaves and 7,026 of 78,173 occurrences ([runtime tracker](PHASE_1.md), [localized record](../artifacts/spatial-demand/sixty5-localized/README.md)) | Passed |
| Reproducible benchmark report | The comparison harness has locked workloads, commands, machine-readable results, screenshots, host/browser disclosures, and validators on discrete and integrated GPUs; the summary below preserves the records' exploratory status | Passed |

All five criteria are demonstrated by records checked through `pnpm check` plus
the deployed-site `pnpm demo:smoke` check. Phase 1 therefore exits and Phase 2
becomes current.

## Performance summary

These numbers were not re-run or averaged for this report. Each row links to
the record containing its samples, environment, limitations, and reproduction
command.

| Question | Recorded result | Evidence boundary |
|---|---|---|
| Can a real-large scene become useful before full detail? | sixty5 first coarse frame: 4.283 s median over three Chrome runs; ready: 8.943 s median; 111/234 target chunks and 2,255,235 triangles resident under separate 64 MiB decoded/GPU budgets | One Windows/discrete-GPU Chrome record; not cross-browser p95 ([record](../artifacts/ifc/sixty5-first-frame/README.md)) |
| Can unchanged source skip native recompilation? | PyGamer STEP: 19.9 s cold / 1.7 s warm; four-document Digital Hub IFC: 46.3 s cold / 0.5 s warm; corrupted entries fall back to byte-identical recompilation | Single runs on one Windows host, not a distribution ([record](../artifacts/cache/README.md)) |
| Does the direct runtime scale to the public comparison floor? | The locked heterogeneous workload exercises 100,000 occurrences, 256 prototypes, and 10,223,768 submitted triangles in Chrome and Firefox, three fresh processes per backend/browser | Procedural workload, not a redistributable industrial assembly ([repeatability](../artifacts/benchmarks/heterogeneous-repeatability/README.md)) |
| Is the renderer result consistent across GPU classes? | On discrete GPU, the direct surface pass is sub-millisecond and CPU submission is the limiting signal; on Apple M4 Pro, Chrome reproduces the CPU/memory continuation signals while Firefox does not reproduce the CPU advantage | Cross-browser divergence prevents an ADR-0003 decision ([discrete](../artifacts/benchmarks/heterogeneous-gpu-timing/README.md), [integrated](../artifacts/benchmarks/heterogeneous-gpu-timing-integrated/README.md)) |
| Does localized spatial demand avoid whole-scene work? | The sixty5 localized trace visits 184/2,048 leaves and 7,026/78,173 occurrences; leaf-anchor packing demands 152 chunks versus 209 under compatibility order | Three headed Chrome runs per order on one Windows host ([record](../artifacts/spatial-demand/sixty5-localized/README.md)) |

The renderer comparison remains `exploratory-not-adr-decision`. Phase 1 needs
a reproducible report, not a predetermined winner. ADR-0003 remains Proposed
until its industrial decision contract converges across browsers, hardware,
explicit-edge output, and bounded-residency scenarios.

## Reproduce

Portable validation, including every committed evidence validator:

```sh
pnpm check
```

Focused records used by this report:

```sh
pnpm browser:evidence:check
pnpm ifc:first-frame:check
pnpm cache:check
pnpm spatial:check
pnpm benchmark:repeatability:check
pnpm benchmark:gpu-timing:check
pnpm benchmark:gpu-timing:integrated:check
pnpm demo:smoke
```

The headed recorders need the browsers, native adapter environments, external
fixtures, and host conditions documented by each linked artifact. A validator
rechecks committed measurements; it does not recreate a headed or native run.

## Phase 2 handoff

Phase 1 completion does not claim that the following work is unnecessary. It
states that it is not required to prove the first vertical slice:

- shape-preserving and screen-space LOD plus a broader budget policy;
- dependency-safe per-discipline IFC rebuild and authorized shared cache;
- persistent browser cache tiers and cache-aware eviction;
- production BIM schemas, property-value search, measurement, and snapping;
- broader browser/hardware reproduction and the final ADR-0003 decision; and
- ADR-0008 completion, including its non-Blink and large-coordinate cross-checks.

Those are Phase 2 or later gates in [the roadmap](ROADMAP.md). A future failure
in one of them does not retroactively change the evidence recorded here.
