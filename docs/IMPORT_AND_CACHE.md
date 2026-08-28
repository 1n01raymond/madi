# Import and compiled-cache product contract

Status: Phase 2 contract; cache-store plus STEP/IFC whole-package integration
implemented, and the persistent-cache acceptance gate is closed by recorded
real-toolchain evidence ([record](../artifacts/cache/README.md),
[ADR-0009](adr/0009-persistent-compiled-cache.md), Accepted).

## 1. User promise

Opening engineering source and reopening derived content are different product
paths. NARU may spend minutes translating a real-large source for the first
time, but it must not repeat that work when the authoritative inputs and all
compile-affecting identities are unchanged.

| Scenario | Product target | Required behavior |
|---|---:|---|
| First real-large import | minutes allowed | visible progress, cancellation, background execution, and a durable result |
| First import, hierarchy and coarse preview | 5–15 seconds | hierarchy/search before full geometry; recognizable coarse frame while import continues |
| Reopen with unchanged inputs | 1–5 seconds | validate source/cache identity and open the compiled cache without running the source adapter |
| One IFC discipline changed | proportional to the change | re-inspect every source identity, then rebuild only affected document/prototype/chunk dependencies |
| Team reuse | no duplicate local import when policy permits | resolve a verified shared content-addressed entry, then retain a local copy |

These are product SLOs, not claims about current evidence. Cold and warm results
must be reported separately under [the benchmark rules](BENCHMARKS.md). The
current real-large boundary is a recorded 302-second end-to-end sixty5 import
([evidence](../artifacts/ifc/sixty5/README.md)); shared coarse residency, a
virtualized assembly list, skip-and-continue admission, estimate-gated
prefetch, and a shared prototype vertex pool later record a 4.283-second first
frame ([evidence](../artifacts/ifc/sixty5-first-frame/README.md)). The recorded cache
evidence proves compile-level warm reopens on the pinned mid-size fixtures
(0.5 s for the Digital Hub federation, 1.7 s for the PyGamer STEP fixture —
[record](../artifacts/cache/README.md)); a real-large sixty5 reopen
distribution remains unproven.

## 2. User-visible lifecycle

```text
Open STEP/IFC
  -> inspect source envelopes and digests
  -> resolve local/shared cache key
     -> hit: verify manifest/resources -> open hierarchy/coarse package
     -> miss: start cancellable adapter job
              -> publish hierarchy/coarse progress
              -> compile immutable package
              -> verify and atomically publish cache entry
              -> open published entry
```

The Studio owns progress, cancellation, retry, and notifications. Adapters run
outside the browser trust boundary. Cancellation must stop child processes and
remove unpublished temporary output; it must never remove a previously
validated cache entry.

## 3. Cache identity and invalidation

A hit is valid only when the deterministic key includes every input capable of
changing output:

- ordered source roles and SHA-256 digests, never local absolute paths;
- adapter name and exact version/toolchain fingerprint;
- compiler name and cache-compatible version;
- compile-affecting options such as tessellation, edge, coordinate, chunking,
  property, and LOD policies; and
- cache schema major version.

Stable source labels such as IFC URI hints and the current STEP basename are
inputs because the current glTF profile serializes them. Absolute machine path,
output directory, and UI state are not inputs. Thread count may be excluded only
after determinism evidence proves it cannot change output. Unknown or incomplete
identities are cache misses.

`packages/compiler/src/compiled-cache.ts` implements the first storage slice:
`naru.compiled-cache-entry.1` keys normalized inputs, records every package
resource byte count and SHA-256, verifies the complete entry before restore,
and publishes/restores through same-parent temporary directories and atomic
rename. Its tests prove key determinism, idempotent publish, successful restore,
and storage-layer rejection of corrupted entries; the STEP and IFC compile
orchestrations report a damaged or unreadable entry and fall back to a full
recompile, so a broken cache degrades to a miss instead of blocking compilation.
The STEP and IFC CLIs can opt in with
`--cache`. Each adapter exposes a cheap `--identity`: OCCT fingerprints its
implementation and pinned CadQuery/OCP toolchain, while IFC fingerprints its
extraction modules and pinned IfcOpenShell/numpy toolchain; both include Python,
OS, and architecture. The compiler identity is a content hash over the
compiler's own module files and also includes Node/OS/architecture
until cross-platform determinism is proven. An unchanged second compile reuses
verified existing output or atomically restores it without running extraction.
Focused tests prove this orchestration for STEP and a single-document IFC
federation, and the recorded cold/warm/corruption runs with the pinned native
toolchains close that gate ([record](../artifacts/cache/README.md)).

