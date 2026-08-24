# ADR-0002: Source engineering documents remain authoritative

Status: Accepted
Accepted: 2026-08-23

## Context

Teams already author models in commercial and open engineering systems. A new
NARU CAD exchange format would create migration, fidelity, lifecycle, and trust
problems. The runtime still needs compiled data optimized for streaming and GPU
execution.

## Decision

- Native CAD/BIM documents and neutral exchange files remain source of truth.
- NARU workspace data stores composition and review intent.
- Render payloads are immutable, derived caches keyed by source/compiler inputs.
- Caches may be deleted and rebuilt without losing authored engineering intent.
- No operation is labeled source-exact unless backed by an appropriate source
  adapter or exact-geometry service.

## Consequences

### Positive

- NARU coexists with existing engineering systems.
- Cache evolution does not require source migration.
- Static/CDN delivery and content-addressed reuse are possible.
- Proprietary adapters can remain separately licensed.

### Negative

- Rebuild tooling and source availability are operational dependencies.
- Cross-revision identity is difficult and adapter-specific.
- Offline portability may require explicitly bundling approved source/cache data.

## Alternatives considered

- Define a new CAD source format.
- Embed complete source geometry in every workspace.
- Treat glTF as the sole source document.

## Validation

Phase 0 stores checksum-locked STEP files as authoritative inputs and commits
separately generated Scene IR/build reports whose revisions carry the source
digest, adapter version, and compiler options. The unsupported-entity fixture
also proves that a partial semantic mapping is reported without changing the
supported geometry. These relationships are enforced by
`pnpm occt:diagnostics:check` and summarized in the
[evidence tracker](../PHASE_0.md).

Phase 1 must extend this from the evidence harness to the compiler: deleting
generated output and recompiling the same inputs must recreate a functionally
equivalent workspace view with deterministic content IDs.
