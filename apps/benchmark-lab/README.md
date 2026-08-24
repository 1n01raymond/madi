# Industrial benchmark lab

This app is the executable comparison harness for ADR-0003. It submits one
deterministic plant-style workload through two deliberately comparable paths:

- NARU direct WebGPU with prototype instancing;
- Three.js WebGPURenderer with one `InstancedMesh` per prototype.

The heterogeneous profile instead compares NARU dense CPU culling plus
instance compaction with one optimized Three.js `BatchedMesh` using per-object
frustum culling and default opaque sorting.

The first slice disables explicit edges, picking during navigation, frustum
culling, LOD, and streaming in both paths. It validates workload parity and
measurement plumbing; it is not sufficient to accept or reject ADR-0003.

```sh
pnpm --filter @naru3d/benchmark-lab dev
# ?backend=madi&scale=smoke
# ?backend=three&scale=smoke
# ?backend=madi&scale=gate
# ?backend=madi&scale=target&profile=heterogeneous&culling=frustum
# ?backend=three&scale=target&profile=heterogeneous&culling=frustum
# ?backend=madi&scale=target&profile=heterogeneous&culling=frustum&memory=scene-delta
```

Scale tiers contain 1k, 10k, and 100k occurrences. The target tier submits at
least 10 million triangles while retaining four shared prototypes.

The heterogeneous profile retains 256 deterministic equipment variants and
uses a local-review trace so culling removes a material part of the 10k and
100k scenes. Every run remains `exploratory-not-adr-decision` until the full
hardware, repetition, GPU timing, and retained-memory contract is met.

`memory=scene-delta` measures browser-wide memory after backend initialization
and again after the first rendered scene while retaining the same generated
workload. The runner subtracts measurement overhead from startup metrics and
performs warmup afterward. Use `pnpm benchmark:repeatability` for three fresh
browser processes per path with alternating backend order.

Every NARU run additionally records two ADR signals when the browser exposes
them. WebGPU `timestamp-query` pass timing is attached to the surface pass,
reset after warmup, and resolved once after sampling, so per-frame readback
never stalls the loop; Three.js runs report the signal as unsupported because
its command encoding is not caller-instrumentable. Both backends also
self-report a backend-owned retained-resource census: NARU sums its exact
live GPUBuffer allocations and CPU instance staging, while the Three.js
figure is a constructed floor over the arrays and reservations it creates.
Use `pnpm benchmark:gpu-timing` for the committed discrete record and
`pnpm benchmark:gpu-timing:integrated` on an integrated-GPU host.
