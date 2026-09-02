# Content-addressed payload reuse: changed-discipline rebuilds

Status: recorded acceptance evidence for
[ADR-0018](../../../docs/adr/0018-content-addressed-compiled-payloads.md)
gates 1, 2, and 4, and for the partial-rebuild half of
[ADR-0010](../../../docs/adr/0010-ifc-incremental-dependency-index.md). The
record answers two questions the unit tests could not: does a store-enabled
rebuild of a federation with one edited discipline reproduce every byte of a
clean compile, and does restoring verified payloads cost less than encoding
them again. **The first answer is yes on both models. The second is no on both
models**, and ADR-0018 predeclared that this outcome rejects the decision
rather than accepting it (see "Verdict" below).

One record per model: [`digital-hub.json`](digital-hub.json) (four-document
`ifc-bench-digital-hub`, MIT) and [`sixty5.json`](sixty5.json) (seven-document,
839.9 MB `ifc-bench-sixty5`, CC BY 4.0), both from
`fixtures/external/manifest.json`. Schema `naru.payload-reuse-evidence.1`,
mode `fresh-process-changed-discipline-rebuild`. Validator:
`pnpm cache:payload:check`. Re-record: `pnpm cache:payload:evidence --
--model digital-hub` and `-- --model sixty5 --samples 3` (a sixty5 sample
extracts one 400 MB document and writes a 650 MB package, so the whole run
takes over an hour and peaks near 5 GB).

## Protocol, fixed before any result was read

**One fresh `node` process per sample**; the recorder never compiles
in-process. Every sample compiles into its own output directory, which is
hashed in full and then deleted. Both compilers run with `--cache`,
`--spatial-index`, `--relocate-hierarchy-nodes`, and `--threads 6`; sixty5 adds
`--compact-json` because its pretty-printed document exceeds V8's maximum
string length ([record](../sixty5/README.md)).

**The edit.** One `IfcExtrudedAreaSolid` depth in one discipline is changed
(Digital Hub: `#823` in `arc.ifc`, 7.77 -> 9.77; sixty5: `#890` in `str.ifc`,
250 -> 350), which keeps the byte length and changes `scene.bin`, the package
digest, and most other resources. The edited document is compiled from a copy
under `output/`; the record carries its SHA-256 beside the fixture's.

**Oracles** are clean compiles with the store disabled, one per document set.
A store-enabled scenario passes only if every resource it writes is
byte-identical to its oracle, except `adapter-report.json` and
`build-report.json`, which are compared as JSON after removing exactly two
telemetry fields: `adapter-report.json:documentArtifactCache` and
`build-report.json:compiledPayloadCache`. That exclusion list is closed and is
written into the record.

**Cache state.** The compiled-package cache and the adapter document-artifact
cache share the `--cache` directory. Before every store-enabled scenario the
compiled-package entry for that document set is removed, so extraction stays
warm while packaging has to run; a compile that hit the package cache would
skip packaging entirely and is rejected. The payload store starts empty, is
filled by `store-cold-original`, and then carries the unchanged documents'
payloads into the changed scenarios.

**Scenarios**, in the order run (Digital Hub runs all ten; sixty5 runs the
first six):

| Scenario | Documents | Store | Oracle | Expected payload decisions |
|---|---|---|---|---|
| `clean-original` | original | off | itself | none |
| `store-cold-original` | original | empty | `clean-original` | every payload absent and published |
| `store-warm-original` | original | full | `clean-original` | every payload restored |
| `clean-changed` | one edited | off | itself | none |
| `store-warm-changed` | one edited | unchanged documents' payloads | `clean-changed` | other documents restored, edited document rebuilt and published |
| `store-corrupt-entry-changed` | one edited | one entry's `payload.bin` first byte flipped | `clean-changed` | one corrupt entry -> warn, rebuild, refuse to republish |
| `clean-relabelled` | original, edited document relabelled back | off | itself | none |
| `store-warm-relabelled` | same | full | `clean-relabelled` | every payload restored |
| `clean-deleted` | edited discipline removed | off | itself | none |
| `store-warm-deleted` | same | full | `clean-deleted` | every remaining payload restored |

A scenario whose decisions, warnings, or bytes differ from the expectation is a
gate failure and is recorded as such; scenario samples are never re-run.

**Gate 4 timing.** The compiler reports no stage timing, so packaging time is
derived by difference: `packagingMilliseconds = compileMilliseconds - median
adapterMilliseconds` of extraction-only samples taken in the same cache state.
Before every timing sample the changed document's artifact, the changed
package entry, and the store entries the changed rebuild published are
removed, so clean, store-warm, and extraction-only samples all start from
exactly one document to extract, a whole package to write, and a store that
holds only the unchanged documents' payloads. Samples interleave clean, warm,
extraction per iteration. The store-warm sample pays its own restore,
verification, and publication inside that time, so a lower median already nets
the store's cost. Gate 4 is met only if the warm packaging median is lower than
the clean one **and** the warm peak process-tree working set is no higher.
A timing sample whose process fails, whose cache state is wrong, whose output
differs from the oracle, or whose decisions differ from the pinned scenario is
recorded in `discardedSamples` and re-run, at most three attempts. **Neither
recording discarded a sample.**

