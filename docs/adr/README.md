# Architecture Decision Records

ADRs document decisions that constrain multiple components or are expensive to
reverse. They explain context and trade-offs rather than only the final choice.

## Status values

- **Proposed:** open for design review;
- **Accepted:** current project direction;
- **Superseded:** replaced by a newer ADR;
- **Rejected:** considered but not selected.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-product-wedge.md) | Begin with an engineering scene studio/runtime | Proposed |
| [0002](0002-source-and-cache.md) | Source documents remain authoritative | Proposed |
| [0003](0003-webgpu-hot-path.md) | Direct data-oriented WebGPU hot path | Proposed |
| [0004](0004-format-strategy.md) | Standards-first delivery; defer custom format | Proposed |
| [0005](0005-coordinate-precision.md) | Hierarchical local coordinates and camera-relative rendering | Proposed |
| [0006](0006-license.md) | Apache-2.0 for MADI-owned code | Proposed |

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
