# MADI compiler

`@madi/compiler` is the first Phase 1 source-to-Web compiler slice. Its public
CLI accepts local STEP AP242 or AP214 through the OCCT Python adapter; its
library boundary accepts a validated in-memory `EngineeringScene`. Both emit:

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
python -m pip install -r native/adapter-occt/tools/requirements-evidence.txt
pnpm madi compile fixtures/step/repeated-fasteners-ap242.step \
  --output output/repeated-fasteners-ap242
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
pnpm test
```

The `madi compile` command reads the checksum-locked AP242 assembly through
OCCT STEPCAF/XDE, validates source identity across the adapter boundary, and
writes `scene.gltf`, `scene.bin`, `build-report.json`, and
`adapter-report.json`. Its expanded Scene IR is temporary and is deleted after
the package passes validation. `phase1:compile:evidence` retains the historical
small Scene IR regression path. The evidence check validates both plus the
canonical PyGamer package: source and resource hashes, buffer/accessor ranges,
hierarchy, prototype reuse, triangle/edge counts, and official Khronos glTF
validation.

## Current limits

- The direct STEP command currently depends on the pinned CadQuery/OCP Python
  adapter. Moving the proven extraction behavior into the native C++ adapter
  remains production hardening work.
- One target display representation is emitted. Coarse LOD, progressive
  partitioning, compression, and streaming manifests are not implemented.
- Geometry and node transforms are f32 in glTF; the large-coordinate precision
  profile remains an open ADR gate.
- `extras.madi` is an experimental profile, not a public interchange standard.
- The browser runtime directly consumes the canonical PyGamer package; coarse
  LOD and progressive partitioning are still pending.
