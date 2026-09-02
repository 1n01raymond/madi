# ADR-0019: Reuse verified per-document Scene IR artifacts across the adapter-compiler transport, retire the compiled payload tier

Status: Proposed

## Context

[ADR-0018](0018-content-addressed-compiled-payloads.md) content-addressed the
compiled prototype payload and was rejected by its own gate 4
([record](../../artifacts/cache/payload-reuse/README.md)): a changed-discipline
rebuild reproduced every clean package byte, but the packaging stage took
2.2-2.4x as long store-warm as clean (Digital Hub 3,184.9 ms against
7,585.0 ms, sixty5 35,202.0 ms against 77,713.5 ms). The Phase 2 tracker asked
for a successor that reuses something cheaper to restore than to rebuild and
named two candidates: laid-out byte ranges above the encoder, or
content-derived prototype ids so an edited document keeps its untouched
payloads.

Before choosing, the warm changed-discipline rebuild was decomposed. These are
**exploratory, single-run probes on this Windows host**, not a committed
record; the committed stage breakdown is this ADR's gate 0. Their purpose is to
size the levers, and the sizes are unambiguous.

Compiler process, warm changed-discipline clean compile
(`node --cpu-prof scripts/lib/ifc-cache-sample.mjs --config <changed-clean>
--phase probe`, self time summed per frame over the whole run; the same
configurations the ADR-0018 record used, document artifacts warm):

| Stage | Digital Hub | sixty5 |
|---|---:|---:|
| Compile wall time (`compileMilliseconds`) | 10,140 ms | 99,851 ms |
| Idle, waiting for the adapter subprocess | 6,988 ms | 62,787 ms |
| In-process compiler work | 3,195 ms | 37,109 ms |
| Structure stream scan (`ifc-structure-stream` frames, self) | ~1,240 ms | ~15,100 ms |
| Garbage collector + microtask pump (self) | 744 ms | 11,347 ms |
| `compileSceneToGltf` (inclusive) | 780 ms | 6,849 ms |
| of which `buildCompiledPayload` (the encoder) | 236 ms | 1,229 ms |
| Document streaming (`streamJsonInto`, inclusive) | 298 ms | 2,950 ms |
| `writeCompiledPackage` (inclusive) | 139 ms | 1,392 ms |
| `validateScene` (inclusive) | 92 ms | 1,018 ms |

Adapter process, warm document artifacts. Today `read_document_artifact`
verifies an artifact by re-serializing its parsed payload canonically and
hashing that text (`_canonical_sha256`). A Python script timed the three
candidate verification methods per stored artifact, one run, every artifact in
the two ADR-0018 caches (Digital Hub 6 files, 18,677,859 B gzipped; sixty5 8
files, 104,800,624 B):

| Method, summed over the cache | Digital Hub | sixty5 |
|---|---:|---:|
| `gzip.open` + `json.load` (the parse the adapter needs anyway) | 1.05 s | 7.59 s |
| Canonical re-serialization + SHA-256 (what runs today) | 4.66 s | 27.25 s |
| SHA-256 over the gunzipped stored bytes | 0.24 s | 1.50 s |

A plain warm adapter run of the Digital Hub changed configuration, all four
artifacts hit, took 6.7 s of wall time in the same session.

Store I/O over the ADR-0018 Digital Hub payload store (3,383 entries,
35,961,456 B, two runs): reading and hashing every entry 578-622 ms; reading
only 463-543 ms; `stat` only 35-39 ms; hashing the same bytes as one buffer
14.1-14.4 ms; copying them 3.4-3.5 ms. Restore cost was per-file overhead,
not hashing.

Three conclusions follow, and they decide this ADR.

1. **The encoder is not the lever.** `buildCompiledPayload` is 3.3 percent of
   the compiler's in-process time on sixty5 and 1.2 percent of the rebuild
   wall time (7.4 and 2.3 percent on Digital Hub). Any reuse unit that sits
   at or below the encoder -- restored payloads, laid-out `scene.bin` byte
   ranges, or a higher hit rate through content-derived prototype ids -- is
   capped there, and ADR-0018's store spent more than that ceiling on I/O
   before it restored a single byte. The tracker's two named candidates
   cannot pass gate 4 whatever their hit rate.
2. **The transport is the lever.** On a changed-discipline rebuild every
   unchanged document is verified by re-serialization (18-20x the cost of
   hashing its stored bytes), re-merged into the federation, re-written as
   the split Scene IR, then re-scanned by the compiler's streaming reader
   (~15.1 s of self time on sixty5, 41 percent of the compiler's in-process
   work, with most of the 11.3 s of garbage collection and microtask pumping
   attributable to the same pass). Only the changed document needs any of
   that.
