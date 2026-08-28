# sixty5 demand-priority comparison

Status: reviewed focused evidence; ADR-0008 remains Proposed.

`../sixty5-localized/` established that a localized view on sixty5 demands more
target bytes than the residency budget can hold. This record answers the
question that follows from it: once the budget binds, **which** of the demanded
chunks should be admitted first?

The scheduler orders demand by the spatial query's candidate list. Until this
slice that order was always the distance from the view centre to the leaf's
projected centre (`screen-distance`). This record adds an opt-in second policy,
`screen-coverage`, which orders by the clipped screen area a leaf projects to,
and measures both against a render of the same pose that was never budget-
limited.

Nothing about the default path changed: `screen-distance` reproduces the
previous ordering byte for byte, which is why no existing record needed
re-recording. The policy is selected per session with `?demandPriority=`.

## Method

One package, one pose, three runs per record:

| Run | Residency budget | Ordering |
|---|---:|---|
| `reference` | 192 MiB | `screen-distance` |
| `screen-distance` | 64 MiB | `screen-distance` |
| `screen-coverage` | 64 MiB | `screen-coverage` |

The reference budget is deliberately large enough to admit every demanded
chunk, so it renders what the user would see with no residency limit at all.
Each budgeted run is then scored against it by pixel agreement: the recorder
reads both canvases back through `createImageBitmap` into an `OffscreenCanvas`
and counts the pixels whose R, G or B differ by more than 8. Only the
`#viewport` canvas is captured -- a full-page screenshot also carries the
panels, whose text differs between runs and would dilute the score.

This is the only honest way to score the policies at this scale. Their
aggregate counters are nearly identical by construction: both fill the same
64 MiB, so both report about the same chunk count, byte count and triangle
count. What differs is *which* geometry is resident, and only a pixel
comparison against an unbudgeted render can see that.

Every run in both records emitted zero console issues and ended inside its
budget, and one admitted chunk is one `scene.bin` Range response in all of
them -- estimate-gated prefetch refuses the rest before the network.

## Close view -- area ordering wins decisively

Camera move `{wheel -5,000, pan 400/-300}`; 152 of 234 chunks demanded.

| | reference (192 MiB) | `screen-distance` | `screen-coverage` |
|---|---:|---:|---:|
| Chunks resident | 234 | 103 | 104 |
| Decoded bytes | 136,659,624 | 67,027,692 | 66,886,380 |
| GPU bytes | 136,846,980 | 67,103,956 | 66,962,280 |
| Triangles | 4,866,398 | 2,178,547 | 2,174,307 |
| Range responses | 234 | 127 | 145 |
| Differing pixels of 614,259 | -- | 215,321 | **5,416** |
| Agreement with reference | -- | 64.95% | **99.12%** |
| Mean channel difference | -- | 12.51 | 0.50 |

At the same budget and from the same 152-chunk demand set, area ordering
renders a view that is within half a channel step of the unbudgeted render,
while distance ordering leaves 35% of the frame wrong. The screenshots show
why: `screen-distance.png` still displays coarse blocky proxies where the large
near-field surfaces should be, because those surfaces belong to leaves whose
centres are off to the side of the crosshair even though they fill most of the
screen. `screen-coverage.png` is visually indistinguishable from
`reference.png`.

The `screen-distance` run's residency (67,027,692 / 67,103,956 bytes) is the
same endpoint the committed localized record reaches from the same pose, which
cross-checks the harness against evidence recorded before this slice existed.

## Mid view -- distance ordering wins

Camera move `{wheel -1,200, pan 220/-140}`; 207 of 234 chunks demanded.

| | reference (192 MiB) | `screen-distance` | `screen-coverage` |
|---|---:|---:|---:|
| Chunks resident | 234 | 105 | 105 |
| Decoded bytes | 136,659,624 | 67,029,684 | 67,031,604 |
| GPU bytes | 136,846,980 | 67,104,600 | 67,108,692 |
| Triangles | 4,866,398 | 2,187,231 | 2,192,059 |
| Range responses | 234 | 150 | 143 |
| Differing pixels of 614,259 | -- | **22,656** | 37,727 |
| Agreement with reference | -- | **96.31%** | 93.86% |
| Mean channel difference | -- | 1.70 | 2.97 |

The result reverses. From a pose that is filled with similarly sized objects
rather than dominated by a few near ones, no leaf projects a large enough area
to be worth prioritising over the crosshair, and area ordering spends budget on
wide but peripheral leaves. Both policies stay above 93% here -- the gap is a
fifth of the close view's -- but the direction is opposite, and the record
carries both. That is the reason `screen-coverage` ships as an opt-in policy
and not as the new default.

The validator pins the winner per record, so neither direction can flip
silently on a re-record.

## Reproducing

The packages come from `../sixty5-localized/`'s compile step; only the
leaf-anchor order is used here.

```
pnpm demand:priority:evidence -- --output output/demand-priority
pnpm demand:priority:check
```

The mid view is the same command with the second pose:

```
pnpm demand:priority:evidence -- --output output/demand-priority-mid \
  --wheel-delta -1200 --pan-x 220 --pan-y -140
```

The recorder verifies every resource in the build report against its SHA-256
before it opens a browser, and refuses to record if the reference budget did
not admit more chunks than either budgeted run, if any budgeted run exceeded
its budget, or if any console issue appeared.

## Honest limits

- **The outcome is view-dependent, and the record proves it.** Area ordering is
  the better policy for the close view and the worse one for the mid view. It
  is not a general improvement, and nothing here justifies making it default.
  A blended cost -- area weighted by distance, or a screen-space error metric --
  is the obvious follow-up and is not recorded.
- **Coverage is a ranking signal, not a measurement.** The score is the clipped
  NDC area of a leaf's axis-aligned bounds, so it over-estimates a slanted or
  hollow box, and a leaf's area is attributed to every chunk that leaf
  references. Any box that straddles the eye plane scores the whole view.
- **The reference render is not byte-stable at this scene size.** Across three
  close-view runs the reference PNG differed once while both budgeted renders
  were byte-identical every time, so the pixel scores are pinned as bands
  rather than as exact values. The mid view reproduced all three runs
  identically, including both scores.
- **Repeatability of the admitted sets is exact.** Every pinned residency and
  triangle count above reproduced across all three runs of each pose, and each
  budgeted screenshot was byte-identical across its three runs. Only the
  request count moved -- 127-128 and a constant 145 in the close view, 148-151
  and 143-144 in the mid view -- as prefetch raced eviction; the validator
  bands it rather than pinning it.
- **One host, one browser, one model.** Headed Chrome 151.0.7922.139 on Windows
  11, sixty5 leaf-anchor package `1fdbb5a8…` -- a host-local digest, as
  `../sixty5-localized/README.md` explains. The camera moves are scripted; the
  close view's -5,000 wheel delta saturates the Studio's zoom clamp.
- Pixel agreement scores what the user sees at one instant after both runs
  settle. It is not a frame-time, first-frame or bandwidth claim; the milestone
  numbers in `demand-priority.json` are diagnostic context.
