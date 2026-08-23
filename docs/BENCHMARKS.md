# Benchmark and Performance Plan

Status: Draft 0.1

## 1. Purpose

MADI's technical premise depends on measurable gains, not the word WebGPU. The
benchmark suite must show where time and memory go, compare equivalent visual
and semantic workloads, and remain reproducible by external contributors.

## 2. Questions

1. Does progressive compilation reduce time to first useful interaction?
2. Does a data-oriented runtime reduce main-thread and retained-object cost?
3. When does direct WebGPU outperform a general scene-graph renderer?
4. Are compute culling and indirect draws beneficial under WebGPU constraints?
5. What are the costs of CAD edges, picking, clipping, and semantic mapping?
6. How do codec choices trade network size, decode time, peak memory, and GPU
   upload readiness?
7. How does performance scale across desktop, integrated GPU, and mobile-class
   profiles?

## 3. Comparison rules

- Same source model and documented conversion tolerances.
- Same visible features, camera path, resolution, materials, edges, and
  interaction when comparing renderers.
- If a baseline lacks a feature, report separate comparable and full-feature
  scenarios.
- Cold and warm cache results are separate.
- Median, p95, and worst observed values across enough repetitions.
- Compiler time is reported separately from browser startup.
- All generated assets, commands, versions, and configuration are retained.

## 4. Dataset matrix

Public or explicitly redistributable fixtures only.

| Dataset | Purpose | Desired characteristics |
|---|---|---|
| Precision part | geometry fidelity | mm/sub-mm detail, curves, fillets, seams, source faces |
| Repeated assembly | instancing | bolts/fasteners, 100k+ occurrences, few prototypes |
| Heterogeneous assembly | semantic scale | many unique parts, deep hierarchy, materials/properties |
| Plant/MEP scene | spatial streaming | long pipes, tiny fittings, large extents, dense interiors |
| BIM building | IFC path | levels, spaces, property sets, repeated components |
| Georeferenced scene | precision | large world origin plus local details |
| Adversarial file | robustness | malformed/truncated/oversized declarations |

Private partner datasets may guide optimization but cannot be the only evidence.

### 4.1 Industrial scale ladder

The deterministic `madi.industrial-pipe-rack.1` workload provides a public,
license-independent scale control. It is benchmark data, not the canonical
product demo or a substitute for a real design-partner model.

| Tier | Occurrences | Purpose |
|---|---:|---|
| `smoke` | 1,000 | browser and visual parity checks |
| `gate` | 10,000 | fast local cross-backend regression evidence |
| `target` | 100,000 | ADR scale floor; 10M+ submitted triangles |

The first generator has four heavily reused pipe/equipment prototypes. A later
heterogeneous tier must add many unique pipe spools, plates, and equipment
prototypes before ADR-0003 can be decided. Repetition-only results are not
representative because optimized engine instancing is already strong there.

### 4.2 Evidence layers

1. **Public scale control:** deterministic and redistributable at every tier.
2. **Public real model:** license-audited STEP or IFC industrial surrogate.
3. **Private shadow model:** customer-controlled source stays private; only
   approved aggregate metrics, configuration, and source digest are published.

The private profile is compiled and served entirely inside the customer
network. It records outbound requests and fails if the core runtime requires an
external MADI service.

## 5. Baselines

Candidates are pinned per benchmark release:

- Three.js WebGLRenderer;
- Three.js WebGPURenderer;
- xeokit/XKT for applicable BIM/CAD scenes;
- That Open Fragments for applicable IFC/BIM scenes;
- glTF + meshopt loaded through a representative standards-based path;
- MADI runtime with CPU culling;
- MADI runtime with each optional GPU optimization independently enabled.

ADR-0003 release baselines pin the exact Three.js version and use
`InstancedMesh` for repeated prototypes and `BatchedMesh` where heterogeneous
geometry makes it applicable. A scene graph with one `Object3D` per occurrence
is recorded only as a diagnostic anti-pattern, never as the optimized baseline.

The suite does not claim universal superiority from one workload.

## 6. Environment profiles

Each result records exact hardware and software. Project reference profiles are
defined once maintainers have access to stable machines.

### Desktop discrete

- modern 6-8 core CPU;
- discrete GPU with at least 8 GiB;
- 32 GiB system memory;
- 1920x1080 and optional 4K.

### Desktop integrated

- laptop-class CPU/iGPU;
- shared memory pressure;
- 1920x1080.

### Mobile class

- supported WebGPU mobile browser/device;
- thermal state and power mode recorded;
- reduced budget profile.

## 7. Network profiles

Use controlled latency/bandwidth where tooling permits:

