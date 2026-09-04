# One document's assembly tree, published before that document is tessellated

Status: recorded evidence for
[ADR-0021](../../../docs/adr/0021-staged-hierarchy-first-import.md) gate 1.
Schema `naru.structure-first-emission.1`, mode
`fresh-process-staged-adapter-emission`. One record per model:
[`digital-hub.json`](digital-hub.json) (four documents, IFC4) and
[`sixty5.json`](sixty5.json) (seven documents, IFC2X3).

Gate 0 ([`../structure-readiness/`](../structure-readiness/README.md)) priced an
assembly tree without building the machinery: it read each document, walked its
spatial containment, and threw the result away. This record measures the
shipping adapter actually doing it. With `--structure-preview <directory>` the
IFC adapter writes one document's tree to disk before it tessellates that
document, in ascending source-size order, and this recorder watches the
directory from the outside -- verifying each tree's stored bytes against the
index at the moment it appears, rather than trusting the adapter's own account
of what it wrote.

Two arms run interleaved, five samples each after a discarded warm-up: `staged`
passes `--structure-preview`, `plain` is the same adapter over the same
documents at the same thread count without it. Both arms' outputs are compared
byte for byte, so the record can say what staging costs as well as what it
delivers.

Recorded by `pnpm structure:first-emission:evidence --model <id>`; validated by
`pnpm structure:first-emission:check`.

## What the numbers say

Medians over five fresh-process samples per arm, one warm-up discarded before
them and none discarded after (Windows 11, Ryzen 7 9800X3D, 16 logical CPUs,
IfcOpenShell 0.8.5, six threads, commit `1c3f39e`).

| | Digital Hub | sixty5 |
|---|---:|---:|
| Documents / source bytes | 4 / 67,829,367 B | 7 / 839,866,782 B |
| **First tree on disk** | **0.753 s** | **0.690 s** |
| Its document / nodes | architecture / 1,027 | facade / 1,076 |
| Last tree on disk | 24.845 s | 226.638 s |
| Whole staged run | 50.282 s | 311.406 s |
| Same run without staging | 50.378 s | 289.014 s |
| Trees written | 1,732,203 B | 25,618,528 B |
| Time spent writing them | 27.9 ms | 201.9 ms |
| Peak working set, staged vs plain | 1.74 GB vs 1.67 GB | 5.87 GB vs 4.70 GB |

Five readings follow.

**Structure genuinely precedes tessellation.** Every document in every staged
sample published its tree before its own extraction finished, on both
federations. The margin is not marginal: Digital Hub's slowest tree was ready
1,196.3 ms into its document (heating), against a
13,480.0 ms median extraction of that same document, and sixty5's was
23,580.7 ms against 85,186.0 ms (architecture). The two numbers are measured from deliberately different
origins -- readiness from the moment the adapter starts the document, including
reading its bytes, and extraction from after that read -- so the comparison is
conservative in the direction that matters: the true margin is larger than the
one recorded, never smaller.

**The first tree meets the product target; the whole federation does not.**
Digital Hub's first tree lands 0.753 s after process spawn and sixty5's
0.690 s, both far inside issue #73's 5-15 s band, and both measured
from spawn so interpreter start and imports are charged to the number. The last
tree is a different story: 24.845 s on Digital Hub and 226.638 s on
sixty5, because documents are inspected one after another and document N's tree
waits behind N-1 tessellations. Publishing every tree first would need a
structure-only pass over the federation, which gate 0 measured at
2.456 s and 40.475 s. ADR-0021 chose the per-document
unit, so this record measures what that choice delivers and leaves the
alternative priced rather than taken. The record states both verdicts
(`firstTreeWithinUpperBound`, `wholeFederationWithinUpperBound`) and the
validator pins them, so a re-record that flips either is reviewed rather than
absorbed.

**Staging moves no bytes.** The staged and plain arms produce byte-identical
`scene-ir.json`, `scene-ir-geometry.bin`, `scene-ir-properties.bin`, and
`adapter-report.json` -- 36 comparisons on Digital Hub and 36 on sixty5, with no
excluded field, because the adapter report carries no timestamp and no machine
path. That is the claim worth checking here, because staging deliberately runs
two different orders in one process: trees are published smallest source first,
while the Scene IR is assembled in the discipline order `parse_inputs` returns.
The identity above is the evidence that the second order did not move. It is not
yet ADR-0021's gate 2, which asks for an identical *package* digest with staging
on and off; it is the adapter-level half of the same claim.