## 4. Storage and security

- Cache entries are immutable and addressed by their 64-character lowercase
  SHA-256 key.
- A manifest is trusted only after schema, key reproduction, path policy, byte
  count, and resource digest verification.
- Resource paths are portable single-file names in version 1. Absolute paths,
  traversal, symlinks, and implicit external dependencies are rejected.
- A reader never observes partially published output. Corrupt or incompatible
  entries fail closed and are eligible for quarantine/rebuild by the host.
- Source documents remain authoritative under [ADR-0002](adr/0002-source-and-cache.md).
  Deleting the cache must lose no authored engineering information.
- A shared cache must enforce repository/tenant authorization independently of
  content identity. Knowing a digest does not grant access to source-derived
  geometry or properties.

## 5. Incremental and shared-cache stages

The first key represents a complete compiled package. Incremental IFC rebuilds
require a second dependency index before they are safe:

1. source discipline digest -> semantic/prototype identities;
2. prototype identity -> target/coarse/spatial/property chunks;
3. compiler policy -> dependency version;
4. federation reconciliation -> cross-document invalidation set.

The index must have determinism and deletion/rename tests before it can drive
reuse. Until independently reusable adapter and payload artifacts are added, a
changed discipline still causes a full federation miss. This is slower but
correct.

The first index contract is now implemented as
`incremental-dependencies.json` (`naru.ifc-incremental-dependency-index.1`,
[ADR-0010](adr/0010-ifc-incremental-dependency-index.md)). It maps each
discipline to semantic, prototype, occurrence, current target-chunk,
coarse-prototype, spatial-occurrence, and property-semantic selectors, and
expands cross-document semantic relations to a transitive reconciliation set.
Focused tests cover changed, deleted, and renamed/relabelled inputs plus
reconciliation invalidation, and unchanged whole-package cache hits restore the
index byte-for-byte. The adapter and federation-wide payload files are still
rebuilt as a whole: independent adapter outputs, content-addressed payloads, and
clean-full-build equivalence evidence remain the gate before any unchanged
prototype or byte range is actually reused.

Shared lookup reuses the same manifest and resource hashes. The resolution
order is local verified entry, authorized shared entry, then local compilation.
Uploads occur only after local verification and explicit host policy; NARU does
not upload proprietary sources as part of cache publication.

## 6. Delivery-format boundary

The cache is not a replacement CAD/BIM interchange format. Standard glTF
delivery remains available, and a cache may contain the existing `scene.gltf`,
geometry, coarse, spatial, and property resources unchanged. General object
encodings such as BSON are not the target: repeated numeric tables should move
to measured columnar binary resources only when they beat the standards-based
profile under [ADR-0004](adr/0004-format-strategy.md).

## 7. Implementation order and acceptance gates

1. **Persistent source-digest cache:** storage foundation, OCCT/IFC identities,
   and STEP/IFC whole-package integration implemented; pinned real-fixture
   cold/warm and corruption evidence recorded
   ([record](../artifacts/cache/README.md)).
2. **Columnar hierarchy sidecar:** compare size, parse, hierarchy-ready time,
   peak memory, and compatibility against compact glTF JSON.
3. **Incremental IFC compilation:** discipline dependency index plus changed,
   deleted, renamed, and reconciliation tests implemented; independent adapter
   documents, content-addressed payload reuse, and clean-full-build equivalence
   remain.
4. **Standards export:** retain glTF; evaluate GLB, GPU instancing, and mesh
   compression without making the cache an interchange claim.
5. **Shared cache:** authenticated lookup/publication, tenant isolation,
   provenance, quotas, eviction, and observability.

Focused tests already prove an unchanged STEP and single-document IFC input
skip extraction, preserve the package digest, invalidate changed compile
identity, and reject corrupted entries at the storage layer while the
orchestration falls back to recompilation. The persistent-cache gate is closed:
the pinned PyGamer STEP fixture and the four-document Digital Hub federation
reproduce those properties with published cold/warm timings and a fail-closed
corrupted-entry recompile ([record](../artifacts/cache/README.md), validated by
`pnpm cache:check`). The real-large product gate additionally requires
three-run distributions for the SLO table on a recorded host class.
