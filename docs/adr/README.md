# Architecture Decision Records

ADRs document decisions that constrain multiple components or are expensive to
reverse. They explain context and trade-offs rather than only the final choice.

## Status values

- **Proposed:** open for design review or awaiting its evidence gate;
- **Accepted:** current project direction;
- **Superseded:** replaced by a newer ADR;
- **Rejected:** considered but not selected.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-product-wedge.md) | Begin with an engineering scene studio/runtime | Accepted |
| [0002](0002-source-and-cache.md) | Source documents remain authoritative | Accepted |
| [0003](0003-webgpu-hot-path.md) | Direct data-oriented WebGPU hot path | Proposed |
| [0004](0004-format-strategy.md) | Standards-first delivery; defer custom format | Accepted |
| [0005](0005-coordinate-precision.md) | Hierarchical local coordinates and camera-relative rendering | Proposed |
| [0006](0006-license.md) | Apache-2.0 for NARU-owned code | Accepted |
| [0007](0007-rebrand-naru.md) | Rebrand to NARU; freeze serialized `madi.*` identifiers | Accepted |

## Phase 0 review

The first evidence review was completed on 2026-08-23. ADRs 0001, 0002, 0004,
and 0006 are accepted because their decisions are implemented or directly
supported by the committed Phase 0 evidence. ADRs 0003 and 0005 remain proposed:
the former still needs a comparable Three.js baseline, and the latter still
needs large-coordinate visual and measurement tests. A feasibility prototype
alone is not treated as evidence of performance or precision advantage.

`pnpm adr:check` verifies that every ADR has a canonical status/date and that
this index matches the individual records.

## Template

```markdown
# ADR-NNNN: Title

Status: Proposed

## Context

## Decision

## Consequences

### Positive

### Negative

## Alternatives considered

## Validation
```
