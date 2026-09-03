# Changed-discipline rebuild: transport through stored-byte artifacts vs clean

Status: recorded evidence for
[ADR-0019](../../../docs/adr/0019-document-artifact-transport.md) slice 1
(stored-byte document-artifact verification,
`naru.ifc-document-artifact.2`), measured against the ADR's gates 1-4. The
record compiles a one-document-changed federation of Digital Hub and sixty5
two ways in the same session -- **transport** (every unchanged document
restored from its verified artifact, the changed one re-extracted) and
**clean** (no cache directory at all: every document extracted, nothing looked
up, restored, or published) -- five fresh-process samples per arm, interleaved
per index, using the predeclared-sample protocol of
[`../sixty5/`](../sixty5/README.md). Schema `naru.rebuild-stage-evidence.2`,
mode `fresh-process-changed-discipline-transport-vs-clean-rebuild`.

The previous version of this record (`naru.rebuild-stage-evidence.1`, commit
`69d67e5`) was the ADR's gate 0: the same transport rebuild decomposed into
stages with no clean arm, which fixed the stage shares the ADR argues from and
recorded that the ADR's exploratory attribution did not reproduce. Those
verdicts are stated in the ADR; this version supersedes the file, not the
verdicts. Where this README quotes gate 0 numbers they come from that commit
and from another session, so they are reference only, never a same-session
comparison.

One record per model: [`digital-hub.json`](digital-hub.json) (four-document
`ifc-bench-digital-hub`, MIT; changed discipline `architecture`) and
[`sixty5.json`](sixty5.json) (seven-document, 839.9 MB `ifc-bench-sixty5`,
CC BY 4.0; changed discipline `structure`), both from
`fixtures/external/manifest.json`. Validator: `pnpm cache:stages:check`.
Re-record: `pnpm cache:stages:evidence -- --model digital-hub` and
`-- --model sixty5`, with `NARU_IFC_PYTHON` pointing at the IfcOpenShell
interpreter. The warm-up is a cold extraction of the original federation
(Digital Hub 58.1 s, sixty5 317.0 s); each sample pair then costs
one transport rebuild plus one clean rebuild.

## Verdicts, pinned by the validator

| Gate | Digital Hub | sixty5 |
|---|---|---|
| 1 byte identity | Met: 10 of 11 package files identical, `adapter-report.json` identical outside the one excluded key; package digest `c4b151e5…` in both arms | Met: 10 of 11 package files identical, `adapter-report.json` identical outside the one excluded key; package digest `05707534…` in both arms |
| 2 exact decisions | Met: hits `heating`, `plumbing`, `ventilation`; miss `architecture`; ledger states `verified` ×3, `absent` ×1, identical in all five samples | Met: hits `architecture`, `electrical`, `facade`, `kitchen`, `plumbing`, `ventilation`; miss `structure`; ledger states `verified` ×6, `absent` ×1, identical in all five samples |
| 3 restore cost | Met: adapter load+verify 201.6 ms vs 143.8 ms in-recorder read+gunzip+hash reference, ratio 1.402 (bound 2×) | Met: adapter load+verify 1,665.1 ms vs 1,256.0 ms in-recorder read+gunzip+hash reference, ratio 1.326 (bound 2×) |
| 4 faster than clean, memory no higher | Met: 11,102.2 ms vs 50,028.4 ms whole process (saving 38,926.2 ms, required > 11,122.8); peak working set 0.64 GB vs 1.83 GB | Met: 72,993.4 ms vs 320,064.2 ms whole process (saving 247,070.8 ms, required > 26,603.7); peak working set 4.15 GB vs 5.08 GB |

The Digital Hub package digest is the one the `.1` record published for the
same edit, so the artifact format change moved no package byte.

## Protocol, fixed before any result was read

- **Process isolation.** Every sample and the warm-up is one fresh
  `node scripts/lib/ifc-cache-sample.mjs` process; the adapter is a fresh
  Python process inside it.
- **Cache state.** The warm-up extracts the original federation once
  (adapter only) so every document artifact is warm. Before each transport
  sample the package cache entries and the changed document's artifact are
  deleted; the unchanged documents' artifacts stay. Each transport sample
  therefore restores every unchanged document and re-extracts the changed
  one, and its package cache lookup is a miss. Each clean sample compiles the
  same changed federation with no cache directory.
- **Clean arm definition.** "Clean" means no cache directory: the document
  artifact tier under test and the whole-package cache are both disabled.
  This is the analogue of the ADR-0018 record's "no store" arm for the tier
  ADR-0019 introduces; a clean arm that still restored artifacts would
  measure the tier against itself.
- **Ordering.** Per index: reset, transport sample, then clean sample, so
  host drift over the session lands on both arms alike.
