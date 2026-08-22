# MADI compiler

`@madi/compiler` is the first Phase 1 source-independent compiler slice. It
accepts a validated in-memory `EngineeringScene` and emits:

- `scene.gltf`: glTF 2.0 hierarchy, nodes, shared meshes, materials, and MADI
  source/identity metadata in `extras`;
- `scene.bin`: little-endian f32/u32/u8 geometry and mapping accessors; and
- `build-report.json`: source/compiler identity, options, hashes, counts,
  diagnostics, reuse, and known limits.

The geometry contract follows the
[Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html):
triangle primitives use mode 4, explicit CAD edge line lists use mode 1, and
multiple occurrence nodes may reference one mesh. The profile does not require
a custom glTF extension. MADI-specific data uses standard `extras` while the
interoperability requirements are measured.

## Reproduce the committed slice

From the repository root:

```sh
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
pnpm test
```

The first command compiles the small committed OCCT Scene IR regression into
`artifacts/phase1/repeated-fasteners`. The second independently checks that
package and the canonical `artifacts/phase1/adafruit-pygamer` package: source
and resource hashes, buffer/accessor ranges, hierarchy, prototype reuse,
triangle/edge counts, and official Khronos glTF validation.

## Current limits

- The executable CLI hydrates Phase 0 evidence JSON only; the production entry
  point will receive Scene IR directly from source adapters.
- One target display representation is emitted. Coarse LOD, progressive
  partitioning, compression, and streaming manifests are not implemented.
- Geometry and node transforms are f32 in glTF; the large-coordinate precision
  profile remains an open ADR gate.
- `extras.madi` is an experimental profile, not a public interchange standard.
- The browser runtime directly consumes the canonical PyGamer package; coarse
  LOD and progressive partitioning are still pending.