`median` is the middle sorted value; `p95` is the nearest-rank observed p95,
the `ceil(0.95 x n)`-th sorted value. Peak memory is
`os-sampled-win32-process-tree`: `Win32_Process WorkingSetSize` summed over the
tree rooted at the sample process every 500 ms, so the native adapter is
included; the summed per-process `PeakWorkingSetSize` is reported beside it as
an upper bound. Uncontrolled and stated in the record: the operating-system
file cache is not cleared between samples, and the sampler's PowerShell process
is not excluded from the host's load.

## Digital Hub

Host: Windows x64, Ryzen 7 9800X3D (16 threads), 33.5 GB RAM, Node 22.14.0,
IfcOpenShell 0.8.5 / numpy 2.5.2 / Python 3.13.2. Five samples per timing
state; 3,405 prototypes, 3,383 of them carrying a payload; 726 belong to the
edited `architecture` document and none is shared with another document.

**Gates 1 and 2 are met.** All 16 comparisons — the six store scenarios plus
five clean-changed and five store-warm-changed timing samples — are
byte-identical to their oracle across all eleven package resources
(`scene.gltf`, `scene.bin`, `coarse.bin`, `spatial.bin`, `properties.json`,
`properties.bin`, `hierarchy.json`, `hierarchy.bin`,
`incremental-dependencies.json`, and the two reports after removing the two
excluded fields), and every scenario reported exactly the decisions the
protocol expected:

| Scenario | Hits | Misses | Published | Outcomes | Package digest |
|---|---:|---:|---:|---|---|
| `store-cold-original` | 0 | 3,383 | 3,383 | 3,383 absent | = `clean-original` |
| `store-warm-original` | 3,383 | 0 | 0 | 3,383 hit | = `clean-original` |
| `store-warm-changed` | 2,664 | 719 | 719 | 2,664 hit, 719 absent | = `clean-changed` |
| `store-corrupt-entry-changed` | 3,382 | 1 | 0 | 3,382 hit, 1 corrupt-entry; 1 publish refused | = `clean-changed` |
| `store-warm-relabelled` | 3,383 | 0 | 0 | 3,383 hit | = `clean-relabelled` (= `clean-original`) |
| `store-warm-deleted` | 2,507 | 0 | 0 | 2,507 hit | = `clean-deleted` |

The corrupt scenario carries the two warnings the contract requires (restore
failed -> rebuilding; publish failed -> compiled output kept without an entry),
and the entry stays visibly broken. The store holds 3,383 entries / 45,901,669
B after the original compile and 4,102 / 51,776,549 B after the changed
rebuild. Oracle package digests on this host: `clean-original`
`ef31b9c6…`, `clean-changed` `c4b151e5…`, `clean-deleted` `c9b15c51…`;
`clean-relabelled` reproduces `clean-original` exactly.

**Gate 4 is not met.** The store-warm rebuild is slower than the clean one:

| Series (5 samples) | Compile median | Packaging median (compile - extraction) | Peak process tree median |
|---|---:|---:|---:|
| extraction only (changed document) | 12,488.6 ms adapter | — | 0.55 GB |
| clean rebuild, store off | 15,673.5 ms | **3,184.9 ms** | 559,427,584 B |
| store-warm rebuild, 2,664 restored + 719 published | 20,073.6 ms | **7,585.0 ms** | 561,070,080 B |

Saving -4,400.1 ms, ratio 0.42x; peak memory 1.6 MB higher. Both criteria
fail. The store scenarios say the same thing without the subtraction:
`store-warm-original`, which restores every payload and publishes none, took
14.6 s of compile time against 17.1 s for the clean changed rebuild only
because the clean run also extracted a document; run for run, restoring is not
cheaper than encoding.

Why, established with exploratory probes during the recording (fresh
processes, every document artifact warm, package entry evicted; **not part of
the validated JSON**): a clean packaging run took 9.6 s; a full store with
3,383 hits and nothing to publish took 12.0 s; the recorded state with 2,664
hits and 719 publications took 12.8 s; deleting the 719 entries minutes before
instead of immediately before made no difference; and moving the store off
OneDrive to a plain local directory made none either (13.1-13.2 s). Restoring
a payload reads its manifest and binary and verifies the SHA-256 of every
byte, while building it from the already-parsed Scene IR is a typed-array copy
— the expensive work, tessellation, already lives in the adapter's
document-artifact cache, which every store scenario here hit. Verification is
therefore the whole cost, and publication (a temporary directory, two writes,
and a rename per prototype) adds to it.

**The edited document reuses nothing, by construction.** The adapter derives
every prototype id from a document token
`<discipline>-<sourceDigest[:12]>`, and the payload content digest hashes the
representation id because the accessor names it restores embed that id.
Editing one entity therefore renamed all 726 of the document's prototypes: 719
payload-bearing prototypes missed, zero were retained from the original index
(`changedDocumentPrototypeIdsRetainedFromOriginal: 0`), and reuse came only
from the three untouched documents. Content-derived prototype ids, or accessor
names that do not embed the id, would be a separate design change; this record
measures the contract as it stands.