- **Change.** Digital Hub `architecture` `#823= IFCEXTRUDEDAREASOLID(...,7.77)`
  → `9.77` (referenced only by `#824`, an `IfcShapeRepresentation` body);
  sixty5 `structure` `#890= IFCEXTRUDEDAREASOLID(...,250.)` → `350.`, compiled
  with `--compact-json` as every sixty5 record is.
- **Timing.** Adapter stages come from `--stage-timing` (a separate ledger
  file, never the report); compiler stages from `stageTiming: true`. Neither
  touches a package byte: every transport sample's package digest must equal
  the first transport sample's, and every clean sample's the first clean
  sample's.
- **Sample validity.** A transport sample counts only when the process exits
  0, the package cache misses, the artifact hits are exactly the unchanged
  documents and the miss exactly the changed one, no warning is emitted, the
  ledger is present, and the digest matches. A clean sample counts only when
  the process exits 0, both caches report `disabled`, no warning is emitted,
  the ledger is present, and the digest matches. Up to three attempts per
  index and arm; every discarded attempt is recorded (none was discarded on
  either model). Byte identity across the arms is gate 1's verdict, never a
  validity rule.
- **Statistics.** Median, nearest-rank p95, minimum, maximum over the accepted
  samples of each arm. Peak memory is the OS-sampled Windows process tree.
- **Uncontrolled.** Other processes on the host, disk cache state between
  samples, CPU frequency scaling.

## Gate 1: byte identity

Every file the transport rebuild writes is compared with the file the clean
rebuild of the same index writes. The reports in the closed exclusion list --
exactly `adapter-report.json:documentArtifactCache`, the same single entry
the ADR-0018 record used, with no additions -- are compared as canonical JSON
after deleting the excluded key; everything else by SHA-256. Digital Hub:
`build-report.json`, `coarse.bin`, `hierarchy.bin`, `hierarchy.json`,
`incremental-dependencies.json`, `properties.bin`, `properties.json`,
`scene.bin`, `scene.gltf`, and `spatial.bin` identical in all five pairs,
`adapter-report.json` identical outside the excluded key, both arms' package
digest `c4b151e5f5d762e4f431c5f647aaec8a53a43d7bbf9737917e4874a1f022b3bb`.
sixty5: `adapter-report.json` identical-outside-excluded-keys, `build-report.json` identical, `coarse.bin` identical, `hierarchy.bin` identical, `hierarchy.json` identical, `incremental-dependencies.json` identical, `properties.bin` identical, `properties.json` identical, `scene.bin` identical, `scene.gltf` identical, `spatial.bin` identical, in all five pairs; package digest `05707534c73ce126da401a79481d0fd6c892bc308a451d6aa2a4b1691bc2439e` in both arms.

## Gate 2: exact decisions

Every accepted transport sample reports the unchanged documents as artifact
hits and the changed document as the only miss, and its ledger names each
unchanged artifact `verified` and the changed one `absent`; the record pins
that the decision block is identical across samples. The refusal paths --
corrupt, truncated, tampered payload, wrong key input, previous-schema (`.1`)
file at the same path -- each carry a named `artifactInvalidReason` and
re-extract, in
[`test_document_artifact_cache.py`](../../../native/adapter-ifc/tests/test_document_artifact_cache.py).

## Gate 3: restore bounded by one read and one hash

`naru.ifc-document-artifact.2` stores one gzip stream: a canonical-JSON header
line (`key`, `keyInput`, `payloadBytes`, `payloadSha256`, `schemaVersion`)
followed by exactly `payloadBytes` bytes of canonical payload. Verification
is the header checks plus one SHA-256 over those stored bytes; the parse
happens only afterwards and is ledgered separately
(`artifactParseMilliseconds`), so neither figure can hide a re-serialization.
The gate is operationalized as a ratio: the adapter's
`artifactLoadMilliseconds + artifactVerifyMilliseconds` over the unchanged
documents against the same read, gunzip, and SHA-256 of the same files
performed in the recorder process once per sample, met when the adapter
median is at most 2× the reference median.

| Unchanged documents, ms (median [min, max]) | Digital Hub | sixty5 |
|---|---|---|
| adapter load (read + gunzip + header) | 167.5 [158.5, 174.8] | 1,312.1 [1,310.0, 1,354.5] |
| adapter verify (one SHA-256 of stored payload bytes) | 34.1 [34.0, 34.1] | 353.0 [352.1, 353.2] |
| adapter load + verify | 201.6 [192.5, 208.9] | 1,665.1 [1,662.0, 1,707.5] |
| recorder reference read + gunzip + hash | 143.8 [140.2, 154.9] | 1,256.0 [1,203.2, 1,318.4] |
| ratio adapter / reference (bound 2.0) | 1.402 | 1.326 |
| adapter parse, ledgered apart | 650.6 [626.8, 674.8] | 5,482.0 [5,442.8, 5,506.0] |
| artifact bytes on disk / payload bytes | 14,018,134 / 85,976,206 | 101,185,751 / 898,258,653 |
| gate 0 (`.1`, commit `69d67e5`, other session) load / verify | 899.3 / 4,434.2 | 8,310.4 / 34,204.2 |

