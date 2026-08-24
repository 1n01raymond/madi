# sixty5 browser residency evidence

This is the first browser result for the compiled real-large sixty5
federation: headed Chrome loads the 608.2 MB package (digest
`773652cf45658ec0179b0eec9f0f3628177abd194d413b5f0dc7a883f7ad6049`, the exact
resource bytes verified against `artifacts/ifc/sixty5/build-report.json`
before recording), renders every occurrence, holds the fixed residency
budget, and resolves picking. It is a runtime evidence record, not a
benchmark; nothing here feeds the ADR-0003 decision contract.

## Reviewed result

Recorded by `pnpm ifc:browser:evidence` on the Phase 1 recording machine
(Windows x64, 16 CPUs, NVIDIA adapter), Chrome 151.0.7922.139 headed at
1320×1000, package served by Vite static hosting with HTTP Range support.

| Measure | Result |
|---|---:|
| Hierarchy ready (448.8 MB `scene.gltf` fetched, parsed, 188,319 records) | 3.4 s |
| First coarse WebGPU frame (all 78,173 renderable occurrences) | 270.2 s |
| Budget-limited ready state | 327.1 s |
| Worker decode of the 37,793.7 KiB `coarse.bin` | 6,984.2 ms |
| Residency budget (decoded and GPU admission) | 64 MiB each |
| Target chunks promoted before the budget | 26 of 234 |
| Resident decoded / GPU bytes at ready | 66,951,636 / 60,644,136 |
| `scene.bin` traffic | 27 requests, every one HTTP 206 with a `bytes=` Range |
| Rendered at ready | 975,013 triangles · 466,452 coarse edge segments |
| Picking | `node 148735 · ID 148736` (a concrete foundation beam) |
| Chrome JS heap at ready (used / total) | 1,023,957,423 / 1,105,094,239 bytes |
| Console warnings, errors, page errors | 0 |

The residency contract held at real-large scale: promotion stopped at the
26th chunk, the remaining 208 target chunks stayed coarse, `targetReady`
reports `limited`, and both resident byte counters stayed inside the 64 MiB
budget. Promotion order and chunk sizes are deterministic, so the validator
pins the resident set exactly; the split.2 package's record and this split.3
re-record (the same `scene.bin`/`coarse.bin` bytes under a new `scene.gltf`
digest) reproduce the same 26-chunk set, the same resident byte counts, and
the same picked element, with wall-clock milestones varying by a few percent.

`coarse-frame.png` is the first coarse frame, `budget-limited.png` the ready
state, and `picked.png` the state after the center-canvas pick;
`browser-residency.json` pins each screenshot by size and SHA-256.

## The recorded boundary

The off-thread decode is 7.0 s of the 266.7 s between hierarchy-ready and the
first coarse frame. The remainder is the main-thread path — transferring the
parsed 448.8 MB glTF document into the Worker, collecting transferables, and
constructing and uploading 42,588 per-prototype coarse batches — so the
real-large first-useful-frame cost is dominated by per-prototype batch
handling, not by geometry decoding or network transfer. That is the concrete
Phase 2 input: spatial/draw clustering and a leaner document handoff are what
this record motivates, and the 270.2 s first frame is the number they must
beat.

## Reproduce

The compiled package is not committed (608.2 MB). Recreate it exactly as
`artifacts/ifc/sixty5/README.md` describes (the recorder refuses to run if
the local package bytes do not match the committed build report), then:

```sh
pnpm ifc:browser:evidence
pnpm ifc:browser:check
```

The recorder needs a desktop session with Chrome and a WebGPU adapter; it
runs headed on purpose so the record reflects a real presented swapchain.

## Deliberate limits

- One engine: headed Chrome/Blink. A Firefox/Gecko repeat and an
  integrated-GPU profile remain pending, as does every timing claim beyond
  this machine.
- Wall-clock milestones are environment measurements, not deterministic
  outputs; the validator checks their ordering and pins only the
  deterministic resident set, counts, and digests.
- The 270.2 s first coarse frame does not meet the "useful frame early"
  ambition at this scale; this record exists to state that boundary, and the
  main-thread batch path above names the suspected cost. Attribution beyond
  the measured 7.0 s Worker decode is analysis, not measurement.
- Picking hit one visible foundation beam at the canvas center; no broader
  picking sweep was recorded.
