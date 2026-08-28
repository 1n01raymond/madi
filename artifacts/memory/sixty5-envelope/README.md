# sixty5 whole-process memory envelope

The runtime's residency budgets bound one thing: decoded and GPU target
geometry. They say nothing about the document the Worker parsed, the property
sidecar, the hierarchy, the render attachments, or the browser process that
holds all of it. This record measures those quantities in the same runs, so the
64 MiB figure the other records report can be read against the memory the
application actually occupies.

Every number below names its owner, its lifetime, and how it was collected. Two
categories are the browser's own estimate, two are sampled from the operating
system, one is an upper bound, and one — what the graphics driver allocated on
the device — has no interface that reports it and is recorded as unavailable
rather than as zero.

The same six phases are recorded under two residency budgets: the default
64 MiB and a forced-low 8 MiB set through `?residencyMiB=8`. The forced-low
profile is not a degraded-mode demonstration; it is a test of whether the
application stays truthful and usable when the budget cannot hold the view.

## Result

Recorded 2026-08-28 in headed Chrome 151.0.7922.139 (Blink) at 1320x1000, on
Windows x64 with 16 CPUs and 33,463,021,568 B of RAM, against the 657.1 MB
sixty5 package `a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347`
served from Vite static hosting with HTTP Range support. Three runs per
profile, each in a fresh browser and context. Zero console warnings, console
errors, or page errors in all six runs.

| Median at the budget-limited phase | Default (64 MiB) | Forced low (8 MiB) |
|---|---:|---:|
| Browser process-tree working set | 2,586,112,000 B | 1,439,883,264 B |
| Browser process-tree private commit | 8,339,120,128 B | 1,312,243,712 B |
| Main-thread used JS heap | 847,065,463 B | 294,224,238 B |
| Agent-cluster memory (`measureUserAgentSpecificMemory`) | 730,751,608 B | 632,819,320 B |
| Decoded target residency | 66,686,508 B | 8,249,400 B |
| GPU target residency | 66,783,808 B | 8,251,192 B |
| Renderer GPU buffer allocations | 66,783,936 B | 8,251,320 B |
| Target chunks admitted | 111 / 234 | 4 / 234 |
| Chunks requested + skipped | 111 + 123 | 4 + 230 |

Cutting the geometry budget by 58,720,256 B moved the browser's working set by
1,146,228,736 B, roughly twenty times the budget change. The record does not
attribute that difference to one category: decoded arrays, per-batch staging
copies, GPU allocations, and the transient buffers around each admission all
scale with the number of admitted chunks, and the process figure includes
allocator and GPU-process behavior no page-level API resolves. In the other
direction, target residency is 2.58% of the default profile's working set. The residency budget is a real bound on the
category it names and a small part of the process.

All six runs reached an identical resident endpoint within their profile: 111
chunks and `Residency budget reached · 24326 surface batches retained · 78173
renderable occurrences` at the default budget, 4 chunks and `Residency budget
reached · 449 surface batches retained · 78173 renderable occurrences` at
8 MiB. All 78,173 renderable occurrences stay visible in both, because coarse
geometry is not admitted through the target budget.

### Predeclared targets

The two ceilings were written into the recorder before the first run and are
recomputed from the samples by the validator; a recorded verdict is not
evidence.