3. **Restore must be one read and one hash.** A store of many small files
   pays per-file overhead that dwarfs the hashing it exists to do. The
   artifact cache already stores one file per document; the successor keeps
   that shape and removes the re-serialization.

## Decision

The reuse unit is the **verified per-document Scene IR artifact** that the
IFC adapter already publishes under `--cache`
(`naru.ifc-document-artifact.1`), promoted from "skip tessellation" to "skip
the transport": an unchanged document is verified by one digest over its
stored bytes and reaches the compiler without being re-serialized, re-merged,
re-written, or re-scanned. Compiled bytes are never reused; every package
resource is still laid out from the current scene, which keeps ADR-0018's
proven byte-identity contract and ADR-0010's rule that federation-global
packing is rebuilt.

The decision has three parts, landed as separate slices in this order, each
measured against gate 0 before the next begins:

1. **Verify stored bytes, never a re-serialization.** The artifact schema
   moves to `naru.ifc-document-artifact.2`, a cold namespace: the envelope
   records the SHA-256 of the canonical payload bytes as written, and a read
   hashes the gunzipped stream it is parsing instead of dumping the parsed
   object again. The key-input comparison and the schema check stay. This
   slice touches the adapter only and is expected to remove most of the
   adapter's warm-path time on real-large federations.
2. **Column-form structure so hydration is a view, not a parse.** The
   artifact's structure-bearing records (prototypes, occurrences, semantics,
   representations, document metadata) are stored the way the property
   columns (`madi.property-columns.1`) and the relocated hierarchy
   (`naru.package-hierarchy.1`) already are: fixed-width typed columns plus
   one string table, with geometry and property values in the binary
   sidecars they already occupy. The compiler restores a document by reading
   its file once, hashing it once, and taking typed-array views. This is
   what removes the structure scan; a per-document JSON artifact would move
   the same bytes through the same scanner.
3. **Assemble the federation in the compiler.** The adapter keeps ownership
   of extraction and of each document's artifact. For a rebuild it emits a
   federation manifest -- document order, per-document artifact key and
   digest, federation digest, adapter identity and options -- and re-extracts
   only the documents whose key misses. The compiler hydrates each verified
   artifact and performs the federation merge that `extract_federation`
   performs today (sorted record ids, material dedup, property-key interning)
   in-process. Where the adapter still writes a monolithic split Scene IR
   (no cache directory, or a consumer that asks for it), nothing changes.

`--payload-cache` **is removed.** Its ceiling is the encoder's share, so no
tuning can pass gate 4; a flag that can never be recommended is an option
surface, a cache-key input, a build-report block, and a test suite to
maintain for no outcome. The encoder/placement split
(`buildCompiledPayload` / `appendCompiledPayload`) and the shared cache
primitives stay: they moved no bytes and one place still decides offsets and
padding. The ADR-0018 record stays committed as the measurement that closed
that tier; its README will note that the recorder is retired with the flag.

## Resource ownership

- The adapter owns extraction and the per-document artifact. Its key is
  unchanged in substance: artifact schema, discipline, source digest, URI
  hint, thread count, and adapter fingerprint. Ownership therefore coincides
  with the document selectors ADR-0010 already records; a discipline that is
  renamed, relabelled, or re-pointed misses exactly as today.
- The compiler owns the federation merge, hydration, validation, and every
  package resource. It trusts an artifact only after the byte digest and the
  key input match; a mismatch is a warning and a re-extraction of that
  document, never an error, mirroring the whole-package cache
  ([ADR-0009](0009-persistent-compiled-cache.md)).
- The merge the compiler performs must be the merge the adapter performs. The
  proof is gate 1: a federation assembled from artifacts and one written
  monolithically by the adapter compile to byte-identical packages.

## Invalidation

| Change | Effect |
|---|---|
| Source bytes of one document | That document misses; the others restore by digest. |
| Adapter fingerprint, thread count, or extraction options | Every document misses (the key changes). |
| Artifact schema bump | Cold namespace; every document misses once. |
| Corrupt or truncated artifact | Digest mismatch, warning, re-extraction of that document. |
| Cross-document semantic relation touching an unchanged document | The document artifact is unaffected; the compiler's merge and ADR-0010's reconciliation set decide the package-level consequences, exactly as they do for a monolithic scene. |
| Compiler identity or compile options | No artifact effect; the whole-package cache misses and the compiler re-lays out the package from restored artifacts. |

## Consequences

### Positive

- The reuse unit is the one the invalidation index already understands: a
  document. No second identity scheme, no content digest over geometry, no
  store of thousands of small files.
- Restore is bounded by one sequential read and one SHA-256 of the stored
  bytes, which the probes above put at 1.5 s for the whole sixty5 artifact
  cache against 27.3 s of re-serialization today.
