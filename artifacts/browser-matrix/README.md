# Phase 1 compiled glTF browser matrix

This evidence records the same standards-first compiled package loaded, rendered,
and picked through two independent browser engines on 2026-08-23 (Asia/Seoul).
`browser-matrix.json` is the machine-readable result; the PNG files are the
full-page post-selection captures referenced by that report.

## Result

| Signal | Chrome | Firefox |
|---|---|---|
| Browser / engine | 151.0.7922.139 / Blink | 150.0.2 / Gecko |
| Host | Windows x64 | Windows x64 |
| Public adapter info | NVIDIA, Lovelace, non-fallback | Vendor fields withheld by the browser, non-fallback |
| Delivery path | `scene.gltf` hierarchy → Worker `scene.bin` decode → WebGPU | Same |
| Hierarchy before binary request | Passed | Passed |
| Ready state | 3 shared meshes, 10 renderable occurrences | Same |
| Geometry | 2,076 triangles, 181 explicit CAD edge segments | Same |
| Pick result | `center-rail`, glTF node 2, object ID 3, 12 CAD edge refs | Same |
| Console warnings / errors | 0 / 0 | 0 / 0 |

| Chrome 151 / Blink | Firefox 150 / Gecko |
|---|---|
| ![Chrome WebGPU selection](chrome-151-windows-selected.png) | ![Firefox WebGPU selection](firefox-150-windows-selected.png) |

Both screenshots were visually reviewed for the canonical camera, source
colors, visible assembly occurrences, explicit CAD edges, hierarchy, statistics,
and selected-occurrence text. Minor browser font rasterization differences are
not treated as geometry differences. This run proves the first compiled-package
runtime boundary, not progressive LOD, performance, or support across additional
GPUs, operating systems, and mobile browsers.

## Reproduce

The recorder starts and stops its own Vite server, uses a fixed 1320 × 1000 CSS
viewport, verifies that hierarchy is available before the Worker requests
`scene.bin`, clicks a fixed point on the orange center rail, asserts displayed
counts and source mapping, rejects browser warnings/errors, and writes
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
Firefox build. Use `--headless` only as an additional diagnostic because it may
select a different or unavailable GPU adapter and does not replace the headed
visual record.
