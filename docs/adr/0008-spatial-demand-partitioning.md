# ADR-0008: Separate spatial demand from shared prototype payload ownership

Status: Proposed

## Context

The current progressive package writes target geometry once per prototype in
prototype-ID order, then coalesces adjacent byte ranges into bounded HTTP
request chunks. The browser builds one world-space AABB for each request chunk
from every retained-coarse occurrence that uses one of its prototypes. Camera
navigation can re-rank those chunk bounds and cancel obsolete work, but a
prototype reused across distant parts of a scene gives its chunk a diffuse
bound. A visible portion of that bound can therefore request unrelated target
geometry, and the bound cannot become a useful unit for later screen-space LOD
or draw culling.

NARU must improve spatial locality without duplicating prototype geometry,
breaking occurrence/source identity, regressing the accepted large-coordinate
precision path, or making a custom container the engineering source of truth.
The first spatial contract must also remain optional so historical
`madi.experimental.gltf.1` packages continue to load.

## Decision

1. Treat spatial demand partitions, target payload ownership, and draw clusters
   as separate mappings. One partition does not need to satisfy all three
   concerns.
2. Preserve one target geometry payload per prototype. An occurrence belongs to
   one spatial leaf, while the same prototype or target chunk may be referenced
   by many leaves without duplicating its geometry bytes.
3. Introduce an optional derived-cache sidecar named `spatial.bin`, referenced
   from `extras.madi.progressive.spatialIndex`. The pointer carries schema,
   URI, byte length, and SHA-256 fields using the same integrity pattern as the
   package property sidecar.
4. Name the first sidecar schema `naru.spatial-demand-index.1`. ADR-0007 keeps
   the historical `extras.madi` envelope spelling, but every new schema family
   starts with the `naru.` prefix.
5. Store a deterministic flat BVH over renderable occurrence world bounds.
   Bounds use float64 coordinates. Leaves identify their occurrences and carry
   sorted, deduplicated references to the existing `targetChunks` array. The
   exact binary field layout, allocation limits, and magic/version checks are
   fixed by the paired schema validator rather than by this ADR.
6. Build the index in the compiler from delivered coarse bounds and the emitted
   glTF node transforms. Input occurrences are ordered by stable IDs; split-axis,
   centroid, child-order, and reduction ties have explicit deterministic rules.
7. Query the BVH with camera frustum planes and aggregate a generation-local,
   deduplicated target-chunk demand set. Selection may force an off-screen chunk
   into demand and pin its resident target geometry. Existing Range/Worker
   cancellation and decoded/GPU budgets remain authoritative.
8. Keep packages without the sidecar on the current coarse-chunk-bound scheduler.
   A missing optional index is not an error; a declared index with an invalid
   digest, schema, bound, count, or reference is rejected before allocation.
9. In the first indexed slice, `scene.bin`, `coarse.bin`, target chunk ownership,
   and glTF rendering semantics stay unchanged. Reordering prototype payloads by
   measured spatial co-demand is a later schema/profile decision. Spatial draw
   clustering is later still and requires geometry resources to be separable
   from instance clusters.

## Consequences

### Positive

- Repeated prototype geometry remains shared even when its occurrences occupy
  many spatial leaves.
- Camera work scales with visited spatial nodes and visible candidates rather
  than all occurrences in a steady localized view.
- The same spatial hierarchy can later supply screen-space LOD demand and draw
  cluster candidates without making those policies part of the first slice.
- Historical packages and evidence remain readable through the existing
  scheduler fallback.
- A separate digest-linked sidecar remains an inspectable derived cache under
  the standards-first format strategy.

### Negative

- The package gains one resource and one integrity-checked fetch before indexed
  scheduling can begin.
- A fit-to-scene view can legitimately visit most of the hierarchy; the index
  does not make an all-visible scene spatially selective.
- A leaf can still demand unrelated bytes when the existing target chunk mixes
  prototypes with different spatial demand. Physical payload packing requires
  separate evidence and a later change.
- Large or scene-spanning occurrences can overlap many queries and need explicit
  isolation/tuning in the builder.
- Compiler and runtime must maintain a versioned binary decoder and strict
  allocation limits.

## Alternatives considered

- **Duplicate prototype geometry into spatial cells.** Rejected because it
  destroys the project's validated instancing and memory advantages.
- **Build the primary index in every browser session.** Rejected as the default
  because it repeats deterministic compiler work during startup and spends the
  remaining margin in the real-large first-frame budget. Runtime construction
  remains a possible experiment, not the package contract.
- **Continue using one aggregate AABB per target chunk.** Retained as the legacy
  fallback, but it cannot distinguish distant occurrences that share a chunk.
- **Adopt 3D Tiles or a custom NARU container immediately.** Deferred by
  ADR-0004 until measured gaps justify a broader delivery-format commitment.
- **Use one uniform grid or octree as the permanent policy.** Deferred because
  long, sparse, and highly anisotropic engineering scenes need evidence before
  a fixed subdivision policy is frozen.

## Validation

The ADR remains Proposed until a vertical evidence slice proves all of the
following:

The focused `artifacts/spatial-demand/` record already proves deterministic
sidecar generation without target/coarse byte changes, strict no-false-negative
unit/oracle coverage, localized work reduction, single-chunk delivery, and
obsolete-Range cancellation in headed Chrome and Firefox. The transform-only
scenario does not close the nested/ADR-0005 or Digital Hub/sixty5 gates below.

- every renderable occurrence is indexed exactly once, every leaf bound contains
  its references, and BVH queries have no false negatives against a brute-force
  frustum oracle;
- two compilations produce byte-identical `spatial.bin` output, and input-order
  permutations do not change the result;
- the index-only compile keeps `scene.bin` and `coarse.bin` byte-identical while
  a prototype referenced by multiple leaves still owns one target Range;
- nested transforms, source-axis conversion, and the ADR-0005 10,000 km fixture
  retain finite float64 bounds and the accepted precision result;
- localized camera traces visit strictly fewer spatial nodes, leaves,
  occurrences, and candidate chunks than their recorded totals, without a
  total-occurrence traversal in the steady navigation path;
- camera changes still cancel obsolete HTTP Range and Worker decode work, and
  selection pinning, picking/source identity, coarse fallback, and the fixed
  decoded/GPU budgets remain intact;
- headed Chrome and Firefox reproduce the request sequence with no console
  warnings or errors, while legacy packages retain their current behavior;
- Digital Hub and then sixty5 publish index size/build cost, query p50/p95,
  candidate reduction, requested/off-view bytes, and first-frame impact. The
  sixty5 three-run first-coarse-frame p95 must remain at or below 15 seconds on
  the same recorded host class.

This evidence may accept the spatial-demand decision only. It does not by
itself make an ADR-0003 renderer-performance claim, prove screen-space LOD, or
prove spatial draw clustering.
