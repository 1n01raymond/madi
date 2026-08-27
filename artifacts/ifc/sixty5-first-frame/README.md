# sixty5 shared-coarse first-frame evidence

This record closes the 268.0 s first-frame bottleneck named by
`artifacts/ifc/sixty5-browser/` through three changes: a shared coarse batch, a
virtualized assembly list, and a residency drain that skips rejected chunks
instead of stopping at the first one. It uses the exact same 657.1 MB compiled
package, digest
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

## Result

Recorded in headed Chrome 151.0.7922.139 at 1320×1000 on the same Windows x64,
16-CPU, NVIDIA host class as the original record. Each run starts a fresh
browser/context and uses a warm OS file cache, matching the original record's
disclosed cache condition. The previous record on this measure was captured in
Chrome 152.0.7977.64; that build is not installed on the recording host, so the
browser version is not held constant against it.

| Measure | Baseline | Shared coarse | This record (3 runs) |
|---|---:|---:|---:|
| First coarse frame | 268,013 ms | 12,553 ms | 4,232 / 4,419 / 4,340 ms |
| First coarse frame median | 268,013 ms | 12,796 ms | 4,340 ms |
| Observed p95 (nearest-rank, n=3) | — | 13,378 ms | 4,419 ms |
| Hierarchy-to-coarse median | 264,683 ms | 8,471 ms | 1,954 ms |
| Ready-state median | 323,307 ms | 64,445 ms | 9,601 ms |
| Relative first-frame reduction | — | 95.23% | 98.38% |
| Relative first-frame speedup | — | 20.95× | 61.75× |

The reviewed artifact is the 4,340 ms run, the median of the three. All three
runs reach an identical resident endpoint, so the state below is the recorded
state of every one of them:

- 78,173 / 78,173 visible renderable occurrences;
- 93 of 234 target chunks admitted, from 245 satisfied HTTP Range responses;
- 66,927,984 decoded bytes and 67,011,312 GPU bytes under separate 64 MiB
  budgets — 97,552 bytes of GPU headroom left;
- 1,849,190 unique resident triangles and 12 shared coarse edge segments;
- the same center-canvas foundation beam pick and 6 IFC2X3 property entries;
- zero console warnings, console errors, or page errors.

Main-page used JS heap at the ready sample was 1.788 GB for the reviewed run,
against 0.933-1.032 GB before the drain continued past rejections and
1.349-1.362 GB for the shared-coarse record. It is recorded rather than treated
as a regression gate because it depends on GC timing, but the increase is
expected: every demanded chunk is now fetched and decoded before the budget can
judge it.

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

One consequence is deliberate and visible in the record: a drain tries every
demanded chunk once per demand signature, so all 234 are Range-fetched and
decoded and 141 are rejected after decode — including one 75 MB chunk that no
64 MiB budget can ever admit. That is why 245 Range responses back a 93-chunk
resident set. Skipping a chunk whose decoded size is already known to exceed
the budget is a separate slice, not this one.

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
- Spatial LOD, compression, shape-preserving coarse geometry, and an
  estimate-gated prefetch that never fetches a chunk the budget cannot admit
  remain future work.
- `artifacts/ifc/sixty5-browser/` was recorded before the list was virtualized,
  so its 268.0 s first frame and 323.3 s ready state describe the superseded
  DOM behavior. It is kept as the baseline this record is measured against.
