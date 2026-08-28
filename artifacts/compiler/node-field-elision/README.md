# Compiled-document node byte split and the node-size levers

Status: recorded product evidence for issue #85; supports ADR-0015 (Proposed).

Issue #85 asks for the measurement before the choice. This record answers
*where a large federation's compiled glTF document actually spends its bytes*,
then ranks the levers against that split rather than against a small fixture,
and proves the two implemented levers change the document without changing
what the runtime loads.

Two models are measured, both compiled from a retained Scene IR split with the
engineering baseline's option policy (compact JSON, omitted resource names,
spatial index, `spatial-leaf-anchor-v1` payload order): the four-document
**Digital Hub** federation and the **engineering baseline** (268,001
occurrences, 405,570,167 B document).

## Where the bytes are

Engineering baseline, as a share of the whole 405,570,167 B document:

| Document member | Bytes | Share |
|---|---:|---:|
| `nodes` | 146,892,022 | 36.2% |
| `meshes` | 127,260,888 | 31.4% |
| `accessors` | 80,000,737 | 19.7% |
| `bufferViews` | 47,350,974 | 11.7% |
| everything else | 4,065,545 | 1.0% |

Inside the 268,002 nodes:

| Node member | Bytes | Share of document |
|---|---:|---:|
| `extras.madi.semanticId` | 22,032,020 | 5.43% |
| `extras.madi.prototypeId` | 21,322,632 | 5.26% |
| `extras.madi.sourceRef` | 21,228,017 | 5.23% |
| `matrix` | 20,694,932 | 5.10% |
| `extras.madi.occurrenceId` | 17,536,994 | 4.32% |
| `extras.madi.tags` | 16,950,164 | 4.18% |
| `name` | 8,859,672 | 2.18% |
| `extras.madi.initialVisibility` | 6,700,025 | 1.65% |
| `extras` envelope | 5,360,039 | 1.32% |
| `coarseMesh`, `children`, `mesh`, punctuation, scene metadata | 5,671,514 | 1.40% |

Both tables account for every byte of their level: the node rows sum to the
146,356,009 B the `nodes` elements occupy, and the members sum to the document
less its own closing brace.

Bytes are counted compact-equivalent: whitespace outside strings is ignored,
and a member's key, colon, value, and following comma are all charged to that
member, because eliding the member removes all four.

## The corrected ranking

The issue assumed identifier elision was the leading lever. On the target model
it is not — 163,665 of 268,002 nodes carry no mesh at all and cost
**88,741,293 B (21.88%)**:

| Rank | Lever | Kind | Bytes | Share |
|---:|---|---|---:|---:|
| 1 | mesh-less hierarchy-node relocation | candidate upper bound | 88,741,293 | 21.88% |
| 2 | derived-identifier elision | **measured** | 21,227,965 | 5.23% |
| 3 | tag-set interning (300 distinct sets) | candidate upper bound | 16,950,164 | 4.18% |
| 4 | node-name elision | candidate upper bound | 8,859,672 | 2.18% |
| 5 | default-visibility elision | candidate upper bound | 6,700,025 | 1.65% |
| 6 | default-transform omission | **measured** | 2,231,408 | 0.55% |

A *measured* row is a real difference between two compiles. A *candidate upper
bound* is read off the byte split — the most those bytes could ever be worth —
and is never presented as a saving; each would still need its own reconstruction
rule, and rows 3–5 in particular are upper bounds for schemes that do not exist.

Both implemented levers together recover 23,459,373 B (5.78%), exactly the sum
of their parts: they touch disjoint members.

Honest limits of lever 2 on this input: the `semanticId` half **never fires**
(`semanticIdFromPrototypeId` is 0 on both models — an IFC federation's semantic
id is not derived from its prototype id), so the whole saving comes from
`sourceRef` derived from `semanticId` on 268,001 of 268,002 nodes. Lever 6 is
small because only 28,718 nodes carry an identity matrix and 47,454 more are
translation-only; the remaining 191,830 keep a full `matrix`.

## What was proven, and how

- **Default output is unchanged.** The `baseline` variant reproduces
  `04472c9ad292…`, the package digest the sanctioned `compileIfcFederation`
  pipeline already wrote next to the engineering baseline split. (Digital Hub's
  split directory was compiled under a different option policy, so the record
  marks that comparison as not applicable instead of skipping it silently.)
- **Round trip is exact.** Digital Hub is compiled twice in one process,
  baseline and fully elided, and both documents are decoded through the runtime
  loader: 5,152 occurrences, 13,681 hierarchy entries, and 5,152 instance
  transforms compared element by element with `Object.is` — 0 mismatches, and
  identical decoded geometry (3,383 batches, 40,596 triangles, 3,085,296
  binary bytes).
- **Determinism.** The fully elided variant recompiles to the same digest and
  the same byte count on both models.

## Limits

Digests and byte counts here are **host-local**. This Windows host's IFC
adapter emits an engineering-baseline split of 544,042,274 B, and the committed
macOS record in `artifacts/ifc/engineering-baseline/` was taken on a host whose
split differs by a few bytes; the two compile to different package digests
(`04472c9a…` here versus `6d23bffd…` there) even though `scene.gltf` is
byte-length-identical at 405,570,167 B on both. That is the already-recorded
cross-host adapter drift, not a change from this slice — so this record stands
on its own host and `artifacts/ifc/engineering-baseline/` was **not**
re-recorded here.

No timing, memory, or frame claim is made: the levers change document bytes,
and only document bytes are measured.

## Reproduce

Both models need a retained Scene IR split (`--retain-scene-ir`) under
`output/ifc/digital-hub-split4` and `output/ifc/engineering-baseline`. Each
variant compiles in its own process because a federation-scale compile peaks
near 3 GB.

```sh
pnpm node-fields:evidence
pnpm node-fields:check
```

`scripts/validate-node-field-elision-evidence.mjs` pins the schema, the host
platform, every document byte count, all eight variant digests, the per-field
and per-class splits against the node array, the ranking order, the
`semanticIdFromPrototypeId === 0` finding, determinism, the pipeline-digest
cross-check, and the zero-mismatch round trip — and rejects machine-local paths
in the committed JSON.
