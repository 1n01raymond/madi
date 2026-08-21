# ADR-0004: Use standards first and defer a custom delivery format

Status: Proposed

## Context

glTF, meshopt, KTX2, and 3D Tiles already address substantial parts of efficient
3D delivery, metadata, compression, instancing, and spatial streaming. MADI also
needs CAD edges, occurrence identity, semantic/source mapping, GPU-ready data,
and independent semantic/geometry loading. A new format would impose a lasting
tooling and compatibility cost.

## Decision

1. Define the logical Scene IR independently of serialization.
2. Build the first vertical slice with inspectable experimental resources.
3. Reuse existing specifications/codecs wherever they meet requirements.
4. Compare a standards-based profile with optimized experimental chunks.
5. Freeze a custom MADI cache/container only when benchmarks demonstrate a
   material and recurring gap.
6. Never present a derived MADI cache as a replacement CAD interchange format.

## Consequences

### Positive

- Lower reinvention and ecosystem cost.
- Existing validators, codecs, and tools can participate.
- Logical architecture remains stable while physical layout evolves.

### Negative

- Early builds may have multiple experimental representations.
- Standards extension/profile work can be complex.
- Maximum GPU upload efficiency may require custom payloads eventually.

## Alternatives considered

- Specify `.wgeo`/`.madi` binary format before implementation.
- Use glTF/GLB without any external semantic/spatial indexes.
- Use one compressed monolithic archive with HTTP ranges only.

## Validation

Phase 1 publishes size, startup, decode, peak-memory, and upload comparisons.
Any custom structure must name the metric it improves and preserve adapters to
standards-based content where practical.