- local/static: negligible latency, high bandwidth;
- office: 100 Mbps, 20 ms RTT;
- constrained: 20 Mbps, 80 ms RTT;
- offline warm cache.

CDN tests record region and cache status but do not replace controlled profiles.

## 8. Metrics

### Build

- parse, tessellate, edge, LOD, encode, and validate time;
- peak resident memory;
- source/output bytes;
- unique/reused geometry;
- chunk and LOD histograms;
- geometric/quantization error.

### Startup milestones

- manifest ready;
- hierarchy/search ready;
- first pixel;
- first recognizable frame;
- first useful interactive frame;
- target view LOD ready;
- bytes transferred at each milestone.

### Runtime

- FPS and frame-time median/p95/p99;
- main-thread JS time and long tasks;
- worker decode throughput and utilization;
- command encoding time;
- GPU pass timing where available;
- draw calls, batches, visible occurrences/triangles/edges;
- compressed, decoded CPU, and GPU memory;
- allocation/eviction rate and cache hit ratio;
- click/hover pick latency;
- hide/isolate/section response latency.

### Quality

- canonical visual differences;
- missing objects/edges/materials;
- projected geometric error;
- source-reference coverage;
- measurement deviation.

## 9. Camera and interaction scenarios

Scripted scenarios use timestamps and named checkpoints:

1. load and fit root;
2. orbit full assembly;
3. fly into a dense interior;
4. select a small component;
5. isolate its subassembly;
6. enable section plane and animate it;
7. zoom to close detail and wait for target LOD;
8. restore full assembly;
9. repeat with warm cache.

Input traces and expected selected IDs are versioned.

## 10. Performance gates

Initial CI gates focus on regression rather than aspirational absolute numbers:

- no >10% median regression in stable microbenchmarks without explanation;
- no unexpected increase in startup bytes or GPU peak;
- no main-thread task over configured regression threshold in the smoke model;
- no visual/semantic fixture changes without approved expectation update;
- deterministic compiler content IDs.

Release claims require reference-profile runs and published artifacts.

### 10.1 ADR-0003 material-advantage gate

The direct hot path continues when a strategic industrial workload shows at
least one of:

- 25% lower main-thread p95;
- 30% lower retained browser scene memory; or
- successful bounded-residency navigation under a published memory budget that
  the optimized baseline cannot satisfy;

and frame-time p95 is no more than 10% worse. If all differences remain within
10% and no residency advantage appears, the renderer decision is revised
toward Three.js. The gate requires discrete and integrated-GPU reproduction;
one run, average FPS, or one browser is insufficient.

## 11. Result format

Each run writes machine-readable JSON plus a concise report:

```json
{
  "scenario": "large-assembly-review",
  "commit": "...",
  "environment": {},
  "source": {},
  "compiledAsset": {},
  "milestones": {},
  "frameTimes": {},
  "memory": {},
  "quality": {},
  "notes": []
}
```

Raw traces may be stored as CI artifacts; summarized history can be published as
a static dashboard later.

## 12. Anti-benchmark rules

Do not:

- compare lower-quality output without disclosure;
- exclude compiler/preprocessing costs from the report;
- benchmark only one high-end GPU;
- use proprietary datasets no one can reproduce;
- claim GPU culling wins without showing command/pass overhead;
- report only average FPS;
- preload data in one implementation but not another;
- optimize for triangle count while ignoring occurrence/semantic scale.

## 13. Current executable evidence

`apps/benchmark-lab` now submits the same generated arrays, transforms, colors,
camera trace, resolution, and four logical surface draws through MADI direct
WebGPU and Three.js WebGPURenderer 0.180.0. The committed 10k gate captures both
paths in headed Chrome and Firefox with no browser errors and no HTTP requests
outside the local static origin.

This evidence is explicitly exploratory. Its workload is heavily instanced,
frustum culling and LOD are disabled, frame cadence is display-refresh limited,
and WebGPU timestamp queries are not yet collected. The values validate the
harness only; they are not a performance claim or an ADR outcome. See
`artifacts/benchmarks/industrial-baseline/`.

The second committed slice reaches the public 100k/10M floor with 256
deterministic prototypes and a local-review trace that leaves roughly 34% of
occurrences visible in the final frame. MADI uses reusable dense visibility
tables plus CPU instance compaction; the stronger Three.js baseline uses one
`BatchedMesh` with per-object culling and default opaque sorting. Headed Chrome
and Firefox complete both paths with matching per-browser visibility and no
requests outside the local static origin.

This is still not decision evidence. It has one host session, no integrated-GPU
profile, GPU timestamps, isolated retained-memory measurement, streaming/LOD,
or real design-partner assembly. Whole-page Chrome memory readings are recorded
only as diagnostics. See `artifacts/benchmarks/heterogeneous-culling/`.
