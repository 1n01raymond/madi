# ADR-0018: Content-address compiled prototype payloads, rebuild the federation

Status: Rejected

## Context

[ADR-0009](0009-persistent-compiled-cache.md) caches one whole compiled package
under one key covering the complete federation identity, so changing a single
IFC discipline misses. [ADR-0010](0010-ifc-incremental-dependency-index.md)
records which semantic entities, prototypes, occurrences, and target chunks
each document owns, and the IFC adapter already reuses per-document extraction
artifacts, but neither authorizes reusing compiled bytes: ADR-0010 states that
logical target-chunk IDs are revision-local, "so they cannot yet authorize
physical range reuse".

The committed sixty5 cache record decomposes a cold import into roughly
292.4 s of adapter extraction, 89.0 s of packaging, and 1.36 s of restore
([artifacts/cache/sixty5](../../artifacts/cache/sixty5/README.md)). The
document-artifact cache attacks the first stage. This ADR governs the second,
and only the part of it that is per-prototype work.

Three properties of the current packager constrain any reuse contract, and all
three were read out of the code rather than assumed:

- `GltfBinaryBuilder.append` (`packages/compiler/src/binary.ts`) assigns
  byteOffsets sequentially with `(4 - (byteLength % 4)) % 4` padding and hands
  out bufferView/accessor indices in append order. A prototype's bytes are
  contiguous, but its offsets, indices, and inter-payload padding are
  federation-global and move whenever anything earlier in the order changes.
- `targetChunkGroups` (`packages/compiler/src/gltf.ts`) derives chunks from the
  sorted byteOffsets under a byte budget, so chunk membership is a function of
  the whole layout, not of any one document.
- `properties.json`/`properties.bin` carry the adapter's
  `madi.property-columns.1` output byte-verbatim with federation-global key and
  key-set interning, so a property column is meaningless outside the federation
  that interned it.

## Decision

- Content-address the **prototype payload** and nothing else. A payload is the
  ordered list of accessor byte blobs `appendGeometry` produces for one
  prototype — positions, normals, face source IDs, per-material-group indices,
  and edge accessors — together with the accessor metadata that does not depend
  on placement (`componentType`, `count`, `type`, `target`, `name`, `min`,
  `max`). Byte offsets, bufferView indices, accessor indices, material indices,
  node indices, and target-chunk membership are excluded by construction.
- Rebuild every other package resource on every compile. `scene.gltf`,
  `scene.bin`, `coarse.bin`, `spatial.bin`, `properties.json`,
  `properties.bin`, `hierarchy.json`, `hierarchy.bin`, `build-report.json`,
  `adapter-report.json`, and `incremental-dependencies.json` are
  federation-global: they are re-derived from the current scene and the
  restored payloads, never copied from a previous revision. `scene.bin` is
  re-laid out from payload bytes in the current prototype order, which is what
  makes padding and offsets correct without trusting a stale layout.
- Store payloads under schema `naru.compiled-payload-entry.1` in a namespace
  that includes the schema ID, so a schema bump is a cold namespace and never
  an in-place migration.
- Key each payload by a digest over: the schema ID; the compiler identity
  already used by ADR-0009 (`currentCompilerCacheIdentity`, a content hash of
  the compiler module directory plus Node, platform, and architecture); the
  adapter name, version, and fingerprint; the prototype's Scene IR content
  digest, taken over representation content rather than over its position in
  the geometry buffer; the scene unit scale applied by `appendGeometry`; and
  the payload-affecting compile policy set.
- Classify every compile option explicitly. Layout-affecting options are
  excluded by name with a stated reason (target chunk byte budget, spatial index
  and leaf capacity, spatial payload order, compact JSON, node identity and
  transform elision, hierarchy relocation, resource-name elision -- none of
  which change a single payload byte); everything else enters the key. Today the
  keyed set is empty, because the encode/place split put every layout decision
  after `buildCompiledPayload`. Resource-name elision belongs on the excluded
  side for that reason: `GltfBinaryBuilder.append` drops the names while placing
  a payload, so the option changes the document and never the payload. Whether a
  prototype carries edge accessors is not a compiler option -- it comes from the
  prototype's Scene IR representation, which the content digest already covers.
  **An option that is not classified is payload-affecting.** Adding an
  unclassified option therefore invalidates the namespace rather than silently
  sharing it, and an option whose value cannot be described in a key at all
  fails the compile instead of being dropped from it.
- Derive the reuse decision from content, not from the invalidation plan. The
  [ADR-0010](0010-ifc-incremental-dependency-index.md) index governs which
  documents must be re-extracted by the adapter; the payload store governs
  which prototypes must be re-encoded. Store correctness does not depend on the
  plan being right: a wrong plan produces extra extraction work, never a wrong
  payload.
- Publish atomically and immutably. Write into a `mkdtemp` sibling and
  `rename` into place. If the key already exists, read the stored digest back
  and compare; a mismatch is a hard `AMBIGUOUS_PAYLOAD` failure, never an
  overwrite, so one key can never publish two byte sequences.