**Staging costs sixty5 a quarter of its peak memory, and the reordering is
why.** Digital Hub is unaffected -- -96.6 ms, 0.19% faster, peak +0.06 GB
(+3.8%) -- but sixty5's staged arm runs +22,391.4 ms, 7.75% slower and peaks
+1.17 GB (+24.8%) higher, in every paired sample. Writing the trees is not the
cost: the adapter spends 201.9 ms doing that. Running the same adapter over
sixty5's largest document *alone*, staged against plain, costs +0.3% time and no
measurable memory -- with one document there is no order to change (exploratory
single-document probe on this host, two pairs, not committed evidence). What
changes at federation scale is which document is inspected when.
`--structure-preview` inspects in ascending source size, so sixty5's 342 MB
`architecture` document is processed last, with six documents' Scene IR already
accumulated, instead of first into an empty accumulator. The per-document
extraction medians in the record track exactly that, seven documents out of
seven: every document that moved later got slower (`architecture` +21.2%,
`plumbing` +12.0%, `electrical` +11.8%) and every document that moved earlier
got faster (`kitchen` -8.7%, `facade` -8.0%, `structure` -4.0%, `ventilation`
-1.9%). Digital Hub's documents move by at most two places and its deltas stay
inside +-3.3%, which is why it shows nothing. ADR-0021's negative consequences
predicted both the memory profile and the two-orders risk; this record prices
them. The obvious alternative -- publish every tree in a structure-only pass
first, then tessellate in discipline order -- would keep the plain arm's peak
but add gate 0's 40.475 s to the run, which is more time than staging costs.

**A preview node is a node the finished package draws.** Each document's tree
carries every occurrence its Scene IR carries -- pinned per document as
`nodeCountMatchesSceneIr`, against the occurrence count in the same run's
adapter report. That is a different tree from the one gate 0 walked, which
counted spatial-containment participants only: 783 against
1,027 on Digital Hub's architecture document. Both numbers are in
the record, side by side, because the difference is a design fact rather than a
discrepancy -- a preview exists to be the hierarchy the viewer will keep, so it
carries what the package carries.

## How a tree is published, and how this record checks it

The adapter writes each tree to a temporary file in the target directory,
flushes it, fsyncs it, and renames it into place, then rewrites the index so the
index names only files that are already complete. The recorder polls the index
every 25 ms, and for each newly named tree reads the file back and
verifies its length and SHA-256 against the index entry before counting it. A
read that loses the race with the rename is retried on the next tick and counted
as a contended read -- expected on Windows, and harmless. A read that succeeds
and does not match the index would refute the atomic-publish claim, so it aborts
the recording rather than being counted.

The race runs the other way too, and the first sixty5 recording found it:
Windows refuses `os.replace` while any other process holds the destination
open, so a reader polling the index killed the adapter that was writing it. A
watcher deciding whether an import survives is a defect in the writer, not in
the watcher, so the adapter now retries a refused rename for two seconds before
treating the failure as real. Publication stays atomic -- a rename either
happened or did not -- and a rename that never succeeds inside the budget still
raises. The record below was made after that fix, on both models, from one
commit.

Because publication is observed from outside the process, every
`observedMilliseconds` is accurate to the poll interval and no better, and it
includes the recorder's own read-and-verify. The adapter's internal
`structureReadyMilliseconds` is recorded beside it for the same document, so the
two clocks can be compared rather than conflated.

## Reproduce

```bash
pnpm structure:first-emission:evidence --model digital-hub
pnpm structure:first-emission:evidence --model sixty5
pnpm structure:first-emission:check
```

Both need the external fixtures already extracted and `NARU_IFC_PYTHON` pointing
at an interpreter with IfcOpenShell 0.8.5. A Digital Hub recording is eleven
adapter runs and takes about ten minutes; sixty5 is eleven runs of roughly five
minutes each. The recorder writes its scratch output under the gitignored
`output/` directory and never commits an intermediate.

The digests in the validator are **host-local**. This host's IFC adapter writes
a `scene-ir.json` that differs from the macOS records' by a few bytes -- the
divergence already recorded for the Digital Hub localized trace -- so a
re-record on another machine will not reproduce them. They must be re-measured
deliberately, never silently retargeted to make a run pass.

## What this record does not establish

- **No viewer is in this path.** Transport, parse, and draw are ADR-0021 gate 4.
  This record stops at a verified tree on disk.
- **No package.** The staged trees are adapter output, not a package resource;
  the staged package and its verified atomic publication are gate 2's subject,
  and gate 3 owns what a cancelled staged import leaves behind.
- **No coarse geometry.** Gate 5 owns that, and ADR-0021 states plainly that it
  is unmeasured until then.
- **Sequential inspection only.** Documents are inspected one at a time inside
  the adapter; a threaded federation read is not measured here, and gate 0
  already showed that threading cannot bring sixty5's whole tree inside the
  band.
- **One host, one toolchain.** Windows 11, IfcOpenShell 0.8.5, six threads.