- The compiler stops scanning unchanged documents' structure JSON, the single
  largest in-process cost of a rebuild, and the adapter stops re-writing the
  federation it did not change.
- ADR-0018's byte-identity protocol carries over unchanged, so the successor
  is measured against the same bar with the same comparison tooling.
- Removing `--payload-cache` deletes an option that measurement showed can
  never be recommended.

### Negative

- Two format bumps: the document artifact (`.2`) and a column-form structure
  transport. Both are cold namespaces, so every user re-extracts once.
- The federation merge exists in two implementations, Python for the
  monolithic path and TypeScript for the artifact path, and they must stay
  byte-equivalent; gate 1 pins it, and every later adapter change to the merge
  must re-run that comparison.
- The compiler hydrates a real-large federation from N files instead of three;
  peak memory could rise if hydration copies where it should view. Gate 4's
  memory rule makes that a rejection, not a regression.
- Slice 3 is the largest change to `packages/compiler/src/ifc-federation.ts`
  since the streaming reader; the tracker sequences it last so slices 1 and 2
  can land and be measured on their own.

## Alternatives considered

- **Laid-out `scene.bin` byte ranges above the encoder**, the tracker's first
  candidate. Reusing a document's contiguous payload segment saves encoding
  and appending (1.3 s of 37.1 s in-process on sixty5) and, at best, part of
  the buffer hashing; the document JSON that names those ranges is still
  streamed in full unless it is templated, and the structure scan that
  dominates is untouched. Capped near one tenth of the compiler's in-process
  time; rejected as the lever. It stays available as an additive after the
  transport is fixed, if gate 0 then shows encoding has become significant.
- **Content-derived prototype ids**, the tracker's second candidate. This
  raises the hit rate of a tier whose ceiling is the encoder's share, so it
  cannot change the gate 4 outcome. It may still be adopted later for
  identity stability across edits (ADR-0010's rename cases), as its own ADR.
- **Fix only the verification and stop.** Slice 1 alone is the cheapest
  change and probably the largest single saving on the adapter side, but it
  leaves the federation rewrite and the compiler's full structure scan; it is
  the first slice, not the decision.
- **Column-form federation structure without per-document artifacts.** Cuts
  the scan, keeps the adapter re-merging and re-writing every document, and
  ties invalidation to the federation. Rejected; the column form is adopted at
  document granularity instead.
- **Keep `--payload-cache` as an off-by-default experiment.** Rejected: the
  measurement is complete and its ceiling is known.

## Validation

The gates are predeclared here, before any slice lands, and a failed gate 4
rejects this ADR the way it rejected ADR-0018; no gate may be loosened to pass.

- **Gate 0, before any transport code:** a committed record decomposing a
  changed-discipline rebuild of Digital Hub and sixty5 into stages --
  adapter: interpreter start, changed-document extraction, artifact
  verification, merge, Scene IR write; compiler: structure read, hydration
  and validation, packaging, document streaming, package write -- with the
  fresh-process, predeclared-sample protocol of
  [artifacts/cache/sixty5](../../artifacts/cache/sixty5/README.md). It fixes
  the baseline every later gate is measured against and closes the "real-large
  reopen stage breakdown" evidence debt in [PHASE_2](../PHASE_2.md). The
  exploratory attribution above must reproduce within the record's own
  spread or the Context of this ADR is corrected before slice 1.
- **Gate 1, byte identity:** every package resource of a changed-discipline
  rebuild through restored artifacts is byte-identical to a clean compile on
  both models, with the ADR-0018 record's closed report-exclusion list and no
  additions to it. Slice 3 additionally proves the compiler-side merge equals
  the adapter's on a federation with cross-document relations, shared
  materials, and interned property keys.
- **Gate 2, exact decisions:** the adapter report names every document's
  restore or extraction and its reason; a corrupt artifact warns and
  re-extracts; a wrong key never restores.
- **Gate 3, restore cost:** the verification stage of an unchanged document,
  measured in the gate 0 decomposition, is bounded by one read and one hash
  of its stored bytes -- no stage re-serializes, re-parses for verification,
  or opens more than one file per document.
- **Gate 4, the same rule as ADR-0018:** after each slice, the whole-process
  median of a changed-discipline rebuild is lower than the clean rebuild
  median on Digital Hub and on sixty5, by more than three times the clean
  samples' own spread (maximum minus minimum), with peak process-tree memory
  no higher. The record that closes slice 3 moves this ADR and
  [ADR-0010](0010-ifc-incremental-dependency-index.md) to Accepted; a failure
  at any slice records the measurement and marks this ADR Rejected.

The removal of `--payload-cache` is its own slice and needs no gate beyond
`pnpm check`: the ADR-0018 record's validator keeps validating the committed
record, and the record README states that the recorder is retired.
