# How early an IFC federation's assembly tree could be published

Status: recorded evidence for
[ADR-0021](../../../docs/adr/0021-staged-hierarchy-first-import.md) gate 0.
Schema `naru.structure-readiness.1`, mode
`fresh-process-structure-only-federation-read`. One record per model:
[`digital-hub.json`](digital-hub.json) (four documents, IFC4) and
[`sixty5.json`](sixty5.json) (seven documents, IFC2X3).

The staged-preview design rests on one number. A cold sixty5 import spends
282.5 s inside the adapter ([`../../cache/rebuild-stages/`](../../cache/rebuild-stages/README.md),
clean arm), almost all of it tessellating, and the product target for a usable
hierarchy is 5-15 s. Whether that target is reachable at all depends on how
much of the adapter's cost is parsing the STEP text -- which an assembly tree
needs -- and how much is geometry -- which it does not. This record separates
them by measuring the whole path to a publishable tree and nothing else: a raw
byte scan of the file, the IfcOpenShell parse, the spatial containment walk,
and JSON serialization of the resulting entry list.

Recorded by `pnpm structure:readiness:evidence --model <id>` over
[`../../../native/adapter-ifc/tools/measure_structure_readiness.py`](../../../native/adapter-ifc/tools/measure_structure_readiness.py);
validated by `pnpm structure:readiness:check`.

## What the numbers say

Medians over five fresh-process samples, one warm-up run discarded before
them, no sample discarded after (Windows 11, Ryzen 7 9800X3D, 16 logical CPUs,
IfcOpenShell 0.8.5, commit `a8f1457`).

| | Digital Hub | sixty5 |
|---|---:|---:|
| Documents / source bytes | 4 / 67,829,367 | 7 / 839,866,782 |
| Assembly entries / serialized bytes | 4,916 / 598,340 | 76,810 / 10,632,098 |
| Whole federation, read one document at a time | **2,455.9 ms** | **40,474.9 ms** |
| Estimated at six threads | 805.4 ms | 15,030.3 ms |
| First document ready | 315.0 ms (architecture) | 278.5 ms (facade) |
| Slowest single document | 805.4 ms (heating) | 15,030.3 ms (architecture) |
| Share of the cold adapter's time | 5.5% of 44,980.5 ms | 14.3% of 282,484.7 ms |
| Peak process-tree working set | 0.20 GB | 3.34 GB |

Two readings follow, and the design turns on both.

**Parsing is the whole cost.** Of sixty5's 40,474.9 ms, the IfcOpenShell parse
is 39,907.2 ms (98.6%), the containment walk 506.2 ms (1.3%), and serializing
the tree 32.2 ms (0.1%). Digital Hub splits the same way: 2,418.0 / 31.0 /
1.9 ms. A raw byte scan of the same files -- reading every byte and counting
spatial keywords, parsing nothing -- takes 554.2 ms for sixty5 and 49.3 ms for
Digital Hub, so the file is not I/O-bound at this scale; it is bound by
building an entity graph out of STEP text. Nothing in the path can be made
cheaper by walking less.

**A whole-federation tree cannot meet the target on sixty5, and no amount of
parallelism changes that.** One document -- architecture, 342.7 MB -- takes
15,030.3 ms on its own, which is the estimated six-thread makespan too: the
critical path is a single document, so threading the federation cannot beat
it. Digital Hub's whole tree lands in 2,455.9 ms and meets the target
comfortably. The record states all three verdicts (`sequential`, `threaded`,
`firstDocument`) per model and the validator pins them, so a re-record that
flips one is reviewed rather than absorbed.

What *is* reachable on sixty5 is a first document in 278.5 ms and disciplines
appearing as each finishes. That is the design ADR-0021 adopts, and the reason
it does.

## What this record does not measure

- **Transport to a viewer.** This is the adapter-side path to a serialized
  tree. Nothing here publishes a package, and the Studio is not involved, so
  the record can refute the 5-15 s target but cannot on its own establish it.
- **Properties and classification.** They are associated in a separate cold
  stage (`adapterFederation.propertyIndex`, 11,237.3 ms on sixty5) and are not
  part of the path measured here.
- **Geometry of any kind.** No representation is evaluated, so no bounds, no
  coarse frame, and no triangle count follow from these numbers.
- **A parallel run.** `estimatedThreadedMakespan` is a longest-processing-time
  schedule computed over the measured per-document durations. It is arithmetic
  on measurements, labelled as an estimate in the record and in its
  `makespanMethod` field, not a measured parallel read.
- **A cold page cache.** Samples run back to back without dropping the OS page
  cache, matching the protocol of [`../../cache/sixty5/`](../../cache/sixty5/README.md).

## Pins, and what may not be retargeted

Everything a structure-only read produces is a function of the file: entry
counts, root counts, relation counts, serialized payload bytes, and the raw
keyword counts are identical in every sample, and the validator pins them
exactly and asserts that identity. The timings are host-dependent and are
bounded rather than pinned, but the two ratios the design rests on are
enforced -- parsing at least 90% of the path, the walk at most 5% -- as are
the record's verdicts against the 5-15 s target, which is quoted from issue
#73 and may not be widened in the validator to turn a miss into a pass.

The source documents are verified against the pinned SHA-256 assets of
`fixtures/external/manifest.json` before any measurement runs; sixty5 is
CC BY 4.0 and Digital Hub MIT, and no source geometry is committed here.
