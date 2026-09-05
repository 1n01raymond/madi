# Deployed Studio opening a package from the delivery origin

Status: committed browser evidence for
[ADR-0023](../../../docs/adr/0023-public-package-delivery-origin.md) gate 3,
recorded 2026-09-05 with
[`scripts/record-public-demo-browser-evidence.mjs`](../../../scripts/record-public-demo-browser-evidence.mjs)
and validated by `pnpm demo:browser:check`
([validator](../../../scripts/validate-public-demo-browser-evidence.mjs)).
Schema `naru.public-demo-browser-evidence.1`, mode
`headed-deployed-studio-delivery-origin-load`.

## What it answers

The site and the package live on different origins: the Studio is served by
GitHub Pages at `https://1n01raymond.github.io/naru/studio/` and its default
package by Cloudflare R2 at
`https://packages.blacktanlabs.com/naru/digital-hub/v1/`. The record shows
headed Chrome 151 (Blink, Windows, 1320×1000) navigating to the Studio with no
query string, reading the package cross-origin through the deployed bundle's
own default scene URL, and reaching every milestone the product promises:

| Milestone | Value in the committed run |
|---|---|
| Hierarchy ready | 2,676 ms |
| First coarse frame | 3,717 ms |
| Ready (every target chunk resident) | 7,729 ms |
| Target chunks resident | 45 / 45 (45 requests, none refused) |
| Resident bytes | 23,476,872 decoded / 23,491,408 GPU |
| Renderable occurrences | 5,152 (3,383 prototypes, 913,532 triangles, 12 edges) |
| Origin responses seen by the page | 49: `scene.gltf`, `coarse.bin`, `properties.json`, `properties.bin` once each at `200`; `scene.bin` 45 times at `206`, every one a `Range` request answered with `Content-Range` |
| Pick at the viewport centre | object 689, `Oberfläche:2437498`, residency `retained`, 18 property entries resolved from `properties.bin` |
| Console issues | 0 |

Every response carried `Access-Control-Allow-Origin: https://1n01raymond.github.io`
and exposed `Content-Range`; without that exposed header the geometry Worker
refuses a `206` and the page would render its shell and no geometry.

## Method

1. The recorder fetches the deployed Studio's index, follows its script
   assets, and proves one of them names
   `https://packages.blacktanlabs.com/naru/digital-hub/v1/scene.gltf` as the
   default scene, so the record is about the bundle a visitor receives, not a
   query override.
2. Before the browser starts it streams every declared resource from the origin
   with the site's `Origin` header and checks byte count and SHA-256 against
   the committed [`build-report.json`](../../ifc/digital-hub/build-report.json)
   (package `9b98866671eb…`), together with `Content-Length`, `Content-Type`,
   `Accept-Ranges`, and the CORS headers. It repeats the same verification after
   the browser closes and asserts nothing changed.
3. Headed Chrome opens the Studio, the recorder waits on the Studio's own
   `data-*` milestones, screenshots `ready.png`, clicks the viewport centre,
   waits for the selection and its property entries, and screenshots
   `picked.png`.

Three consecutive runs settled on an identical endpoint (chunks, resident
bytes, status line, triangle count, the 49-response breakdown, both origin
verifications). The committed sample is run 2, the median first coarse frame
(runs: 5,117 / 3,717 / 2,467 ms; ready 9,499 / 7,729 / 5,352 ms).

## Honest limits

- Timings cross two public CDNs from one Windows host and are a bound, not a
  figure: the validator requires ordered milestones and ready under 60 s and
  pins none of them.
- The picked object depends on which chunk lands under the cursor first: run 1
  picked object 137 with 74 entries, runs 2 and 3 object 689 with 18. The
  validator checks the pick's shape (a retained occurrence, an IFC source
  reference, at least one property entry), not its identity.
- The screenshots are not byte-stable across runs; the validator re-hashes the
  committed PNGs against the record but pins no literal digest.
- One engine, one operating system, and Digital Hub (84.5 MB package) rather
  than the 854,446,743-byte engineering baseline gate 4 asks for.
- The origin's digests are the committed federation record's; retarget them only
  with a deliberate re-record of both, never to make a run pass.
