# sixty5 whole-process memory envelope, second engine

The same protocol as the [Blink record](../sixty5-envelope/README.md), repeated
on a second browser engine so its figures can be read as properties of the
application rather than of one browser's instrumentation. The ledger, the six
phases, the two residency profiles, the camera, and the eviction probe are
unchanged; read the Blink record first for what each of the eighteen ledger
categories owns and how it is collected.

Two things this repeat exists to settle:

- whether the resident set a residency budget admits depends on the engine, and
- whether the process-level figures the Blink record reports depend on Chromium
  APIs that no other engine exposes.

The first answer is no. The second is yes, which is why this record's bound
comes from the operating system alone.

## Result

Recorded 2026-09-04 in headed Firefox 150.0.2 (Gecko) at 1320x1000, on the same
Windows x64 host as the Blink record (16 CPUs, 33,463,021,568 B of RAM),
against the same 657.1 MB sixty5 package
`a2d6c72a6e936ac3ea2a183a1028cc4a06b20985c6d90b16058954323b7c3347` served from
Vite static hosting with HTTP Range support. Three runs per profile, each in a
fresh browser and context. Zero console warnings, console errors, or page
errors in all six runs.

### The two engines admit the same bytes

Every settled resident figure is identical to the Blink record, in both
profiles. Not close: equal.

| Settled phase | Decoded | GPU | Renderer GPU buffers | Chunks |
|---|---:|---:|---:|---:|
| budget-limited, 64 MiB | 66,686,508 B | 66,783,808 B | 66,783,936 B | 111 / 234 |
| navigation, 64 MiB | 67,009,032 B | 67,108,748 B | 67,108,876 B | 110 / 234 |
| selection, 64 MiB | 67,009,152 B | 67,108,508 B | 67,108,636 B | 110 / 234 |
| eviction, 64 MiB | 67,009,152 B | 67,108,508 B | 67,108,636 B | 110 / 234 |
| budget-limited, 8 MiB | 8,249,400 B | 8,251,192 B | 8,251,320 B | 4 / 234 |
| navigation, 8 MiB | 8,385,360 B | 8,387,956 B | 8,388,084 B | 1 / 234 |
| selection, 8 MiB | 8,375,808 B | 8,377,224 B | 8,377,352 B | 2 / 234 |
| eviction, 8 MiB | 8,375,808 B | 8,377,224 B | 8,377,352 B | 2 / 234 |

The application-level outcome is identical too: the same status line
(`Residency budget reached · 24326 surface batches retained · 78173 renderable
occurrences` at 64 MiB, `· 449 surface batches retained ·` at 8 MiB), the same
centre pick `148339` promoted to target residency, the same 6 IFC2X3 property
entries resolved, and the same number of colder target mesh groups displaced by
that pinned selection — 199 at 64 MiB and 325 at 8 MiB. The validator asserts
all of it across the two records, so the pair cannot drift apart silently.

The coarse-frame phase is deliberately excluded from that comparison. It is
sampled as soon as a first frame exists, so how many chunks have landed by then
is a race that varies between runs of a single engine, let alone between two.

### The two engines do not hold the same process

| Median at the budget-limited phase | Gecko | Blink | Ratio |
|---|---:|---:|---:|
| Browser process-tree working set, 64 MiB | 5,104,345,088 B | 2,586,112,000 B | 1.97x |
| Browser process-tree private commit, 64 MiB | 11,447,386,112 B | 8,339,120,128 B | 1.37x |
| Browser process-tree working set, 8 MiB | 4,701,130,752 B | 1,439,883,264 B | 3.26x |
| Browser process-tree private commit, 8 MiB | 4,953,575,424 B | 1,312,243,712 B | 3.77x |
| Main-thread used JS heap | not exposed | 847,065,463 B | - |
| Agent-cluster memory | not exposed | 730,751,608 B | - |

Cutting the geometry budget by 58,720,256 B moved this engine's working set by
403,214,336 B, where it moved Blink's by 1,146,228,736 B. Target residency is
1.31% of the default profile's working set here and 2.58% there. Both records
say the same thing about the budget and disagree about everything around it:
the budget bounds the category it names, and that category is a small and
engine-independent part of a process whose size is not.