The gate 0 row is the `.1` format's `_canonical_sha256` re-serialization
that this slice replaces, quoted for scale only (Digital Hub verify moved from
4,434.2 to 34.1 ms, sixty5 from 34,204.2 to 353.0 ms); the gate
itself is the same-session ratio.

## Gate 4: whole process against the same-session clean rebuild

| Whole process | Digital Hub transport | Digital Hub clean | sixty5 transport | sixty5 clean |
|---|---|---|---|---|
| process ms, median | 11,102.2 | 50,028.4 | 72,993.4 | 320,064.2 |
| process ms, [min, max] | [10,959.2, 11,165.4] | [49,354.8, 53,062.4] | [72,799.0, 73,366.2] | [313,833.1, 322,701.0] |
| clean spread (max − min) / required saving (> 3×) | | 3,707.6 / 11,122.8 | | 8,867.9 / 26,603.7 |
| saving, ms (ratio transport / clean) | 38,926.2 (0.222) | | 247,070.8 (0.228) | |
| peak working set, median B | 641,990,656 | 1,826,074,624 | 4,145,639,424 | 5,080,170,496 |
| peak private bytes, median B | 1,143,324,672 | 2,378,563,584 | 4,632,739,840 | 5,754,077,184 |

Both arms are fresh processes recorded in this session, interleaved per
index. The clean arm's cost is dominated by extracting the unchanged
documents (Digital Hub `heating` 12,747.5 ms, `plumbing` 22,929.9 ms,
`ventilation` 5,009.6 ms against the changed `architecture` 4,072.7 ms), which
is exactly the work the artifact tier removes; the transport arm pays
restore (load + verify + parse, 852.2 ms over three documents on Digital Hub)
plus the publish of the re-extracted document (552.0 ms).

What this gate does **not** establish: the `.1` record never measured a clean
arm, so whether slice 1 alone flipped the verdict is not recorded. Slice 1's
own effect is gate 3's verify column. Gate 4 is re-run after every slice and
its rule does not change: a failure at any slice marks ADR-0019 Rejected.

## Where the time goes (medians over five samples, ms)

Digital Hub, transport arm against clean arm. Compiler stages sum with
`unattributed` to the compile total; adapter ledger stages sit inside the
adapter process's `main`; every closure check held in all ten samples.

| Stage | Transport | Clean |
|---|---|---|
| whole process | 11,102.2 | 50,028.4 |
| compile total (in-process) | 11,007.0 | 49,914.4 |
| harness overhead (process − compile) | 88.4 | 108.0 |
| `adapter` stage (spawn to close) | 7,475.6 | 46,837.6 |
| adapter interpreter start + imports | 61.8 + 221.2 | 65.8 + 235.8 |
| adapter `main` | 7,086.6 | 46,427.5 |
| changed `architecture` extract / publish | 4,052.8 / 552.0 | 4,072.7 / — |
| unchanged `heating` load / verify / parse or extract | 61.1 / 12.9 / 265.6 | 12,747.5 |
| unchanged `plumbing` load / verify / parse or extract | 83.7 / 14.8 / 297.7 | 22,929.9 |
| unchanged `ventilation` load / verify / parse or extract | 22.5 / 6.3 / 88.4 | 5,009.6 |
| federation merge / property index | 5.1 / 488.0 | 6.8 / 451.3 |
| Scene IR writes: structure / geometry / properties / digest | 680.2 / 232.2 / 8.8 / 57.7 | 689.8 / 252.4 / 8.9 / 58.1 |
| `toolchainIdentity` / `cacheLookup` / `cachePublish` | 375.9 / 0.3 / 72.7 | 0 / 0 / 0 |
| `readSceneIr` (structure scan inside it) | 1,924.6 (1,919.9) | 1,912.1 (1,906.6) |
| `compile`: validate / encode / measure / other | 93.4 / 349.3 / 180.0 / 218.4 | 94.0 / 339.6 / 198.6 / 214.7 |
| `dependencyIndex` / `writePackage` / `writeDependencyIndex` | 34.4 / 176.3 / 9.2 | 34.6 / 177.2 / 9.7 |
| in-process compiler work (compile total − adapter stage) | 3,526.9 | 3,066.4 |

