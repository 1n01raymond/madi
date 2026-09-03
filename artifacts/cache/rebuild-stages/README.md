# Changed-discipline rebuild: stage decomposition

Status: recorded gate 0 evidence for
[ADR-0019](../../../docs/adr/0019-document-artifact-transport.md). The record
breaks a one-document-changed rebuild of Digital Hub and sixty5 into the
adapter and compiler stages the ADR names, using the fresh-process,
predeclared-sample protocol of [`../sixty5/`](../sixty5/README.md), and it
closes the "Real-large reopen stage breakdown" evidence debt in
[PHASE_2](../../../docs/PHASE_2.md). Its job is to fix **where the time goes**
before any transport code is written; it is not a speed claim.

Two verdicts, both carried in the JSON and pinned by the validator:

- **The ADR's exploratory attribution did not reproduce.** ADR-0019's Context
  table came from one `--cpu-prof` run per model. Against this record's own
  spread, all nine comparable rows fall outside it on both models, most by
  1.3-2.6x. The ADR's Context is corrected from this record, as gate 0
  required ("or the Context of this ADR is corrected before slice 1").
- **The ADR's sizing still holds qualitatively.** The encoder is 2.3 percent
  (Digital Hub) and 2.5 percent (sixty5) of a rebuild, and the
  adapter-compiler transport of the *unchanged* documents -- artifact
  verification and load, federation property index and merge, Scene IR
  writes, structure re-scan -- is 48.0 percent of a Digital Hub rebuild and
  77.3 percent of a sixty5 rebuild. Re-extracting the *changed* document is
  39.4 percent on Digital Hub and 7.5 percent on sixty5.

One record per model: [`digital-hub.json`](digital-hub.json) (four-document
`ifc-bench-digital-hub`, MIT; changed discipline `architecture`) and
[`sixty5.json`](sixty5.json) (seven-document, 839.9 MB `ifc-bench-sixty5`,
CC BY 4.0; changed discipline `structure`), both from
`fixtures/external/manifest.json`. Schema `naru.rebuild-stage-evidence.1`,
mode `fresh-process-changed-discipline-stage-decomposition`. Validator:
`pnpm cache:stages:check`. Re-record: `pnpm cache:stages:evidence --
--model digital-hub` and `-- --model sixty5`, with `NARU_IFC_PYTHON` pointing
at the IfcOpenShell interpreter (the sixty5 warm-up is a cold seven-document
extraction that took 476.4 s and peaked at 5.12 GB; each sample then takes
about two minutes).

## Protocol, fixed before any result was read

**One fresh `node scripts/lib/ifc-cache-sample.mjs` process per sample**, and a
fresh Python adapter process inside it. Compile options are the ADR-0018
record's: `--cache`, `--spatial-index`, `--relocate-hierarchy-nodes`,
`--threads 6`, and `--compact-json` on sixty5 only. `--payload-cache` was not
used (the flag has since been removed).

**Cache state.** A warm-up extracts the *original* federation once, adapter
only, so every document artifact is warm; the record asserts that warm-up saw
zero hits and one miss per document. Before every sample the package cache
entries and the changed document's artifact are deleted and the unchanged
documents' artifacts are kept. Each sample therefore restores every unchanged
document from its verified artifact, re-extracts the changed one, and misses
the package cache -- the rebuild ADR-0019 is about.

**The edit** is the ADR-0018 record's: one `IfcExtrudedAreaSolid` depth
(Digital Hub `#823` in `arc.ifc`, 7.77 -> 9.77; sixty5 `#890` in `str.ifc`,
250 -> 350), same byte length, different `scene.bin` and package digest. The
edited copy lives under `output/`; the record carries its SHA-256 beside the
fixture's.

**Timing never touches a package byte.** The adapter writes its stages to a
separate ledger only when `--stage-timing <path>` is given
(`naru.ifc-adapter-stage-timing.1`); the compiler exposes its stages on the
result only when `compileIfcFederation` is called with `stageTiming: true`
(`naru.ifc-federation-stage-timing.1`). Neither enters `adapter-report.json`,
`build-report.json`, a cache key, or the package, and every sample's package
digest must equal the first sample's -- it did, five of five on both models
(Digital Hub `c4b151e5…`, sixty5 `05707534…`; both host-local, see below).

**Sample validity** was predeclared: exit 0, package cache miss, artifact hits
exactly the unchanged documents and the miss exactly the changed one, no
warning, ledger present, package digest equal to the first sample's. Up to
three attempts per index, every discarded attempt recorded. **Five valid
samples per model, zero discarded.** Statistics are median, nearest-rank p95,
minimum, and maximum. Peak memory is the OS-sampled Windows process tree.

**Closure.** Every sample must close: compiler stages plus the unattributed
remainder equal the total; the four `compile` sub-stages sum to `compile`;
the structure read fits inside `readSceneIr`; the adapter process phases fit
inside the compiler's `adapter` stage; the adapter ledger's document,
federation, and write times fit inside its `main`. All ten checks held on all
ten samples; the unattributed remainder is 20.9 ms (Digital Hub) and 97.0 ms
(sixty5) of wall time.

