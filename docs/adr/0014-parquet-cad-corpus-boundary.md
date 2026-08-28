# ADR-0014: Treat Parquet CAD corpora as bounded source containers

Status: Proposed

## Context

The public fixture ladder exercises individual STEP parts and large IFC
federations, but it does not represent broad CAD shape diversity. CadQuarry
publishes deterministic, execution-validated parametric parts and their STEP
B-rep payloads under CC0-1.0. Its 1,000-part STEP variant is distributed as one
Parquet file whose rows also carry source, generator, identity, family,
complexity, and license metadata.

That file is neither a STEP Part 21 document nor an assembly. Feeding it to the
current line-oriented Part 21 inspector would produce meaningless counters,
while loading it through an unconstrained Parquet library would add a new
native-parser and decompression trust boundary. Executing the embedded Python
source to recover geometry would add a much larger code-execution boundary and
is unnecessary because the rows already contain `step_bytes`.

## Decision

- External-fixture manifest schema 1.1 adds the `cad-corpus` dataset kind, the
  `parquet` asset format, and a `synthetic-control` tier. A CAD corpus pins both
  its distribution revision and its upstream license revision.
- The first registration is `cadquarry-1k-step`: the 1,000-row CadQuarry v0.6.0
  STEP corpus at Hugging Face revision
  `be52b95de212431d995c3ebd25bdd9d56a5c96bf`, published as CadQuarry v0.6.0.
  Its upstream `DATA_LICENSE` is pinned at
  `543b067ea9e416bc2e9587cb8775e012480b70ee` and licensed CC0-1.0.
- Registration records expected corpus metadata but is not inspection
  evidence. Until a scanner is implemented and reviewed, `inspect` fails with
  an explicit diagnostic and the dataset remains `registered`.
- A future qualifying scanner must verify the complete Parquet file's declared
  byte length and SHA-256 before parsing. It must bound footer bytes, row-group
  and column counts, decoded metadata, one STEP payload, aggregate extracted
  bytes, and temporary-disk use before allocating or decompressing them.
- The scanner reads data only. It never imports or executes a row's Python
  source, CadQuery program, pickle, extension hook, or other executable
  representation. STEP payloads are written to the ignored fixture cache and
  cross the existing isolated OCCT adapter boundary individually.
- Qualification evidence uses external-inspection schema 1.1 and a
  corpus-specific record. It binds the asset identity, Parquet magic and row
  groups, exact required columns and row count, non-null STEP payload and part
  identity counts, unique part identities, and the single expected generator
  version and license value. It does not report Part 21 entity counts for the
  Parquet container.
- Selecting a Parquet implementation is deferred until at least two candidates
  are measured for install size, native/Wasm surface, bounded-read support,
  peak memory, and scan time on this pinned 120 MB corpus. Adding that parser is
  a separate dependency review rather than an incidental registry change.
- CadQuarry is a synthetic CAD breadth and adapter-control source. Independent
  generated parts do not supply a real assembly hierarchy, spatial layout,
  occurrence count, submitted-triangle count, or an observed unique-prototype
  count. Neither its declared 1,000 rows nor a later larger tag may close the
  real source-derived Phase 2 public-baseline gate without separate compilation
  and assembly evidence.

## Consequences

### Positive

- CAD diversity becomes an explicit workstream without weakening the license,
  checksum, or evidence rules used by the IFC ladder.
- Offline validation can reject incomplete or drifted future corpus evidence
  without requiring the Parquet parser in CI.
- A container cannot be mistaken for one huge Part 21 document, and embedded
  source cannot become an accidental code-execution path.
- The benchmark plan keeps synthetic CAD breadth separate from real federated
  scene scale, so row counts cannot be substituted for measured prototypes or
  occurrences.

### Negative

- The registered corpus cannot yet be inspected, extracted, compiled, or used
  for a performance claim through repository commands.
- Contributors who opt into the source download cache a 120 MB container
  before any payload can be selected.
- Qualification will require a reviewed parser dependency or an isolated
  helper, plus resource-limit and malformed-container tests.
- A 1,000-part corpus is useful for the first breadth slice but is far below the
  10,000 measured-prototype condition being explored for later Phase 2 work.

## Alternatives considered

- Treat the Parquet file as STEP and reuse the Part 21 inspector. Rejected: the
  resulting envelope and entity metrics would describe the wrong format.
- Install PyArrow immediately and trust its defaults. Rejected: a large native
  dependency and decompressor needs explicit limits, isolation, and measured
  cost before it becomes contributor infrastructure.
- Execute each embedded CadQuery program and regenerate the part. Rejected:
  code execution is unnecessary for an already-published STEP payload and
  changes the fixture from source inspection into generator validation.
- Register the STL variant. Rejected for this slice: triangle meshes test a
  different ingestion boundary and do not exercise NARU's OCCT STEP path.
- Call each published row one unique NARU prototype. Rejected: source rows and
  compiled prototype identities are different measurements, and compilation
  may deduplicate or reject shapes.

## Validation

`tools/external-fixtures/test/external-fixtures.test.ts` exercises the offline
corpus evidence contract, including exact asset identity, row/column metadata,
payload completeness, unique identity, generator version, and license drift.
It also proves that the current inspector rejects `cad-corpus` input instead of
running the Part 21 scanner. `pnpm fixtures:external:check` validates manifest
1.1, the pinned distribution and upstream revisions, the CC0 notice, corpus
metadata, and all pre-existing qualification evidence.

This ADR stays Proposed until a bounded scanner is implemented, the pinned 1k
file is actually inspected, the inspection is committed, and the dataset is
promoted to `qualified`. No CadQuarry download or parser installation was
performed for this decision record.