## sixty5

Same host. Three samples per timing state, `--compact-json` (the default
pretty document exceeds the runtime's maximum string length at this size), six
scenarios (the relabelled and deleted scenarios are Digital Hub only; a sixty5
cold compile costs 420 s and 5.09 GB). Edited document: `structure`
(`str.ifc`, 7,422,441 B), extrusion depth of `#890` 250 -> 350. 42,469
prototypes, 42,435 with a payload; 2,374 belong to the edited document, none
shared with another document.

**Gates 1 and 2 are met.** All 10 comparisons — four store scenarios plus three
clean-changed / store-warm-changed timing pairs — are byte-identical to their
oracle across the same eleven resources, with the same two report exclusions,
and every decision was exact:

| Scenario | Hits | Misses | Published | Outcomes | Compile | Peak tree |
|---|---:|---:|---:|---|---:|---:|
| `clean-original` | — | — | — | store off | 419.9 s | 5.09 GB |
| `store-cold-original` | 0 | 42,435 | 42,435 | 42,435 absent | 207.2 s | 3.28 GB |
| `store-warm-original` | 42,435 | 0 | 0 | 42,435 hit | 133.8 s | 3.30 GB |
| `clean-changed` | — | — | — | store off | 97.3 s | 3.31 GB |
| `store-warm-changed` | 40,066 | 2,369 | 2,369 | 40,066 hit, 2,369 absent | 132.3 s | 3.29 GB |
| `store-corrupt-entry-changed` | 42,434 | 1 | 0 | 42,434 hit, 1 corrupt-entry; 1 publish refused | 130.4 s | 3.28 GB |

Store: 42,435 entries / 295,516,576 B after the original compile, 44,804 /
307,750,238 B after the changed rebuild. Oracles on this host: `clean-original`
`dd6fa9a1…`, `clean-changed` `05707534…`. The scenarios after the first all
run with every document artifact warm, so `clean-changed` (one document
re-extracted, store off) is the number the store has to beat, and the two
store scenarios that restore 40,066 payloads are each 33-35 s slower than it.

**Gate 4 is not met**, more clearly than on Digital Hub:

| Series (3 samples) | Compile median | Packaging median (compile - extraction) | Peak process tree median |
|---|---:|---:|---:|
| extraction only (changed document) | 59,924.1 ms adapter | — | 3.28 GB |
| clean rebuild, store off | 95,126.1 ms | **35,202.0 ms** | 3,346,001,920 B |
| store-warm rebuild, 40,066 restored + 2,369 published | 137,637.6 ms | **77,713.5 ms** | 3,269,361,664 B |

Saving -42,511.5 ms, ratio 0.453x. Peak memory is 76.6 MB *lower* with the
store — the only criterion the record meets, and the reason the one-payload-
live-at-a-time design is kept regardless — but the packaging stage takes 2.2x
as long. Restoring 40,066 verified payloads (295 MB read and hashed) costs
more than encoding all 42,435 from the parsed Scene IR; on this model the
edited document is only 5.6% of the prototypes, so the store's share of the
work that could have been saved was as large as it will ever be.

## Verdict

ADR-0018 gate 4 predeclared: "If reuse does not beat re-encoding plus
verification, this decision is rejected rather than accepted." It did not, on
either model, in any sample. Gates 1, 2, and 3 pass — the store is correct and
byte-exact, and the changed-discipline rebuild reproduces the clean package —
but the thing it exists to buy, a cheaper rebuild, is not there: encoding a
prototype payload from an already-parsed Scene IR is cheaper than reading and
verifying it from disk, and the adapter's document-artifact cache already
removes the expensive tessellation from the rebuild path. ADR-0018 is
therefore **Rejected** by its own rule, and ADR-0010's partial-rebuild half
stays Proposed until a different reuse unit is designed (candidates the
record points at: reuse above the encoder — laid-out byte ranges, which
ADR-0018 deliberately excluded — or content-derived prototype ids so an
edited document keeps its untouched payloads). The `--payload-cache` flag
stays in the compiler, off by default, as the measured-and-rejected
experiment; removing it is a separate decision.

## Host-local digests

Every package digest in these records is host-local: this Windows host's IFC
adapter emits a split Scene IR that differs from the macOS records' by a few
bytes, so `clean-original` here is not the committed `artifacts/ifc/…` digest
for either model, and the validator says so in its header. Do not retarget a
pinned digest to make a re-record pass; a changed digest is a changed input or
toolchain and is reviewed as one. Nothing in the records is engineering data:
the fixtures are referenced by manifest id, digest, and byte length only.

Recorded 2026-09-02 (UTC) at commit `60d3242` plus the then-uncommitted
recorder and validator, Windows x64, AMD Ryzen 7 9800X3D (16 threads),
33.5 GB RAM, Node 22.14.0, IfcOpenShell 0.8.5, numpy 2.5.2, Python 3.13.2.