- Treat corruption as a verified miss. Before use, re-derive the key from the
  stored input record and compare it with the entry's own directory name, then
  verify the payload byte count and SHA-256. Any mismatch warns and rebuilds,
  matching the fail-closed behavior ADR-0009 already ships.
- Refuse path traversal, absolute paths, and symlinks, exactly as
  `compiled-cache.ts` does: one portable file-name pattern per resource and an
  `lstat` check that the target is a regular file. Entries are JSON and opaque
  bytes; no executable serialization is ever read or written.
- Reclaim space only on an explicit sweep. A compile never deletes an
  unreferenced payload, so a concurrent compile cannot lose an entry it is
  about to publish. Pruning is a separate, declared retention operation.
- Keep the trust boundary local. Digest possession proves content identity, not
  authorization to read a payload; a shared or network store is out of scope
  here and needs its own decision. Reports name hits, misses, and rebuild
  reasons by prototype ID and never by source path or property value.
- Keep [ADR-0010](0010-ifc-incremental-dependency-index.md) and this ADR
  Proposed until the evidence below passes.

## Resource ownership

Every resource `build-report.output.resources` can list, plus the dependency
metadata, with its rule. "Federation-global rebuild" means the resource is
produced from the current scene on every compile.

| Resource | Owner | Rule |
|---|---|---|
| `scene.gltf` | federation | Rebuild. Node, accessor, bufferView, material, and chunk indices are global. |
| `scene.bin` | federation layout over owned payloads | Rebuild by re-laying out payload bytes in the current prototype order; padding depends on that order. |
| `coarse.bin` | federation | Rebuild. Coarse aggregation and instance ordering span the scene. |
| `spatial.bin` | federation | Rebuild. Leaf assignment depends on whole-scene bounds. |
| `properties.json`, `properties.bin` | adapter | Rebuild from the adapter merge. Key and key-set interning is federation-global, so a column cannot be lifted out of its federation. |
| `hierarchy.json`, `hierarchy.bin` | federation | Rebuild. Node indices and composed world matrices are global. |
| `build-report.json` | compiler | Rebuild. |
| `adapter-report.json` | adapter | Rebuild. |
| `incremental-dependencies.json` | compiler | Rebuild from the current scene and document set. |
| prototype payload | prototype content | Content-addressed reuse, the only reuse this ADR authorizes. |

Operational reports separate telemetry from output identity. These fields are
execution-path telemetry and are excluded from equivalence comparison by name:
`adapter-report.json:documentArtifactCache` (already the declared exclusion in
[artifacts/cache/sixty5](../../artifacts/cache/sixty5/README.md)) and the new
`build-report.json:compiledPayloadCache` block. Every other reported field is
output identity and must compare equal.

## Invalidation

| Case | Extraction (ADR-0010 plan) | Payload store |
|---|---|---|
| Document changed | Re-extract that document and its reconciliation component | Prototypes whose content changed miss; the rest hit |
| Document added | Extract the new document | Hits are legitimate where content is identical: the same bytes have the same key |
| Document deleted | Nothing to extract | Payloads go unreferenced; a compile never deletes them |
| Renamed or relabelled with stable content | Treated as the same content by the plan | Every payload hits: discipline is not part of a payload key, because it changes no payload byte |
| Equal-digest ambiguous rename | Delete plus add, per ADR-0010 | Unaffected: keys are content-derived, so the ambiguity cannot pick the wrong payload |
| Cross-document reconciliation | Transitive component re-extracted | Only prototypes whose content actually moved miss |
| Corrupt or unreadable entry | Unaffected | Verified miss, warn, rebuild |
| Unclassified or new compile option | Unaffected | Payload-affecting by default, so the namespace misses |

## Consequences

### Positive

- A changed discipline stops re-encoding every unchanged prototype, while the
  package it produces is still assembled from scratch, so no stale layout can
  survive into a published package.
- Correctness does not rest on the invalidation plan. The plan can only cost
  extra extraction work.
- The store's safety properties are the ones already exercised by ADR-0009:
  key reproduction, byte-count and SHA-256 verification, atomic publish, path
  and symlink refusal, and no executable deserialization.

### Negative

- The saving is bounded and does not touch the largest stage. Document
  serialization, resource writing, coarse, spatial, property, and hierarchy
  construction all remain federation-global, and the sixty5 record puts
  extraction at roughly 292.4 s against 89.0 s of packaging.
- A second cache tier costs disk beside the whole-package cache, and the two
  can hold the same bytes twice.
- Payload identity depends on the compiler module hash, so any compiler change
  cold-starts the namespace, exactly as it does for the whole-package cache.

## Alternatives considered

- Reuse `scene.bin` byte ranges directly. Rejected: offsets, padding, and chunk
  membership are federation-global, which is the gap ADR-0010 already names.
