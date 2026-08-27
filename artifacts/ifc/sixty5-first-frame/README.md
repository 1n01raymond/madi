# sixty5 shared-coarse first-frame evidence

This record closes the 268.0 s first-frame bottleneck named by
`artifacts/ifc/sixty5-browser/`, first through a shared coarse batch and then
by virtualizing the Studio's assembly list. It uses the exact same 657.1 MB compiled
package, digest
`a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347`.

The runtime now transfers the 448.8 MB glTF source bytes once into a persistent
geometry Worker. For the compiler's existing `prototype-aabb-v1` tier, the
Worker replaces 42,588 decoded prototype batches with one canonical box batch,
78,173 instances, one contiguous transform buffer, and one target-mesh index
table. Target chunks remain ordinary decoded batches. Promoted target instances
mask their matching shared coarse instances; eviction reveals them again.

## Result

Recorded in headed Chrome 151.0.7922.139 at 1320×1000 on the same Windows x64,
16-CPU, NVIDIA host class as the original record. Each run starts a fresh
browser/context and uses a warm OS file cache, matching the original record's
disclosed cache condition. The previous record on this measure was captured in
Chrome 152.0.7977.64; that build is not installed on the recording host, so the
browser version is not held constant against it.

| Measure | Baseline | Shared coarse | Virtualized list (3 runs) |
|---|---:|---:|---:|
| First coarse frame | 268,013 ms | 12,553 ms | 4,284 / 4,159 / 4,242 ms |
| First coarse frame median | 268,013 ms | 12,796 ms | 4,242 ms |
| Observed p95 (nearest-rank, n=3) | — | 13,378 ms | 4,284 ms |
| Hierarchy-to-coarse median | 264,683 ms | 8,471 ms | 2,029 ms |
| Ready-state median | 323,307 ms | 64,445 ms | 15,807 ms |
| Relative first-frame reduction | — | 95.23% | 98.42% |
| Relative first-frame speedup | — | 20.95× | 63.18× |

The reviewed artifact is the 4,284 ms run, which is the slowest of the three
and the only one whose resident set settled before the snapshot. Its recorded
state is:

- 78,173 / 78,173 visible renderable occurrences;
- 55 of 234 target chunks admitted, from 62 satisfied HTTP Range responses;
- 45,322,020 decoded bytes and 45,377,892 GPU bytes under separate 64 MiB budgets;
- 1,129,693 unique resident triangles and 12 shared coarse edge segments;
- the same center-canvas foundation beam pick and 6 IFC2X3 property entries;
- zero console warnings, console errors, or page errors.

Main-page used JS heap at the ready sample was 0.933-1.032 GB across the three
runs, against 1.349-1.362 GB for the shared-coarse record; as before, this is
recorded rather than treated as a regression gate because it depends on GC
timing.

### What changed, and what the resident set now shows

The assembly tree used to materialize one element per hierarchy entry: 565,134
elements for this federation's 188,319 entries, 78,173 of them exposed as
accessible buttons. A host whose accessibility mode is enabled then spends
minutes walking that tree before the first frame can be painted, because the
browser process stops servicing its own network sockets while it does. The
Studio now renders only the rows its scrollport covers, so the panel holds
roughly thirty elements regardless of federation size.

The resident endpoint is *smaller* than the shared-coarse record's (55 rather
than 78 chunks, 45.3 rather than 66.3 MB decoded) even though the budget is
unchanged. That is not an effect of this change: the residency drain stops at
the first chunk the budget rejects instead of continuing past it, so a faster
page reaches that rejection sooner. Two of the three runs never
settled at all: their status reached `ready` while the scheduler was still
admitting, at 56/234, which is the same defect seen from the other side. Both are addressed
by the deferred-finalize and skip-and-continue work tracked in
`docs/PHASE_1.md`; this record deliberately keeps the unfixed behavior visible
rather than selecting the run that looks most settled.

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
- Spatial LOD, compression, shape-preserving coarse geometry, and a residency
  drain that continues past a rejected chunk remain future work.
- `artifacts/ifc/sixty5-browser/` was recorded before the list was virtualized,
  so its 268.0 s first frame and 323.3 s ready state describe the superseded
  DOM behavior. It is kept as the baseline this record is measured against.
