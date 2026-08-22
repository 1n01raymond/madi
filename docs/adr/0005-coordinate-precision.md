# ADR-0005: Use hierarchical local coordinates and camera-relative rendering

Status: Proposed
Reviewed: 2026-08-23

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

Phase 0 establishes only the structural path: Scene IR can retain positions and
transforms in double precision, while the evidence renderer creates local f32
GPU buffers. It does not yet implement camera-relative origin subtraction or
exercise site-scale offsets.

This ADR therefore remains Proposed. Acceptance requires visual and measurement
tests that place millimeter details at large coordinate offsets and compare
jitter/error while the camera moves.
