# sixty5 cold, warm, and corrupt-cache distributions

Status: recorded product evidence; closes the real-large reopen debt that
[`artifacts/cache/`](../README.md) left open with single mid-size runs.

The mid-size record publishes one cold and one warm run each for PyGamer STEP
and the four-document Digital Hub federation. This record answers the question
that one could not: what a **real-large** import and reopen actually cost, with
enough samples to quote a median and an observed p95 instead of a single
observation. The source is the pinned seven-document, 839.9 MB `ifc-bench-sixty5`
federation (CC BY 4.0) from `fixtures/external/manifest.json`.

## Protocol, fixed before the results

Three cache states, five valid samples each, **one fresh `node` process per
sample** — a second compile inside one process would reuse a warm module graph
and a grown V8 heap that a user reopening a model tomorrow does not have. One
iteration runs cold → warm → corrupt-entry against a single cache directory, and
five iterations produce the five samples per state:

1. **cold** — the whole cache directory is removed, so both the compiled-package
   entry and the adapter document-artifact cache start empty;
2. **warm** — the cache is left exactly as the preceding cold sample published
   it, and the run must report a `hit`;
3. **corrupt-entry** — the first byte of `scene.gltf` inside the cache entry is
   flipped. The document-artifact cache is deliberately left intact, because
   that is the state a user with one damaged package entry actually has.

A sample whose compile throws, or whose cache status is not the one its state
requires, is recorded in `discardedSamples` with its reason and immediately
re-run. **This recording discarded none: all fifteen retained samples are the
first ones taken.** Each sample compiles into its own output directory, which is
hashed in full and then deleted.

`median` is the middle sorted value. `p95` is the **nearest-rank observed p95**,
the `ceil(0.95 × n)`-th sorted value — the maximum at n = 5. It is an order
statistic of the samples taken, not an estimate of a population.

Peak memory is `os-sampled-win32-process-tree`: `Win32_Process WorkingSetSize`
summed over the tree rooted at the sample process every 500 ms, so the native
IfcOpenShell adapter is included. A peak that rises and falls entirely between
two snapshots is invisible to it, so the summed per-process `PeakWorkingSetSize`
counter is reported beside it as an upper bound no sampling gap can miss — one
that charges peaks which never coincided.

## Results

Host: Windows x64, Ryzen 7 9800X3D (16 threads), 33.5 GB RAM, Node 22.14.0,
IfcOpenShell 0.8.5 / numpy 2.5.2 / Python 3.13.2, `--threads 6`, at commit
`404a55e`.

| State | Compile median | Compile p95 | Whole process median | Peak process tree (median) | Summed peak upper bound (median) |
|---|---:|---:|---:|---:|---:|
| cold | 379.0 s | 382.0 s | 379.2 s | 5.09 GB | 5.94 GB |
| warm | 1.37 s | 1.38 s | 1.44 s | 0.90 GB | 0.92 GB |
| corrupt-entry | 87.7 s | 88.8 s | 87.9 s | 3.78 GB | 4.23 GB |

**The 1–5 s unchanged-reopen target passes**, and it passes on the harder of the
two readings: 1,366 ms of compiler time, 1,439 ms of whole-process time
including `node` startup and module loading, which a user reopening a model also
pays. A warm reopen is 277× faster than the cold import that produced it.

Because the three states differ by exactly one stage each, their medians
decompose the cold import by difference: adapter extraction of the seven
documents accounts for 291.3 s, packaging for 87.7 s, and restoring a published
entry for 1.37 s.

A corrupt-entry fallback is **not** a cold compile, and the record says why: only
the package entry was damaged, so all seven documents are still restored from the
adapter artifact cache (cold records seven misses, corrupt-entry seven hits) and
the run pays packaging alone. Both warnings are captured per sample — the failed
restore, and `cache publish failed …; compiled output kept without a cache
entry`, which is the fail-closed behavior ADR-0009 specifies: a damaged entry is
never silently overwritten by the fallback, so it stays a miss until the host
quarantines it. A warm hit never runs the adapter at all, so it restores the
publishing run's adapter report verbatim — which is why warm samples report the
cold run's seven misses.

## Package identity

Every one of the fifteen samples produced package
`3206ea40835d8ca70a0a82208e397a8dcdcd66351b29b4df0e8102ff910e6454`, and the
fourteen non-baseline samples are byte-identical to the baseline file by file —
653.9 MB across eight files, compared with exactly one predeclared exclusion:
`adapter-report.json:documentArtifactCache`, the execution-path telemetry above,
whose value is recorded per sample instead of being normalized away.

| File | Bytes |
|---|---:|
| `scene.gltf` | 357,999,930 |
| `scene.bin` | 169,752,328 |
| `coarse.bin` | 38,700,720 |
| `incremental-dependencies.json` | 38,342,167 |
| `properties.bin` | 31,179,862 |
| `properties.json` | 17,705,010 |
| `build-report.json` | 141,563 |
| `adapter-report.json` | 39,022 |

`build-report.json` declares the same five package resources with the same byte
counts and digests it shipped beside; the validator checks that agreement rather
than trusting either side.

Cache footprint, measured with `du -sb` on the directory the final iteration
left (a byte flip does not change a file's size, so the corrupted entry measures
like a healthy one): **756,857,071 B total** — 653,864,014 B for the compiled
package entry and 102,993,057 B for the seven document artifacts, against
839,866,782 B of source IFC. This measurement is taken from the retained
directory after the run, not from the validated JSON.

## Two findings this record carries

**The compiler's default glTF formatting cannot package this federation at
all.** Now that explicit IFC boundary edges are emitted by default (PR #42), the
pretty-printed document exceeds V8's maximum string length, and
`JSON.stringify(document, null, 2)` throws `RangeError: Invalid string length`
after 376.1 s of completed work. Every sample here therefore compiles with
`compactJson: true`, and the failure is recorded as a first-class
`defaultFormattingProbe` taken before the samples rather than worked around
silently. A streaming document writer is the fix; until it exists, real-large
IFC packaging requires `--compact-json`.

**This host does not reproduce the committed sixty5 package.**
`artifacts/ifc/sixty5/` records `a2d6c72a…`, compiled before explicit edges
existed. The record states the difference and its cause; neither digest may be
retargeted to make the other pass.

## Reproduce

The recorder rebuilds the compiler first, needs the local IFC adapter virtual
environment via `NARU_IFC_PYTHON`, needs the sixty5 sources already present
under the gitignored external-fixture directory, and works under
`output/sixty5-cache/`. It takes roughly one hour: sixteen compiles, one at a
time, each producing and then deleting a 653.9 MB output directory.

```sh
pnpm cache:sixty5:evidence
pnpm cache:sixty5:check
```

`scripts/validate-sixty5-cache-evidence.mjs` pins the fixture manifest digest
and all seven source digests, the adapter identity, the sampling protocol and
the reopen target, five valid samples per state with a real memory sample each,
the per-state cache and document-cache results, the fail-closed warnings, the
eight-file package inventory with its digests, the fourteen byte-identity
comparisons, the reopen verdict, the default-formatting probe, and the
committed-record comparison — and it rejects any machine-local path in the
committed JSON.
