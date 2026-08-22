# MADI Design Documents

Read in this order:

1. [Product requirements](PRODUCT.md) — users, workflows, scope, requirements,
   success metrics, and risks.
2. [System architecture](ARCHITECTURE.md) — boundaries, data flow, runtime,
   precision, security, and compatibility.
3. [Engineering Scene IR](SCENE_IR.md) — neutral semantic/assembly/
   representation model.
4. [Compiler](COMPILER.md) — source adapters, tessellation, edges, chunking,
   encoding, and validation.
5. [WebGPU runtime](RUNTIME.md) — loading, Workers, GPU resources, rendering,
   picking, clipping, and lifecycle.
6. [Plugin architecture](PLUGINS.md) — capabilities, transactions, UI, analysis,
   and distribution.
7. [Benchmark plan](BENCHMARKS.md) — datasets, baselines, metrics, scenarios,
   and anti-benchmark rules.
8. [Roadmap](ROADMAP.md) — evidence-gated phases and exit criteria.
9. [Phase 0 evidence](PHASE_0.md) — implementation status, reproduction, and
   remaining feasibility gates.
10. [Architecture decisions](adr/README.md) — decisions and alternatives.
11. [Branching and releases](BRANCHING.md) — work branches, pull requests,
    merge rules, backports, tags, and enforcement gates.
12. [Translations](TRANSLATIONS.md) — README languages, terminology, and
    maintenance workflow.

## Documentation rules

- Architecture claims should link to a requirement, ADR, benchmark, or test.
- Accuracy-sensitive behavior must distinguish source-exact, tessellated,
  simplified, and derived results.
- A serialized schema change requires compatibility and migration discussion.
- Performance claims must follow `BENCHMARKS.md`.
- Proprietary models and screenshots are excluded unless redistribution rights
  are explicit.