## Where the time goes (medians over five samples, ms)

Whole rebuild, compiler process:

| | Digital Hub | sixty5 |
|---|---:|---:|
| Whole process (`processMilliseconds`) | 19,872.9 [19,746.3-21,036.6] | 126,458.5 [123,937.1-133,037.9] |
| `compileIfcFederation` total | 19,763.6 | 126,149.8 |
| of which waiting on the adapter subprocess | 15,519.6 (78.5%) | 79,106.6 (62.7%) |
| of which in-process compiler work | 4,346.1 (22.0%) | 46,582.0 (36.9%) |
| Peak process-tree working set | 571,133,952 B | 3,311,804,416 B |

Compiler stages, in execution order:

| Stage | Digital Hub | sixty5 |
|---|---:|---:|
| `inspectSources` | 46.1 | 474.7 |
| `toolchainIdentity` (content-hash the compiler + adapter) | 459.4 | 460.4 |
| `cacheLookup` | 0.4 | 0.4 |
| `adapter` (spawn to close) | 15,519.6 | 79,106.6 |
| `readSceneIr`, of which the structure stream scan | 2,314.7 / 2,305.9 | 30,263.8 / 30,215.2 |
| `hydrate` | 10.2 | 61.4 |
| `compile` (`compileSceneToGltf`) | 1,065.6 | 10,830.6 |
| - `validateScene` | 127.7 | 1,433.3 |
| - `encodeGeometry` (`buildCompiledPayload`, every prototype) | 451.5 | 3,183.7 |
| - `measureDocument` (stream the glTF once for digest and size) | 222.3 | 2,437.2 |
| - other (layout, node and mesh assembly) | 269.7 | 3,808.8 |
| `validateCompiled` | 15.4 | 148.8 |
| `dependencyIndex` | 43.9 | 1,027.6 |
| `writePackage` | 210.7 | 2,388.2 |
| `writeDependencyIndex` | 9.7 | 139.0 |
| `cachePublish` | 79.6 | 719.8 |
| unattributed (between stage timers) | 20.9 | 97.0 |

Adapter process, from the `--stage-timing` ledger:

| Stage | Digital Hub | sixty5 |
|---|---:|---:|
| spawn to module start | 74.6 | 80.4 |
| imports (IfcOpenShell, numpy) | 261.3 | 270.2 |
| `main` | 15,076.8 | 77,997.6 |
| - changed document: extract | 5,801.0 | 6,396.7 |
| - changed document: publish artifact | 1,987.4 | 3,077.5 |
| - unchanged documents: load artifacts (gzip + json) | 899.3 | 8,310.4 |
| - unchanged documents: verify artifacts (canonical re-serialize + SHA-256) | 4,434.2 | 34,204.2 |
| - unchanged documents: restore into the federation | 2.0 | 27.5 |
| - federation merge | 6.9 | 112.1 |
| - federation property index | 615.7 | 11,666.2 |
| - write structure (`scene-ir.json`) | 837.2 | 10,586.1 |
| - write geometry / properties / digest / report | 309.9 / 11.4 / 62.6 / 1.8 | 1,806.1 / 159.1 / 410.5 / 2.3 |
| - unattributed inside `main` | 67.8 | 195.6 |
| finish to process close | 106.1 | 785.1 |

Unchanged artifacts verified per sample: Digital Hub three files, 14,018,011 B
gzipped; sixty5 six files, 101,185,491 B. Per-document rows (load, verify,
bytes, source size) are in each JSON under `distributions.adapterDocuments`.

Grouped the way ADR-0019 argues:

| Bucket | Digital Hub | sixty5 |
|---|---:|---:|
| Transport of unchanged documents (verify + load + property index + merge + adapter writes + structure re-scan) | 9,485 (48.0%) | 97,472 (77.3%) |
| Re-extracting and publishing the changed document | 7,788 (39.4%) | 9,474 (7.5%) |
| Encoder (`encodeGeometry`) | 452 (2.3%) | 3,184 (2.5%) |
| Everything else (identity, hydrate, validate, layout, package write, cache publish, process start/close) | 2,039 (10.3%) | 16,020 (12.7%) |

## Exploratory attribution: not reproduced

`exploratoryAttribution` compares the nine ADR-0019 Context rows that have a
wall-clock counterpart against this record's minimum-maximum spread. The rule
was predeclared: a row reproduces when the exploratory number lies inside the
spread.

