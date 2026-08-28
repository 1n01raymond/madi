# ADR-0005: Use hierarchical local coordinates and camera-relative rendering

Status: Accepted
Accepted: 2026-08-26

## Context

Engineering scenes may combine sub-millimeter details with site or geospatial
coordinates. Browser JavaScript can retain double precision, while common WGSL
render paths use 32-bit floating point. Uploading large world coordinates as f32
causes visible jitter and measurement instability.

## Decision

- Preserve source/workspace transforms and bounds in double precision on CPU.
- Store prototype/chunk vertices in local coordinate systems.
- Quantize only with explicit error bounds.
- Compose transforms in double precision and subtract a camera-relative origin
  before GPU f32 use.
- Carry units, CRS, handedness, and up-axis metadata explicitly.
- Require plugins and APIs to name coordinate spaces.

## Consequences

### Positive

- Stable rendering across large coordinate extents.
- Better quantization and compression in local frames.
- Clear accuracy accounting.

### Negative

- More coordinate transforms and API discipline.
- Multi-source composition requires careful high-precision alignment.
- Some GPU algorithms need local/frame-aware variants.

## Alternatives considered

- Upload source positions directly as f32.
- Emulate f64 universally in shaders.
- Recenter source files destructively during import.

## Validation

The committed ADR record places two 40 mm × 60 mm project-owned plates with a
0.25 mm gap both near the origin and at
`[10,000,000, -7,000,000, 3,000,000]` metres. A naive f32 translation collapses
the far plate centres to the same value: the calculated gap becomes −40 mm and
the f32 ULP at the far X coordinate is 1 metre.

The implemented path instead:

- retains Scene IR and composed runtime transforms as JavaScript numbers;
- keeps local prototype vertices and transform linear components as f32;
- retains compiler-delivered translations when f32 error exceeds 10 nm;
- splits instance translations and the camera origin into f32 high/low pairs;
- rebases section planes into the same camera-relative frame; and
- shares that vertex path across surfaces, explicit edges, and object-ID picking.

The far compiled package measures the gap as 0.249999613 mm, an absolute error
of 0.000000387 mm against the 0.001 mm acceptance budget. Khronos validation
reports zero errors and warnings. On the reviewed Apple-Silicon host, headed
Chrome 151/Blink and Firefox 150/Gecko each produce byte-identical near/far
canvas captures before navigation, after a fixed orbit/pan/zoom trace, and after
an X section. Both retain the same picked occurrence and emit no console issues.

The record, screenshots, package digests, recorder, and strict validator are in
[`artifacts/precision/large-coordinates/`](../../artifacts/precision/large-coordinates/README.md)
and run through `pnpm precision:check`. This accepts the coordinate strategy for
the implemented tessellated display path. It does not claim source-exact B-Rep
measurement, all coordinate reference systems, or Safari rendering support;
the current real Safari 26.6.1 capability record on macOS Sequoia still has no
`navigator.gpu` under default settings.
