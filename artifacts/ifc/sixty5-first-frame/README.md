# sixty5 shared-coarse first-frame evidence

This record closes the 268.0 s first-frame bottleneck named by
`artifacts/ifc/sixty5-browser/`. It uses the exact same 657.1 MB compiled
package, digest
`a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347`.

The runtime now transfers the 448.8 MB glTF source bytes once into a persistent
geometry Worker. For the compiler's existing `prototype-aabb-v1` tier, the
Worker replaces 42,588 decoded prototype batches with one canonical box batch,
78,173 instances, one contiguous transform buffer, and one target-mesh index
table. Target chunks remain ordinary decoded batches. Promoted target instances
mask their matching shared coarse instances; eviction reveals them again.

## Result

Recorded in headed Chrome 152.0.7977.64 at 1320×1000 on the same Windows x64,
16-CPU, NVIDIA host class as the original record. Each run starts a fresh
browser/context and uses a warm OS file cache, matching the original record's
disclosed cache condition.

| Measure | Baseline | Optimized (3 runs) |
|---|---:|---:|
| First coarse frame | 268,013 ms | 12,553 / 12,796 / 13,378 ms |
| First coarse frame median | 268,013 ms | 12,796 ms |
| Observed p95 (nearest-rank, n=3) | — | 13,378 ms |
| Hierarchy-to-coarse median | 264,683 ms | 8,471 ms |
| Ready-state median | 323,307 ms | 64,445 ms |
| Relative first-frame reduction | — | 95.23% |
| Relative first-frame speedup | — | 20.95× |

The reviewed artifact is the 12,553 ms run. Its deterministic ready state is:

- 78,173 / 78,173 visible renderable occurrences;
- 78 of 234 target chunks admitted;
- 66,348,924 decoded bytes and 66,430,100 GPU bytes under separate 64 MiB budgets;
- 1,585,233 unique resident triangles and 12 shared coarse edge segments;
- the same center-canvas foundation beam pick and 6 IFC2X3 property entries;
- zero console warnings, console errors, or page errors.

The three optimized runs reproduce the same resident chunk count and byte
totals exactly. Main-page used JS heap at the ready sample was 1.349–1.362 GB;
as with the baseline, this is recorded rather than treated as a regression
gate because it depends on GC timing.

## Reproduce

Recreate the package as described by `artifacts/ifc/sixty5/README.md`, then run:

```sh
pnpm ifc:first-frame:evidence
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
- Spatial LOD, camera-driven scheduling, compression, persistent cache tiers,
  and shape-preserving coarse geometry remain future work.
