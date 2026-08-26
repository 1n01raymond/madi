# Spatial demand evidence

Status: reviewed focused evidence; ADR-0008 remains Proposed.

This record proves the first compiler-to-browser spatial-demand path on a
project-owned fixture. The recorder keeps the repeated-fasteners geometry and
hierarchy but changes only three occurrence translations to separate the three
target-owning prototypes. That makes a localized one-chunk camera oracle
unambiguous. It is a scheduler scenario, not a fresh OCCT extraction and not a
renderer-performance claim.

Two compilations produced byte-identical `spatial.bin` output. Adding the index
kept the historical `scene.bin` and `coarse.bin` byte-identical. The generated
sidecar was 1,552 bytes for 10 renderable occurrences and 19 BVH nodes.

| Browser | Mode | Localized nodes | Localized leaves | Occurrences tested | Candidate chunks | Obsolete Range |
|---|---|---:|---:|---:|---:|---|
| Chrome 151 / Blink | headed | 9 / 19 | 1 / 10 | 1 / 10 | 1 / 3 | aborted before body |
| Firefox 150 / Gecko | headed | 7 / 19 | 1 / 10 | 1 / 10 | 1 / 3 | aborted before body |

Both browsers fetched and authenticated `spatial.bin` once, emitted no console
warning or error, stopped at `spatial-idle`, and delivered only the final
localized chunk. Navigation cancelled the initial fastener Range before its
body was fulfilled. Query timings are recorded for diagnostic context only;
this small transform-only case is not a benchmark.

Reproduce after building the compiler:

```sh
pnpm spatial:evidence -- --output output/playwright/spatial-demand
pnpm spatial:check
```

The combined committed record was assembled from separate headed Chrome and
Firefox invocations with the same package digest because the desktop approval
review timed out during the final two-engine wrapper invocation. Each browser
record and screenshot came from an actually completed command; no metric was
reconstructed. The exact host, browser versions, adapter disclosures, request
ranges, query counts, screenshot hashes, and package digests are in
`evidence.json`.

Remaining ADR-0008 gates include the ADR-0005 large-coordinate/nested-transform
package cross-check, headed Digital Hub navigation, sixty5, and real-model query
and first-frame distributions. This record does not accept ADR-0008 by itself.

## Digital Hub payload-packing census

`digital-hub-packing.json` adds a compile/offline-demand census over the
qualified four-discipline Digital Hub source. It compares the compatibility
prototype-ID order with opt-in `spatial-leaf-anchor-v1`, using the same 512 KiB
request budget, 64-occurrence leaf capacity, source revision, geometry, coarse
bytes, and property columns.

For each of the 128 deterministic BVH leaves, the recorder sums the byte lengths
of all referenced target chunks. A prototype's payload is counted as useful
when that leaf contains at least one of its occurrences; bytes belonging only
to other prototypes in the same requested chunks are counted as off-view. This
is a leaf co-demand census, not a camera trace or renderer benchmark.

| Metric | Compatibility order | Leaf-anchor order |
|---|---:|---:|
| Target chunks | 71 | 66 |
| Chunk references across leaves | 1,458 | 882 |
| Chunks per leaf p50 / p95 | 12 / 16 | 7 / 12 |
| Requested bytes per leaf p50 / p95 | 5,651,564 / 8,145,684 | 3,503,260 / 6,095,496 |
| Summed off-view bytes across leaves | 637,689,824 | 383,315,164 |

The off-view sum falls by 39.89%, with byte-identical `coarse.bin` and a
byte-identical repeated leaf-anchor compilation. The recorded compile durations
(590 ms compatibility, 630 ms leaf-anchor) are single-run diagnostic context,
not a performance decision.

`digital-hub-browser-comparison.json` records two separate headed Chrome 151
runs on the same macOS arm64 host. The initial fit sees all 128 leaves, so this
is delivery/integration evidence rather than a localized-query trace. The
compatibility package reaches a 578 ms coarse frame and 20,766 ms ready state
after 71 target Ranges; leaf-anchor reaches 569 ms and 19,346 ms after 66
Ranges. Both retain the same 54,326,976 decoded / 54,327,980 GPU bytes, pick
object 689, resolve 18 IFC4 properties, and emit no console issue. These are
single runs, not p95 or an ADR-0003 performance decision.

Reproduce after retaining a Digital Hub split Scene IR with the current adapter:

```sh
node scripts/record-spatial-ifc-packing-evidence.mjs \
  --input output/ifc/digital-hub-spatial-packed \
  --output output/ifc/digital-hub-spatial-analysis
node scripts/record-ifc-browser-evidence.mjs \
  --scene-dir output/ifc/digital-hub-spatial-analysis/compatibility \
  --report output/ifc/digital-hub-spatial-analysis/compatibility/build-report.json \
  --output output/browser-digital-hub-spatial-compatibility
node scripts/record-ifc-browser-evidence.mjs \
  --scene-dir output/ifc/digital-hub-spatial-analysis/spatial-leaf-anchor \
  --report output/ifc/digital-hub-spatial-analysis/spatial-leaf-anchor/build-report.json \
  --output output/browser-digital-hub-spatial-leaf-anchor
node scripts/record-spatial-ifc-browser-comparison.mjs
pnpm spatial:check
```