The in-process compiler work is the same in both arms apart from the cache
identity and publish stages (`toolchainIdentity` 375.9 ms hashes the
compiler module directory; `cachePublish` 72.7 ms), which the clean arm skips
because it has no cache directory; that 460 ms is the transport arm's price
for a warm package cache on the next reopen. The structure scan
(`readSceneIr`, 1.9 s on Digital Hub) is untouched by this slice: it is what
ADR-0019 slice 2 (column-form structure) targets.

sixty5, same layout:

| Stage | Transport | Clean |
|---|---|---|
| whole process | 72,993.4 | 320,064.2 |
| compile total (in-process) | 72,733.3 | 319,646.3 |
| harness overhead (process − compile) | 220.6 | 390.5 |
| `adapter` stage (spawn to close) | 34,624.7 | 282,484.7 |
| adapter interpreter start + imports | 60.8 + 216.5 | 64.6 + 224.7 |
| adapter `main` | 33,724.5 | 281,475.5 |
| unchanged `architecture` load / verify / parse or extract | 432.5 / 106.4 / 1,343.5 | 68,307.4 |
| unchanged `electrical` load / verify / parse or extract | 201.9 / 67.6 / 969.3 | 42,415.2 |
| unchanged `facade` load / verify / parse or extract | 6.0 / 1.8 / 17.1 | 1,183.5 |
| unchanged `kitchen` load / verify / parse or extract | 54.3 / 11.7 / 195.7 | 16,580.1 |
| unchanged `plumbing` load / verify / parse or extract | 397.8 / 109.2 / 1,923.5 | 77,941.3 |
| changed `structure` extract / publish | 5,210.4 / 593.5 | 5,406.0 / — |
| unchanged `ventilation` load / verify / parse or extract | 224.7 / 55.6 / 1,014.6 | 46,323.8 |
| federation merge / property index | 85.7 / 9,473.2 | 99.9 / 11,237.3 |
| Scene IR writes: structure / geometry / properties / digest | 8,602.2 / 1,369.3 / 114.5 / 381.5 | 9,099.7 / 1,534.3 / 111.6 / 385.2 |
| `toolchainIdentity` / `cacheLookup` / `cachePublish` | 377.9 / 0.3 / 631.3 | 0 / 0 / 0 |
| `readSceneIr` (structure scan inside it) | 25,376.7 (25,336.6) | 25,242.1 (25,200.3) |
| `compile`: validate / encode / measure / other | 1,127.3 / 2,490.1 / 1,861.7 / 2,887.2 | 1,115.4 / 2,466.9 / 2,085.5 / 2,990.3 |
| `dependencyIndex` / `writePackage` / `writeDependencyIndex` | 772.1 / 1,726.5 / 118.8 | 786.7 / 1,721.8 / 118.0 |
| in-process compiler work (compile total − adapter stage) | 38,207.5 | 37,227.6 |

## Caveats carried in the JSON

- Package digests are host-local (the IFC adapter's split Scene IR differs by
  a few bytes across hosts, as every IFC record since the localized traces
  notes); the validator pins them and its comment says not to retarget.
- Host load was not controlled. The interleaved ordering makes drift land on
  both arms, and both arms' minimum-to-maximum spread is recorded; gate 4's
  bar is three clean spreads, so a noisy session raises the bar rather than
  the verdict.
- The gate 0 figures quoted here come from the `.1` record at commit
  `69d67e5`, another session on the same host; the `.2` record carries them
  under `gates.gate3.gate0` with `source` naming that provenance, and no gate
  is decided against them.
- `workingTreeClean` is `false` in both records: they were recorded on the
  slice-1 branch before its commit, as every evidence record that changes the
  code it measures must be.

## Files

- `digital-hub.json`, `sixty5.json`: the records (schema
  `naru.rebuild-stage-evidence.2`), each carrying the fixture manifest digest
  and per-document source digests, the changed-document edit, adapter
  identity, compile options, the protocol text, warm-up, every accepted and
  discarded sample of both arms with its full stage ledger, closure checks,
  distributions, and the four gate blocks.
- Recorder: [`scripts/record-rebuild-stage-evidence.mjs`](../../../scripts/record-rebuild-stage-evidence.mjs),
  over [`scripts/lib/ifc-cache-sample.mjs`](../../../scripts/lib/ifc-cache-sample.mjs)
  and [`scripts/lib/process-tree-sampler.mjs`](../../../scripts/lib/process-tree-sampler.mjs).
- Validator: [`scripts/validate-rebuild-stage-evidence.mjs`](../../../scripts/validate-rebuild-stage-evidence.mjs)
  (`pnpm cache:stages:check`), which pins package digests, sample counts,
  closure, the exclusion list, the decision block, the gate 3 bound, and the
  gate 4 arithmetic and verdicts.
