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
package cross-check, Digital Hub and sixty5 records, and real-model query and
first-frame distributions. This record does not accept ADR-0008 by itself.
