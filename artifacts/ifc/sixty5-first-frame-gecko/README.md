# sixty5 first-frame evidence on a second engine (Gecko)

`docs/PHASE_2.md` asks for the published startup, frame, memory, and
interaction figures to be repeated "on a second engine and operating system".
This record closes the engine half of that repeat: it runs the committed
first-frame protocol of `artifacts/ifc/sixty5-first-frame/` unchanged, on the
same host, against the same 657.1 MB compiled package, digest
`a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347` - and
opens it in Firefox 150.0.2 (Gecko) instead of Chrome 151 (Blink).

The operating system half is **not** closed. Both records are Windows x64 on
one host, and `docs/PHASE_2.md` carries that as outstanding evidence debt.

The recorder is the same script. It gained a `--browser chrome|firefox`
selector whose entire engine difference is one launch descriptor; the Chrome
path keeps its previous launch options verbatim, so no committed Blink record,
digest, or timing moved and none was re-recorded.

## Result

Recorded in headed Firefox 150.0.2 at 1320x1000 on the same Windows x64,
16-CPU, NVIDIA host as the Blink record, each run from a fresh browser and
context against a warm OS file cache.

| Measure | Blink (Chrome 151) | Gecko (Firefox 150) | Gecko / Blink |
|---|---:|---:|---:|
| Hierarchy ready | 2,272 ms | 3,396 ms | 1.49x |
| First coarse frame | 4,487 ms | 6,801 ms | 1.52x |
| Budget-limited ready | 9,190 ms | 13,712 ms | 1.49x |
| Worker geometry decode | 1,117.5 ms | 2,440.7 ms | 2.18x |
| Target chunks admitted | 111 / 234 | 111 / 234 | identical |
| Decoded resident bytes | 66,686,508 | 66,686,508 | identical |
| GPU resident bytes | 66,783,808 | 66,783,808 | identical |
| Resident triangles | 2,255,235 | 2,255,235 | identical |
| Visible occurrences | 78,173 | 78,173 | identical |
| Satisfied Range responses | 113 | 113 | identical |
| Used JS heap at ready | 852,946,064 B | not exposed | - |
| Console and page errors | 0 | 0 | identical |

**The two engines settle on a byte-identical endpoint.** Every figure the
runtime decides for itself - which 111 of the 234 target chunks are admitted,
which 123 are refused before a byte moves, how many bytes they occupy in memory
and on the GPU, how many triangles are resident, which element a centre-canvas
pick resolves and which six IFC2X3 properties it carries, and the exact ready
status string - is the same value in both records. What differs is wall-clock
time and what each browser is willing to report about itself.

That is the result the criterion asks for. Admission is decided from measured
decoded and GPU cost against a byte budget, so a second engine reaching a
different resident set would have meant the budget was tracking something
browser-specific. It does not.

The reviewed artifact is the 6,801 ms run - the median of three on all three
milestones, not only on the headline one:

| Run | Hierarchy ready | First coarse frame | Budget-limited ready |
|---|---:|---:|---:|
| 1 | 3,977 ms | 7,413 ms | 13,977 ms |
| 2 (committed) | 3,396 ms | 6,801 ms | 13,712 ms |
| 3 | 3,332 ms | 6,348 ms | 12,729 ms |
| Median | 3,396 ms | 6,801 ms | 13,712 ms |
| Observed p95 (nearest-rank, n=3) | 3,977 ms | 7,413 ms | 13,977 ms |

All three runs reach the identical endpoint recorded above, so the resident
state below is the recorded state of every one of them:

- 78,173 / 78,173 visible renderable occurrences;
- 111 of 234 target chunks admitted, 123 refused from their measured cost
  before any range request, from 113 satisfied HTTP Range responses;
- 66,686,508 decoded bytes and 66,783,808 GPU bytes under separate 64 MiB
  budgets - 325,056 bytes of GPU headroom left;
- 2,255,235 unique resident triangles and 12 shared coarse edge segments;
- the same centre-canvas foundation beam pick, object 148736, resolving the
  same 6 IFC2X3 property entries from the property sidecar;
- zero console warnings, console errors, or page errors.

## What Gecko does not report

Two fields are null in this record and are recorded as unavailable rather than
as zero:

- **JS heap.** `performance.memory` is a Blink extension and Gecko implements
  neither it nor `measureUserAgentSpecificMemory()`. This record therefore
  carries no heap figure at all. The validator asserts both heap fields are
  `null`, so a future engine that starts reporting a heap cannot slip in
  unnoticed, and it asserts the Blink record still carries the reading this one
  cannot take. A resident-set figure that does not depend on any browser's own
  estimator is the job of `artifacts/memory/sixty5-envelope/`, whose Gecko
  repeat is still owed.
- **GPU adapter identity.** Firefox reports an adapter with empty vendor,
  architecture, and description, and `isFallbackAdapter` as null, so this
  record names the adapter only as "WebGPU adapter". No claim is made here
  about which physical GPU served the run or whether it was a fallback adapter;
  the Blink record's `nvidia` identification has no counterpart.

## Reproduce

Recreate the package as described by `artifacts/ifc/sixty5/README.md`, then
run:

```sh
pnpm ifc:first-frame:gecko:evidence -- --scene-dir output/ifc/sixty5-prb
pnpm ifc:first-frame:gecko:check
```

The recorder verifies every package resource against the committed build report
before opening headed Firefox. `coarse-frame.png`, `budget-limited.png`, and
`picked.png` are digest-pinned by `browser-residency.json`.

`scripts/validate-sixty5-first-frame-gecko-evidence.mjs` reads the Blink record
alongside this one and asserts the shared figures against it directly, not only
against literals, so the two records cannot drift apart silently. Where a
literal is pinned as well, it is pinned at the same value the Blink validator
uses.

## Limits

- This closes the **engine** half of the second-engine repeat only. Both
  records are Windows x64 on one discrete-GPU host; the operating-system half
  needs a second host and remains outstanding.
- Timings are a two-engine comparison on one host, not a browser benchmark and
  not an ADR-0003 renderer decision. Gecko is about 1.5x slower than Blink at
  every milestone here and 2.18x slower at Worker geometry decode; three runs
  on one machine do not establish why.
- Memory is not compared. Gecko exposes no heap estimator, so the memory half
  of the exit criterion is untouched by this record.
- The screenshots are not compared across engines. Text rasterization and
  draw order on coincident surfaces differ between engines, so each record
  digests its own captures.