## The predeclared target this engine does not meet

`process-working-set-ceiling` — the browser process tree stays below 4 GiB
while a 657 MB package is open — is **not met**. The ceiling was not raised to
accommodate the result.

| Target | Ceiling | Observed maximum | Met |
|---|---:|---:|---|
| Decoded residency within budget | the configured budget | 67,009,152 B (default #1, selection) | yes |
| GPU residency within budget | the configured budget | 67,108,748 B (default #1, navigation) | yes |
| Process working set below 4 GiB | 4,294,967,296 B | 5,486,096,384 B (forced low #1, coarse-frame) | **no** |
| Heap estimators absent, not zero | - | both figures null with a stated reason in all 36 samples | yes |
| Forced-low profile remains usable | - | hierarchy, coarse frame, navigation, selection, eviction all completed | yes |

Twenty-eight of the thirty-six samples exceed the ceiling. Two details fix what
the breach is and is not about:

- The **forced-low profile breaches it too**, and holds the record maximum. At
  8 MiB the renderer is holding 8,249,400 B of decoded geometry — 0.15% of the
  process — and the process tree still passes 5.4 GB. Residency is not what
  puts it there.
- The breach starts at the **hierarchy phase**, before a single target chunk is
  admitted: the lowest hierarchy sample of the six runs is 4,187,951,104 B. The
  448.8 MB document that both the main thread and the geometry Worker read is
  already in memory at that point, and this engine's allocator holds far more
  resident pages around it than Blink's does.

The lowest working set observed anywhere in this record is 3,791,085,568 B, at
the forced-low budget-limited phase. Blink's lowest is 1,431,064,576 B at the
same point. Nothing here decomposes the difference: `process.workingSetBytes`
is one figure for an eight-process tree, and this record does not attribute it
to allocator behaviour, media/JIT reservations, or GPU-process residency.

This is a finding, not a regression: no Studio code changed between the two
records, and the resident set the runtime manages is identical in both. What
it settles is that a 4 GiB whole-process ceiling is not an engine-independent
property of opening this package, and that any such claim in `docs/RUNTIME.md`
or `docs/PHASE_2.md` must name the engine it was measured on.

## Two ledger categories move to `unsupported`

Gecko exposes neither `performance.memory` nor
`performance.measureUserAgentSpecificMemory()`. Both page-level categories are
therefore recorded the way the GPU driver allocation already was: `method:
"unsupported"`, `value: null`, and a stated reason in every sample. Three of
the eighteen ledger categories carry no value in this record; the other fifteen
are unchanged.

| Category | Blink | Gecko |
|---|---|---|
| `page.usedJsHeapBytes` | browser-estimated | unsupported — `performance.memory is not exposed by this engine.` |
| `page.uaMemoryBytes` | browser-estimated | unsupported — `measureUserAgentSpecificMemory is not exposed by this engine.` |
| `gpu.driverAllocationBytes` | unsupported | unsupported |

A zero would have been the easy alternative and the wrong one: it reads as a
measured figure while measuring nothing, and it would have made this engine
look like it holds no JavaScript heap at all. The record turns the absence
itself into a checked property. Where the Blink record declares a
`js-heap-ceiling` target, this one declares `heap-estimators-absent-not-zero`,
which passes only if both figures are null *and* both say why — and the
validator recomputes that from the samples rather than trusting the recorded
verdict. That is what makes the process-level figures above the whole bound
this record reports, rather than a supplement to a page-level one.

## Per-phase medians

Three runs per profile; every cell is the median of the three. `residency`
columns are unavailable at the hierarchy phase, which is sampled before the
scene exists. There are no heap columns, for the reason above.

### Default budget (64 MiB)

| Phase | Working set | Private commit | Decoded | GPU | Chunks |
|---|---:|---:|---:|---:|---:|
| hierarchy | 4,204,441,600 | 4,380,585,984 | n/a | n/a | n/a |
| coarse-frame | 4,794,159,104 | 5,848,567,808 | 9,197,064 | 9,202,020 | 0 |
| budget-limited | 5,104,345,088 | 11,447,386,112 | 66,686,508 | 66,783,808 | 111 |
| navigation | 5,134,422,016 | 11,827,421,184 | 67,009,032 | 67,108,748 | 110 |
| selection | 5,417,730,048 | 12,131,172,352 | 67,009,152 | 67,108,508 | 110 |
| eviction | 5,253,013,504 | 11,956,658,176 | 67,009,152 | 67,108,508 | 110 |

### Forced-low budget (8 MiB)

| Phase | Working set | Private commit | Decoded | GPU | Chunks |
|---|---:|---:|---:|---:|---:|
| hierarchy | 5,088,481,280 | 5,340,520,448 | n/a | n/a | n/a |
| coarse-frame | 5,463,404,544 | 5,727,399,936 | 8,249,400 | 8,251,192 | 0 |
| budget-limited | 4,701,130,752 | 4,953,575,424 | 8,249,400 | 8,251,192 | 4 |
| navigation | 4,923,121,664 | 5,299,048,448 | 8,385,360 | 8,387,956 | 1 |
| selection | 5,274,705,920 | 5,656,989,696 | 8,375,808 | 8,377,224 | 2 |
| eviction | 5,183,418,368 | 5,525,929,984 | 8,375,808 | 8,377,224 | 2 |

Unlike the Blink record, the two profiles do not separate into two bands. They
overlap: the forced-low profile's hierarchy and coarse-frame samples sit above
the default profile's, and the forced-low maximum is the highest sample in the
record. Whatever dominates this engine's working set here is not the geometry
the budget controls.

## What the forced-low profile proves here

The same as in the Blink record, and it is worth restating because it holds on
an engine whose process figures are otherwise unrecognisable. At 8 MiB, 4 of
234 chunks are admitted and 230 are refused from their measured cost before any
bytes move, and:

- all 78,173 renderable occurrences stay visible through shared coarse
  geometry, which the target budget does not gate — `forced-low-budget/
  coarse-frame.png` is the proof, captured before that run's memory sample;
- the status line reports the state it is actually in, in every run;
- navigation re-forms the resident set for the new view (4 chunks give way to
  1 larger one, and the pinned selection brings it to 2) inside the same 8 MiB;
- selection resolves the same source-aware result as the default profile;
- eviction is observed in every run, and the scheduler goes quiet within
  4,033-4,053 ms of the eviction sample's bounded 180 s wait.

## What is not measured

- **JavaScript heap on this engine.** Covered above; the operating-system
  sample carries the whole bound.
- **GPU driver allocations.** Unchanged from the Blink record: no interface
  available to page or host script reports what the WebGPU driver allocated on
  the device.
- **Per-category process attribution.** `process.workingSetBytes` is one number
  for an eight-process `firefox.exe` tree. This record does not decompose it,
  which is exactly why the 1.97x gap against Blink is reported as an
  observation and not as an explanation.
- **Timing.** Every phase pauses for an operating-system process sample and for
  the scheduler to settle, so the milestone offsets in this record are
  perturbed and must not be read as startup results.
  `artifacts/ifc/sixty5-first-frame-gecko/` is the timing record for this
  engine — and its resident endpoint is the same one this record measures, from
  an independent recording.

## Reproduce

Recreate the package as described by `artifacts/ifc/sixty5/README.md` into
`output/ifc/sixty5-prb`, then run:

```sh
pnpm memory:envelope:gecko:evidence
pnpm memory:envelope:check
```

`pnpm memory:envelope:check` validates both engines' records in one pass; there
is no separate Gecko validator to run. The recorder verifies all five package
resources against the committed build report before it opens the browser and
requires cross-origin isolation, which Gecko reports as available here even
though the API it gates is not.

## Limits

- **One host, one operating system.** Both engines were driven from the same
  Windows x64 machine, so this closes the second-engine half of the repeat that
  `artifacts/memory/sixty5-envelope/` asked for and not the second-operating-
  system half. `Win32_Process` is Windows-only; a Linux or macOS repeat would
  sample a different counter, and the working-set gap reported here should not
  be assumed to transfer.
- **Two engines is not a distribution.** The identical resident set is a strong
  result because it is exact, not because two samples are many.
- The figures describe an already compiled package opened from local static
  hosting. They are not an import-time or a network-constrained result.
- No optimization is claimed or attempted. As in the Blink record, the largest
  single category in the ledger is the 448.8 MB compiled document.
