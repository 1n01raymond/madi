# Deployed Studio opening the engineering baseline from the delivery origin

Status: committed browser evidence for
[ADR-0023](../../../docs/adr/0023-public-package-delivery-origin.md) gate 4
and Phase 2 exit criterion 1 ([tracker](../../../docs/PHASE_2.md)), recorded
2026-09-05 with
[`scripts/record-public-demo-browser-evidence.mjs`](../../../scripts/record-public-demo-browser-evidence.mjs)
(`--open-via scene-query`) and validated by `pnpm demo:baseline:check`
([validator](../../../scripts/validate-engineering-baseline-origin-evidence.mjs)).
Schema `naru.public-demo-browser-evidence.1`, mode
`headed-deployed-studio-delivery-origin-load`.

## What it answers

The qualified 31-document sixty5 Design + Engineering package
([qualification record](../../ifc/engineering-baseline/README.md)) is
published at `https://packages.blacktanlabs.com/naru/engineering-baseline/v1/`
next to its CC BY 4.0 license and attribution, and the deployed Studio at
`https://1n01raymond.github.io/naru/studio/` opens it. The deployed default
scene stays Digital Hub, so the Studio is opened through its scene query
(`?scene=<document URL>`); the record carries that URL as the page's own
location at ready. Headed Chrome 151 (Blink, Windows, 1320×1000) reaches every
milestone the product promises for a real-large package:

| Milestone | Value in the committed run |
|---|---|
| Hierarchy ready | 13,736 ms |
| First coarse frame | 19,955 ms |
| Ready (budget-limited settle) | 29,026 ms |
| Target chunks resident | 82 / 626 (82 requests, 544 refused before fetch, 0 cancellations) |
| Resident bytes | 67,091,796 decoded / 67,095,764 GPU under a 67,108,864-byte budget |
| Renderable occurrences | 104,337 (66,396 prototypes; 1,217,463 resident triangles, 951,739 resident edges) |
| Origin responses seen by the page | 87: `scene.gltf`, `coarse.bin`, `spatial.bin`, `properties.json`, `properties.bin` once each at `200`; `scene.bin` 82 times at `206`, every one a `Range` request answered with `Content-Range` |
| Pick at the viewport centre | object 4926, `Merk-AL18(29)`, residency `retained`, 9 property entries resolved from `properties.bin` |
| Console issues | 0 |

The 64 MiB residency budget is reached, so the Studio's target state settles
at `limited`, not `true`; that is its ready state for a package whose target
detail (325,019,932 bytes of `scene.bin`) cannot be resident at once, and the
validator pins that state instead of full residency. Every response carried
`Access-Control-Allow-Origin: https://1n01raymond.github.io` and exposed
`Content-Range`.

## Method

1. The recorder fetches the deployed Studio's index and follows its script
   assets, then opens the Studio at the scene-query URL; the record says so
   (`deployment.openedVia: "scene-query"`) and the validator refuses any other
   mode, so this record makes no claim about the bundle's default scene.
2. Before the browser starts it streams every declared resource from the origin
   with the site's `Origin` header and checks byte count and SHA-256 against
   the committed [`build-report.json`](build-report.json) (package
   `04472c9ad292…`, 854,447,023 bytes over six resources), together with
   `Content-Length`, `Content-Type`, `Accept-Ranges`, and the CORS headers. It
   repeats the same verification after the browser closes and asserts nothing
   changed.
3. Headed Chrome opens the Studio, the recorder waits on the Studio's own
   status element reaching `ready`, screenshots `ready.png`, clicks the
   viewport centre, waits for the selection and its property entries, and
   screenshots `picked.png`.

Three consecutive runs settled on an identical endpoint: the same 82 chunks,
resident bytes, status line, triangle and edge counts, the same 87-response
breakdown, the same picked object with the same 9 entries, and byte-identical
`ready.png` and `picked.png`. Only the wall clock moved (hierarchy / first
coarse frame / ready: 9,411 / 13,947 / 21,786; 19,367 / 23,649 / 33,540;
13,736 / 19,955 / 29,026 ms). The committed sample is the third run, the
median on all three milestones.

## Package bytes

The committed [qualification record](../../ifc/engineering-baseline/README.md)
was compiled on macOS (package `6d23bffd6632…`, 854,446,743 bytes). The
package at the origin is this Windows host's compile of the same 31 sources
with the same compiler, `04472c9ad292…`, 854,447,023 bytes: `coarse.bin`,
`spatial.bin`, `properties.json`, and `properties.bin` are byte-identical to
the macOS record, `scene.gltf` has the same byte length with different bytes,
and `scene.bin` is 280 bytes longer. That is the cross-host adapter drift the
[localized-trace records](../../spatial-demand/README.md) already document;
determinism is per host. The [build report](build-report.json) of the
published package is committed beside this record so the validator verifies the
origin against the bytes that were actually uploaded, and both digests are
pinned: neither may be retargeted to make a run pass. A re-record that produces
other bytes must re-upload the package under a new immutable prefix and
re-commit its build report.

## Honest limits

- Timings cross two public CDNs from one Windows host and are a bound, not a
  figure: the validator requires ordered milestones and ready under 120 s and
  pins none of them. An exploratory run perturbed by a second browser probe
  took 188 s to the same endpoint.
- The screenshots were byte-identical across the three runs, but the validator
  re-hashes the committed PNGs against the record and pins no literal digest: a
  browser update changes rasterization without changing the claim.
- One engine and one operating system; the Digital Hub record is the same shape
  on the same host.
- `pnpm demo:smoke --package-origin` still checks the Digital Hub prefix the
  deployment reads from `NARU_PACKAGE_ORIGIN`; this package is reached through
  the scene query, and its delivery contract is asserted by the recorder's own
  origin verification, not by the smoke check.
- The record's `targetReadyState` and `targetSchedulerCancellations` fields were
  added to the recorder for this package; the earlier Digital Hub record
  predates them and its validator does not read them.