| Target | Ceiling | Observed maximum | Met |
|---|---:|---:|---|
| Decoded residency within budget | the configured budget | 67,009,152 B (default #1, selection) | yes |
| GPU residency within budget | the configured budget | 67,108,748 B (default #1, navigation) | yes |
| Process working set below 4 GiB | 4,294,967,296 B | 3,373,060,096 B (default #1, coarse-frame) | yes |
| Main-thread JS heap below 2 GiB | 2,147,483,648 B | 859,187,750 B (default #2, budget-limited) | yes |
| Forced-low profile remains usable | - | hierarchy, coarse frame, navigation, selection, eviction all completed | yes |

The GPU maximum is 116 bytes under the 67,108,864 B budget. That is the
admission gate working, not a coincidence: a chunk is priced before it is
fetched and refused when the price does not fit.

## The ledger

Eighteen categories, each with an owner, a lifetime, and a collection method.
`exact-declared` is read from the package or the configuration, `exact-counted`
is summed from the runtime's own allocations, `upper-bound` charges the widest
possible layout, `browser-estimated` is a browser API's own figure,
`os-sampled` comes from the operating system, and `unsupported` means no
interface reports it.

| Category | Owner | Lifetime | Method |
|---|---|---|---|
| `package.documentBytes` | compiled glTF document, held by the main thread and the geometry Worker | whole session | exact-declared |
| `package.propertyIndexBytes` | property sidecar index, fetched on the first selection | first selection to session end | exact-declared |
| `package.spatialIndexBytes` | spatial demand index, when the package carries one | whole session | exact-declared |
| `package.declaredGeometryBytes` | target geometry declared by the document | never resident as a whole | exact-declared |
| `residency.budgetBytes` | `ProgressiveResidency`, configured by `?residencyMiB` | whole session | exact-declared |
| `residency.decodedBytes` | decoded target geometry arrays | until eviction | exact-counted |
| `residency.gpuBytes` | GPU buffers charged to admitted target chunks | until eviction | exact-counted |
| `renderer.gpuVertexPoolBytes` | one GPUBuffer per shared prototype vertex pool | until the last batch referencing it is released | exact-counted |
| `renderer.gpuBatchBufferBytes` | per-batch index, edge, and instance GPUBuffers | until the batch is released | exact-counted |
| `renderer.gpuUniformBytes` | the camera uniform buffer | whole session | exact-counted |
| `renderer.gpuBufferBytes` | the renderer's GPUBuffer allocations; contains the three above | mixed | exact-counted |
| `renderer.gpuAttachmentBytes` | the depth and object-id render attachments | until the canvas is resized | upper-bound |
| `renderer.cpuStagingBytes` | per-batch instance staging arrays, part of the JS heap | until the batch is released | exact-counted |
| `page.usedJsHeapBytes` | the main-thread V8 isolate | sampled | browser-estimated |
| `page.uaMemoryBytes` | the whole agent cluster, including dedicated workers | sampled | browser-estimated |
| `process.workingSetBytes` | the headed browser process tree | sampled | os-sampled |
| `process.privateBytes` | the same process tree | sampled | os-sampled |
| `gpu.driverAllocationBytes` | the graphics driver's device-side allocations | unknown | unsupported |

Three inclusion relationships are declared rather than implied: the three
`renderer.gpu*` buffer categories sum exactly to `renderer.gpuBufferBytes`
(28,790,184 + 37,993,624 + 128 = 66,783,936 at the default budget, and the
validator recomputes it), `renderer.cpuStagingBytes` is part of
`page.usedJsHeapBytes`, and `renderer.gpuAttachmentBytes` is deliberately
outside the buffer total because a texture is not a buffer allocation.

`renderer.gpuBufferBytes` runs 128 B above `residency.gpuBytes` — the camera
uniform, which no chunk owns. The 4,900,480 B of attachments are the depth and
object-id targets for a 1320x1000 canvas, charged at the widest layout because
`depth24plus` storage is implementation-defined.

`process.privateBytes` is `Win32_Process` `PrivatePageCount`: private committed
pages, which need not be resident. It runs far above the working set — 8.3 GB
against 2.6 GB at the default budget — and is not a claim about how much RAM
the browser holds. It is recorded because a commit figure moving while the
working set does not is a signal worth keeping.

## Per-phase medians

Three runs per profile; every cell is the median of the three. `residency`
columns are unavailable at the hierarchy phase, which is sampled before the
scene exists.

### Default budget (64 MiB)

| Phase | Working set | Used JS heap | Agent cluster | Decoded | GPU | Chunks |
|---|---:|---:|---:|---:|---:|---:|
| hierarchy | 3,089,653,760 | 851,087,975 | 896,164,365 | n/a | n/a | n/a |
| coarse-frame | 3,356,979,200 | 330,499,881 | 670,412,417 | 9,197,064 | 9,202,020 | 0 |
| budget-limited | 2,586,112,000 | 847,065,463 | 730,751,608 | 66,686,508 | 66,783,808 | 111 |
| navigation | 2,613,407,744 | 448,924,149 | 732,339,111 | 67,009,032 | 67,108,748 | 110 |
| selection | 2,577,465,344 | 565,719,561 | 789,888,299 | 67,009,152 | 67,108,508 | 110 |
| eviction | 2,470,322,176 | 433,610,906 | 789,863,857 | 67,009,152 | 67,108,508 | 110 |

### Forced-low budget (8 MiB)

| Phase | Working set | Used JS heap | Agent cluster | Decoded | GPU | Chunks |
|---|---:|---:|---:|---:|---:|---:|
| hierarchy | 3,087,368,192 | 851,110,867 | 896,164,365 | n/a | n/a | n/a |
| coarse-frame | 1,649,946,624 | 307,143,916 | 632,996,165 | 8,243,160 | 8,244,948 | 0 |
| budget-limited | 1,439,883,264 | 294,224,238 | 632,819,320 | 8,249,400 | 8,251,192 | 4 |
| navigation | 1,633,738,752 | 322,900,257 | 636,241,637 | 8,385,360 | 8,387,956 | 1 |
| selection | 1,639,354,368 | 472,602,023 | 693,351,497 | 8,375,808 | 8,377,224 | 2 |
| eviction | 1,622,368,256 | 337,126,077 | 693,355,479 | 8,375,808 | 8,377,224 | 2 |

The hierarchy sample is the same in both profiles, which is what it should be:
the assembly tree, the parsed document, and the Worker's copy all exist before
any target chunk is admitted, and the budget has not been consulted yet. The
highest working set of each profile falls in these first two phases, while the
document bytes are still being read and decoded. From the coarse frame onward
the profiles separate by about 1.1 GB and stay separated.

At the default budget the admitted-chunk count falls from 111 to 110 at
navigation and stays there while decoded bytes rise from 66,686,508 to
67,009,032: the moved view demands chunks that cost more than the ones evicted
to make room for them. The agent-cluster figure rises 57-59 MB at selection in
both profiles, which is the phase where the 17.7 MB property index document and
the columns decoded from it first exist.

## What the forced-low profile proves

At 8 MiB the budget cannot hold the demanded view: 4 of 234 chunks are
admitted and 230 are refused from their measured cost before any bytes move.
The application stays usable and, more importantly, stays honest.

- All 78,173 renderable occurrences remain visible through shared coarse
  geometry, which the target budget does not gate. `coarse-frame.png` is the
  proof, captured before that run's memory sample.
- The status line reports the state it is actually in — `Residency budget
  reached · 449 surface batches retained · 78173 renderable occurrences` — and
  reaches it in every run rather than leaving a loading message behind a
  scheduler that has stopped.
- Navigation completes and re-forms the resident set for the new view: the
  4 admitted chunks give way to 1 larger one, and the pinned selection then
  brings it to 2, all inside the same 8 MiB.
- Selection resolves the same source-aware result as the default profile: the
  centre pick `148339` promotes to target residency and its 6 IFC2X3 property
  entries resolve.
- Eviction is observed in every run. The pinned selection displaces 325 colder
  target mesh groups at 8 MiB and 199 at 64 MiB, and the scheduler then goes
  quiet within 4,036-4,052 ms of the eviction sample's bounded 180 s wait.

The eviction phase is not simulated. The centre selection is taken as the
probe: promoting an absent chunk while the budget is full is exactly the event
that evicts, and it is recorded with `source: "selection"`. Only if that pick
were already resident would the recorder scan twenty viewport points in a fixed
order, stopping at the first pick that evicts.

## What is not measured

- **GPU driver allocations.** No interface available to page or host script
  reports what the WebGPU driver allocated on the device. The
  `renderer.gpu*` categories are requested sizes, not driver footprint. This is
  recorded as `unsupported` with a null value; it is never counted as zero.
- **Per-category process attribution.** `process.workingSetBytes` is one
  number for eight processes. Nothing here decomposes it into renderer, GPU
  process, and utility shares.
- **Timing.** Every phase sample calls
  `performance.measureUserAgentSpecificMemory()`, which forces a collection and
  blocks for seconds — one budget-limited sample took 14,055 ms. The milestone
  offsets in this record are therefore perturbed and must not be read as
  startup results. `artifacts/ifc/sixty5-first-frame/` is the timing record.

## Reproduce

Recreate the package as described by `artifacts/ifc/sixty5/README.md` into
`output/ifc/sixty5-prb`, then run:

```sh
pnpm memory:envelope:evidence
pnpm memory:envelope:check
```

The recorder verifies all five package resources against the committed build
report before it opens Chrome, launches with `--enable-precise-memory-info`,
and requires cross-origin isolation so
`performance.measureUserAgentSpecificMemory()` is available. `coarse-frame.png`,
`budget-limited.png`, and `selection.png` are digest-pinned by
`memory-envelope.json` for the first run of each profile; the validator also
requires the coarse and budget-limited captures to differ, because a capture
requested behind the blocking memory sample would otherwise depict a later
phase under an earlier phase's name.

## Limits

- One host, one engine, one operating system. Chrome 151 on Windows x64 with
  33.5 GB of RAM and a discrete GPU. `measureUserAgentSpecificMemory` is
  Chromium-only and `Win32_Process` is Windows-only, so a repeat elsewhere will
  measure different categories, not the same categories on different hardware.
  That repeat is tracked as evidence debt in `docs/PHASE_2.md`.
- The figures describe an already compiled package opened from local static
  hosting. They are not an import-time or a network-constrained result.
- No optimization is claimed or attempted here. The ledger exists to rank
  categories before anything is changed; the largest single category in it is
  the 448.8 MB compiled document, which both the main thread and the Worker
  read.
- Two categories are the browser's own estimates and move with garbage
  collection. They are recorded per phase and per run rather than pinned to an
  exact value, and only the two predeclared ceilings are asserted.
