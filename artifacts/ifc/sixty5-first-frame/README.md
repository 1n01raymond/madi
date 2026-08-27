# sixty5 shared-coarse first-frame evidence

This record closes the 268.0 s first-frame bottleneck named by
`artifacts/ifc/sixty5-browser/` through four changes: a shared coarse batch, a
virtualized assembly list, a residency drain that skips rejected chunks instead
of stopping at the first one, and an admission gate that refuses a chunk from
its measured cost before any bytes move. It uses the exact same 657.1 MB
compiled package, digest
`a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347`.

The runtime now transfers the 448.8 MB glTF source bytes once into a persistent
geometry Worker. For the compiler's existing `prototype-aabb-v1` tier, the
Worker replaces 42,588 decoded prototype batches with one canonical box batch,
78,173 instances, one contiguous transform buffer, and one target-mesh index
table. Target chunks remain ordinary decoded batches. Promoted target instances
mask their matching shared coarse instances; eviction reveals them again.

The scheduler now marks a chunk the byte budget rejects and continues draining
the rest of the demand instead of halting, the ready state is stamped only once
the scheduler goes idle, and GPU visibility is reconciled through the changed
batches rather than the whole set.

Each target chunk's decoded and GPU cost is also measured once, at load time,
from the accessor counts the parsed document already carries. A chunk whose
cost cannot fit the budget under any eviction the scheduler would perform is
skipped where the range request would have been issued, so it costs no
transfer, no decode, and no transient heap.

## Result

Recorded in headed Chrome 151.0.7922.139 at 1320×1000 on the same Windows x64,
16-CPU, NVIDIA host class as the original record. Each run starts a fresh
browser/context and uses a warm OS file cache, matching the original record's
disclosed cache condition. The previous record on this measure was captured in
Chrome 152.0.7977.64; that build is not installed on the recording host, so the
browser version is not held constant against it.

| Measure | Baseline | Shared coarse | Skip-and-continue | This record (3 runs) |
|---|---:|---:|---:|---:|
| First coarse frame | 268,013 ms | 12,553 ms | 4,340 ms | 4,471 / 4,427 / 4,590 ms |
| First coarse frame median | 268,013 ms | 12,796 ms | 4,340 ms | 4,471 ms |
| Observed p95 (nearest-rank, n=3) | — | 13,378 ms | 4,419 ms | 4,590 ms |
| Hierarchy-to-coarse median | 264,683 ms | 8,471 ms | 1,954 ms | 2,092 ms |
| Ready-state median | 323,307 ms | 64,445 ms | 9,601 ms | 8,277 ms |
| Target chunk requests | — | — | 234 | 93 |
| Satisfied Range responses | — | — | 245 | 94 |
| Used JS heap at ready | — | 1.349-1.362 GB | 1.788 GB | 1.481 GB |
| Relative first-frame reduction | — | 95.23% | 98.38% | 98.33% |
| Relative first-frame speedup | — | 20.95× | 61.75× | 59.94× |

The first coarse frame is unchanged within run-to-run spread, as expected: the
gate governs target chunk traffic, which begins after that frame is painted.
What it moves is everything downstream of it: 141 fewer transfers and
decodes, 307 MB less peak heap, and a ready state 1.3 s earlier.

The reviewed artifact is the 4,471 ms run, which is the median of the three on
both the first-frame and the ready-state measure. All three runs reach an
identical resident endpoint, so the state below is the recorded state of every
one of them:

- 78,173 / 78,173 visible renderable occurrences;
- 93 of 234 target chunks admitted, from 94 satisfied HTTP Range responses;
- 66,927,984 decoded bytes and 67,011,312 GPU bytes under separate 64 MiB
  budgets — 97,552 bytes of GPU headroom left;
- 1,849,190 unique resident triangles and 12 shared coarse edge segments;
- the same center-canvas foundation beam pick and 6 IFC2X3 property entries;
- zero console warnings, console errors, or page errors.

Main-page used JS heap at the ready sample was 1.481 GB for the reviewed run
(1.470-1.486 GB across the three), against 1.788 GB when every demanded chunk
was fetched and decoded before the budget could judge it. The validator holds
it under 1.6 GB; the exact figure depends on GC timing and is recorded rather
than pinned.

### What changed, and what the resident set now shows

The assembly tree used to materialize one element per hierarchy entry: 565,134
elements for this federation's 188,319 entries, 78,173 of them exposed as
accessible buttons. A host whose accessibility mode is enabled then spends
minutes walking that tree before the first frame can be painted, because the
browser process stops servicing its own network sockets while it does. The
Studio now renders only the rows its scrollport covers, so the panel holds
roughly thirty elements regardless of federation size.

The resident endpoint is now larger and, more importantly, stable. The
intermediate record on this measure admitted 55 of 234 chunks and only settled
in one of its three runs, because the drain stopped at the first chunk the byte
budget rejected and the status could stamp `ready` while the scheduler was
still admitting. Rejected chunks are now marked and skipped, the drain
continues, and `ready` waits for an idle scheduler: all three runs land on the
same 93/234 endpoint with 97,552 bytes of GPU headroom, and the ready state
arrives sooner (9.6 s median, against 15.8 s) than when the drain gave up
early.

A drain still tries every demanded chunk exactly once per demand signature,
but 141 of the 234 are now refused from their measured cost instead of after
their decode — including one 75 MB chunk that no 64 MiB budget can ever admit.
The scheduler counts them: `targetSchedulerRequests` is 93 and
`targetSchedulerSkips` is 141, and the two sum to the demanded 234. The
resident endpoint is byte-identical to the record that fetched all of them,
which is the point: the gate only refuses what `promote` would have rejected,
so 245 Range responses became 94 without costing a single resident triangle.

The prediction is exact rather than heuristic. Every decoded array length is a
fixed multiple of a glTF accessor count, so the same formula that charges a
resident batch also prices an unfetched one; a runtime test decodes a committed
fixture and asserts the two agree for every chunk. The gate is otherwise
deliberately optimistic — a chunk is refused only when the budget's free
headroom cannot take it and no colder unpinned group exists to evict — because
refusing a chunk the budget would have taken would drop geometry that fits.

## Reproduce

Recreate the package as described by `artifacts/ifc/sixty5/README.md`, then run:

```sh
pnpm ifc:first-frame:evidence -- --scene-dir output/ifc/sixty5-prb
pnpm ifc:first-frame:check
```

The recorder verifies every package resource against the committed build report
before opening headed Chrome. `coarse-frame.png`, `budget-limited.png`, and
`picked.png` are digest-pinned by `browser-residency.json`.

## Limits

- This is a Chrome/Blink result on one discrete-GPU Windows host, not an
  ADR-0003 renderer decision or a cross-browser performance claim.
- The optimization applies only to the compiler's existing
  `prototype-aabb-v1` coarse representation. Target geometry and the serialized
  glTF profile are unchanged.
- Spatial LOD, compression, and shape-preserving coarse geometry remain future
  work. So does raising the resident endpoint itself: 141 chunks are still
  unadmittable at 64 MiB, and the 75 MB chunk stays unadmittable at any
  eviction order until prototype vertex data is shared between chunks.
- `artifacts/ifc/sixty5-browser/` was recorded before the list was virtualized,
  so its 268.0 s first frame and 323.3 s ready state describe the superseded
  DOM behavior. It is kept as the baseline this record is measured against.