- Content-address target chunks instead of prototypes. Rejected: chunk
  membership is derived from the global layout, so a chunk key would change
  whenever any earlier prototype changed size.
- Content-address property columns. Rejected: interning is federation-global,
  so a column is not meaningful outside the federation that produced it.
- Skip this tier and extend the document-artifact cache to hold compiled bytes.
  Rejected: that would put federation-global layout decisions behind an
  adapter-side key that cannot see them.

## Validation

This ADR is accepted only when all of the following pass, and rejected if the
measurement gate fails:

1. **Clean-package resource equivalence.** A store-enabled changed-discipline
   Digital Hub rebuild produces byte-identical `scene.gltf`, `scene.bin`,
   `coarse.bin`, `spatial.bin`, `properties.json`, `properties.bin`,
   `hierarchy.json`, `hierarchy.bin`, and package digest against a clean full
   compile with the store disabled.
2. **Semantic report comparison.** `build-report.json` and
   `adapter-report.json` compare equal except the two telemetry fields named
   above, and the exclusion list is closed and enumerated in the record.
3. **Focused tests** for every row of the invalidation table, plus idempotent
   publication, one-key-one-byte-sequence refusal, corruption as a verified
   miss, path/symlink refusal, and unchanged clean-build and whole-package
   cache determinism. Storage, selection, and reconstruction tests run without
   Python; the adapter integration suite covers the rest.
4. **A measured saving that exceeds its own cost.** The changed-discipline
   packaging stage must be measurably faster than the same rebuild with the
   store disabled, with peak memory no higher than the clean build, on Digital
   Hub and on one real-large model. If reuse does not beat re-encoding plus
   verification, this decision is rejected rather than accepted.
5. `pnpm adr:check` and `pnpm check` pass without loosening any validator.

Implementation follows the storage then selection/orchestration order the
tracking issue sets.

**Status of that order.** Storage and orchestration have both landed.
`packages/compiler/src/compiled-payload.ts` splits encoding from placement and
supplies `compiledPayloadContentDigest`;
`packages/compiler/src/compiled-payload-store.ts` publishes and restores
`naru.compiled-payload-entry.1` entries under the guards listed above, sharing
them with the whole-package cache through `cache-primitives.ts`; and
`packages/compiler/src/compiled-payload-cache.ts` decides per prototype whether
to restore or build, publishes what it built, warns and rebuilds on a corrupt
entry, and reports hits, misses, and rebuild reasons into
`build-report.json:compiledPayloadCache`. Both compilers accept
`--payload-cache <directory>`, off by default, so no committed package or digest
moved. Digital Hub still compiles to the package digest already recorded in
[artifacts/compiler/node-field-elision](../../artifacts/compiler/node-field-elision/README.md).

Gate 3 is met: the storage guards listed above, plus the invalidation-table rows
that do not need Python (content change, stable-content relabelling, corrupt
entry, unclassified option), the classification rule itself, and a unit-scale
proof that a store-warm compile publishes the same `scene.bin`, document digest,
and package digest as a compile with the store disabled. Gates 1 and 2 are met on
both models: [artifacts/cache/payload-reuse](../../artifacts/cache/payload-reuse/README.md) records a
changed-discipline rebuild of Digital Hub (10 scenarios, 16 comparisons) and of
sixty5 (6 scenarios, 10 comparisons) whose every package resource is
byte-identical to a clean compile, with the two-field report exclusion list
closed and every store decision exact (Digital Hub 2,664 of 3,383 payloads
restored, sixty5 40,066 of 42,435).

**Gate 4 failed on both models, so this ADR is Rejected (2026-09-02) by its own
rule.** The changed-discipline packaging stage took a median 3,184.9 ms clean
against 7,585.0 ms store-warm on Digital Hub (0.42x) and 35,202.0 ms against
77,713.5 ms on sixty5 (0.453x); peak process-tree memory was 1.6 MB higher on
Digital Hub and 76.6 MB lower on sixty5. Restoring a payload -- reading its
manifest and binary and verifying every byte -- costs more than re-encoding it
from the parsed Scene IR, because the expensive tessellation already sits in
the adapter's document-artifact cache and encoding is a typed-array copy.
Exploratory probes in the record rule out publication timing and store
location. The record also shows the edited document reuses nothing by
construction: prototype ids embed the document token and the payload digest
hashes the representation id, so one edit renames every prototype of that
document.

What survives: the storage guards, the encoder/placement split, and
`--payload-cache` itself stay in the compiler, off by default, as the measured
experiment; removing them is a separate decision. What does not: this reuse
unit is not the partial-rebuild strategy. A successor ADR must pick a unit whose
restore is cheaper than re-encoding -- laid-out byte ranges above the encoder,
which this ADR excluded, or content-derived prototype ids -- and
[ADR-0010](0010-ifc-incremental-dependency-index.md) stays Proposed until one
does.