| ADR-0019 Context row | Measured as | Digital Hub: exploratory / median [spread] | sixty5 |
|---|---|---:|---:|
| Compile wall time | `totalMilliseconds` | 10,140 / 19,763.6 [19,627.1-20,922.3] | 99,851 / 126,149.8 [123,647.7-132,743.9] |
| Idle, waiting for the adapter | `stages.adapter` | 6,988 / 15,519.6 | 62,787 / 79,106.6 |
| In-process compiler work | total - adapter | 3,195 / 4,346.1 | 37,109 / 46,582.0 |
| Structure stream scan | `structureReadMilliseconds` | ~1,240 / 2,305.9 | ~15,100 / 30,215.2 |
| `compileSceneToGltf` | `stages.compile` | 780 / 1,065.6 | 6,849 / 10,830.6 |
| `buildCompiledPayload` | `compileStages.encodeGeometry` | 236 / 451.5 | 1,229 / 3,183.7 |
| Document streaming | `compileStages.measureDocument` | 298 / 222.3 | 2,950 / 2,437.2 |
| `writeCompiledPackage` | `stages.writePackage` | 139 / 210.7 | 1,392 / 2,388.2 |
| `validateScene` | `compileStages.validateScene` | 92 / 127.7 | 1,018 / 1,433.3 |

Nine of nine rows are outside the spread on both models; the garbage-collector
row has no wall-clock stage and is reported, not compared. Three reasons, none
of which the record can separate:

- **Different quantities.** The probe summed CPU-profile self or inclusive
  time per frame; the ledger measures wall-clock time between stage
  boundaries, which includes I/O waits, worker joins, and garbage collection
  that the profiler attributed to its own category (744 ms and 11,347 ms).
- **Host load, uncontrolled.** The protocol declares other processes on the
  host uncontrolled. At the Digital Hub recording, the host carried about
  44 percent CPU load from foreground applications and a cloud-sync client
  that were not closed; sixty5 was not sampled. Every stage, adapter and
  compiler alike, is 1.2-1.4x its counterpart in the six-day-older
  [ADR-0018 record](../payload-reuse/README.md), whose clean-rebuild medians
  were 15,673.5 ms (Digital Hub) and 95,126.1 ms (sixty5) on this host under
  the same options; a uniform factor across two runtimes points at the host,
  not the instrumentation, but that is an inference.
- **Instrumentation.** Stage timers are `performance.now()` /
  `time.perf_counter()` calls at stage boundaries, and their cost is bounded
  by the unattributed remainder (20.9 and 97.0 ms).

What gate 0 fixes is therefore the **shape** of the rebuild -- which stages
own which share -- not an absolute baseline. Gate 4 is measured, as ADR-0018's
was, against a clean rebuild recorded in the same session as the transport
run, never against this record's absolutes.

## What the record settles for the later gates

- **Gate 3 baseline.** Today an unchanged artifact is verified by re-serializing
  its parsed payload canonically and hashing that text: 4,434.2 ms for
  14,018,011 B (Digital Hub) and 34,204.2 ms for 101,185,491 B (sixty5), 29
  and 44 percent of the adapter's `main`. Gate 3 requires one read and one hash
  of the stored bytes instead; the ADR's exploratory probe put that at 0.24 s
  and 1.50 s, a planned figure this record does not measure.
- **Slice 2 and 3 baselines.** The structure re-scan (2,305.9 / 30,215.2 ms),
  the adapter's structure write (837.2 / 10,586.1 ms), and the federation
  property index (615.7 / 11,666.2 ms) are the costs a column-form structure
  and in-compiler federation assembly must remove or move.
- **Not a lever.** The encoder at 2.3-2.5 percent confirms why the rejected
  ADR-0018 tier had no room to win, and the changed-document extraction
  (5.8 / 6.4 s) is the floor no transport change reaches.

## Caveats carried in the JSON

- Package digests are host-local: this host's IFC adapter split differs from
  the macOS records by a few bytes ([PHASE_2](../../../docs/PHASE_2.md)), and
  the validator comment says not to retarget them.
- `peakWorkingSetBytes` is the sampled process tree; the adapter's worker
  processes are included, GPU memory is not involved.
- Timings are from one Windows host (Ryzen 7 9800X3D, 16 CPUs, 32 GB, Node
  22.14.0, IfcOpenShell 0.8.5, Python 3.13.2) under uncontrolled foreground
  load, as stated above.

## Files

- [`digital-hub.json`](digital-hub.json), [`sixty5.json`](sixty5.json) -- the
  records: fixture identity and edit, warm-up, five samples with full stage
  ledgers, closure checks, distributions, and the attribution verdict.
- [`record-rebuild-stage-evidence.mjs`](../../../scripts/record-rebuild-stage-evidence.mjs)
  (recorder) and
  [`validate-rebuild-stage-evidence.mjs`](../../../scripts/validate-rebuild-stage-evidence.mjs)
  (validator, `pnpm cache:stages:check`, in `pnpm check`).
- Adapter timing: `extract_federation_scene_ir.py --stage-timing`
  ([adapter README](../../../native/adapter-ifc/README.md)); compiler timing:
  `stageTiming: true` on `compileIfcFederation`
  ([compiler README](../../../packages/compiler/README.md)).
