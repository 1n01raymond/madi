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
package cross-check, localized headed real-model navigation, and real-model query
and repeated first-frame distributions. This record does not accept ADR-0008 by itself.

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

## sixty5 real-large payload-packing census

`sixty5-packing.json` repeats the same offline contract on the qualified
seven-discipline IFC2X3 federation after current split.4 explicit-edge
extraction: 188,319 occurrences, 42,435 compiled prototypes, 4,866,380 unique
triangles, and 3,771,758 explicit edge segments. Its compact `scene.gltf`
serialization is declared because the pretty-printed document exceeds V8's
single-string limit; compact JSON changes no glTF data model value.

| Metric | Compatibility order | Leaf-anchor order |
|---|---:|---:|
| Target chunks | 324 | 325 |
| Chunk references across leaves | 34,167 | 21,246 |
| Chunks per leaf p50 / p95 | 17 / 23 | 10 / 17 |
| Requested bytes per leaf p50 / p95 | 8,376,048 / 11,771,888 | 5,341,128 / 8,578,584 |
| Summed off-view bytes across leaves | 15,972,343,228 | 9,668,115,064 |

The global chunk count increases by one, but the 2,048-leaf co-demand census
reduces chunk references by 37.82%, requested bytes p50 by 36.23%, p95 by
27.13%, and summed off-view bytes by 39.47%. Useful bytes, target bytes, and
`coarse.bin` remain identical. A repeated leaf-anchor compile is
byte-identical, and both packages pass Khronos glTF Validator 2.0.0-dev.3.10
with zero errors and warnings. The two 6.98/7.66-second compile observations
are single-run diagnostics, not benchmark claims.

The recorder compiles packages sequentially and was run with an 8 GiB V8 heap;
that execution contract is embedded in the record. Headed Chrome attempts
reproduced a 6.2–6.5-second coarse frame under a 40 MiB residency setting, but
the second target admission did not complete in a reviewable interval. Those
aborted runs are not committed evidence. They identify real-large browser GPU
reconciliation/visibility as the next gate rather than proving a timing or
parity result.

Reproduce after retaining the current sixty5 split Scene IR:

```sh
node --max-old-space-size=8192 --expose-gc \
  scripts/record-spatial-ifc-packing-evidence.mjs \
  --input output/ifc/sixty5-spatial-packed \
  --output output/ifc/sixty5-spatial-analysis \
  --compact-json
pnpm spatial:check
```
