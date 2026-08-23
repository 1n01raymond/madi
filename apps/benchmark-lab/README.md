# Industrial benchmark lab

This app is the executable comparison harness for ADR-0003. It submits one
deterministic plant-style workload through two deliberately comparable paths:

- MADI direct WebGPU with prototype instancing;
- Three.js WebGPURenderer with one `InstancedMesh` per prototype.

The first slice disables explicit edges, picking during navigation, frustum
culling, LOD, and streaming in both paths. It validates workload parity and
measurement plumbing; it is not sufficient to accept or reject ADR-0003.

```sh
pnpm --filter @madi/benchmark-lab dev
# ?backend=madi&scale=smoke
# ?backend=three&scale=smoke
# ?backend=madi&scale=gate
```

Scale tiers contain 1k, 10k, and 100k occurrences. The target tier submits at
least 10 million triangles while retaining four shared prototypes.
