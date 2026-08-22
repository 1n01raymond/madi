# Phase 0 WebGPU browser matrix

This evidence records the same OCCT-derived engineering scene rendered and
picked through two independent browser engines on 2026-08-23 (Asia/Seoul).
`browser-matrix.json` is the machine-readable result; the PNG files are the
full-page post-selection captures referenced by that report.

## Result

| Signal | Chrome | Firefox |
|---|---|---|
| Browser / engine | 151.0.7922.139 / Blink | 150.0.2 / Gecko |
| Host | Windows x64 | Windows x64 |
| Public adapter info | NVIDIA, Lovelace, non-fallback | Vendor fields withheld by the browser, non-fallback |
| Ready state | 3 prototypes, 10 part occurrences | 3 prototypes, 10 part occurrences |
| Geometry | 2,076 triangles, 181 explicit edge segments | 2,076 triangles, 181 explicit edge segments |
| Pick result | `center-rail`, object ID 2, 12 OCCT edge refs | `center-rail`, object ID 2, 12 OCCT edge refs |
| Console warnings / errors | 0 / 0 | 0 / 0 |

| Chrome 151 / Blink | Firefox 150 / Gecko |
|---|---|
| ![Chrome WebGPU selection](chrome-151-windows-selected.png) | ![Firefox WebGPU selection](firefox-150-windows-selected.png) |

Both screenshots were visually reviewed for the canonical camera, source
colors, visible assembly occurrences, explicit CAD edges, hierarchy, statistics,
and selected-occurrence text. Minor browser font rasterization differences are
not treated as geometry differences. This run does not establish performance or
support across additional GPUs, operating systems, or mobile browsers.

## Reproduce

The recorder starts and stops its own Vite server, uses a fixed 1320 × 1000 CSS
viewport, clicks a fixed relative point on the orange center rail, asserts every
displayed count and selection value, rejects browser warnings/errors, and writes
screenshots plus a SHA-256-bearing JSON report.

```sh
pnpm install
pnpm exec playwright install firefox
pnpm browser:matrix
```

The default destination is the ignored `output/playwright/browser-matrix`
directory. Maintainers intentionally publish a reviewed run with:

```sh
pnpm browser:matrix -- --output artifacts/browser-matrix
```

The Chrome channel must be installed on the host. Playwright supplies the pinned
Firefox build. Use `--headless` only for an additional diagnostic run because it
may select a different GPU adapter and does not replace the headed visual record.
