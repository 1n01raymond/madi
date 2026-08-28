# ADR-0010: Index IFC document dependencies before partial compilation

Status: Proposed

## Context

An unchanged federation can already restore one verified compiled package, but
changing one IFC discipline invalidates the complete cache key. Partial rebuild
is unsafe without a deterministic account of which semantic entities,
prototypes, occurrences, and progressive target chunks came from each source
document. Cross-document semantic relations can also make a nominally local
change affect another discipline.

The current target, coarse, spatial, and property resources are federation-wide
files. A logical dependency record alone does not make their byte ranges
independently reusable: target packing and priority can move ranges, while the
coarse, spatial, and property resources do not yet expose stable per-document
content chunks.

## Decision

- Emit `incremental-dependencies.json` for every IFC federation compile using
  schema `naru.ifc-incremental-dependency-index.1`.
- Map each discipline/source digest to its Scene IR document, semantic,
  prototype, occurrence, target-chunk, coarse-prototype, spatial-occurrence,
  and property-semantic selectors without duplicating those ID arrays. Map
  every prototype back to all contributing documents and its current target
  chunk when one exists.
- Derive provenance only from Scene IR document IDs, source references,
  semantic ownership, representation source maps, and occurrence references.
  A prototype without document provenance is an error, not a global fallback.
- Treat cross-document semantic relations as an undirected reconciliation
  dependency and record the complete transitive component for invalidation.
- Detect source changes, deletion, stable-content rename/relabel, and addition
  deterministically. Ambiguous equal-digest rename candidates remain
  delete/add operations rather than guessed renames.
- Keep the index as derived cache metadata covered by the persistent cache
  manifest. Do not change the frozen Phase 1 compiler-report or glTF profile
  schemas for this additive Phase 2 contract.
- Do not claim partial compilation or byte reuse from this index alone. Reuse
  requires per-document adapter outputs, content-addressed prototype/chunk
  payloads, and reconstruction tests proving byte-identical full packages.

## Consequences

### Positive

- The next compiler slice can select an explicit conservative invalidation set
  instead of inferring ownership from names or buffer offsets.
- Non-geometric hierarchy prototypes and cross-document relationships remain in
  the rebuild plan, not only renderable meshes.
- Whole-package cache hits restore the exact same dependency record without
  running IfcOpenShell.

### Negative

- The index duplicates sorted IDs already present in Scene IR and adds one
  derived JSON resource to IFC outputs and cache entries.
- Current changed-discipline imports still run the complete adapter and
  compiler; the index is a correctness prerequisite, not the optimization.
- Logical target-chunk IDs are revision-local while federation-wide packing
  remains in use, so they cannot yet authorize physical range reuse.

## Alternatives considered

- Infer discipline ownership from prototype ID strings or source filenames.
- Reuse every apparently unchanged byte range without tracking global packing.
- Make any changed discipline invalidate every document indefinitely.
- Put the dependency tables into the frozen Phase 1 build-report schema.

## Validation

Focused compiler tests construct and restore the sidecar through the IFC cache,
check document/prototype/target/property coverage, and prove deterministic
changed, deleted, renamed/relabelled, and cross-document reconciliation
invalidation. Acceptance additionally requires independently cached adapter
documents and a partial rebuild that reproduces the corresponding clean full
build byte for byte.
