# MADI compiler

`@madi/compiler` is the first Phase 1 source-to-Web compiler slice. Its public
CLI accepts local STEP AP242/AP214 through the OCCT Python adapter and
multi-document IFC2X3/IFC4/IFC4X3 federations through IfcOpenShell; its library
boundary accepts a validated in-memory `EngineeringScene`. These paths emit:

- `scene.gltf`: glTF 2.0 hierarchy, nodes, shared meshes, materials, and MADI
  source/identity metadata in `extras`;
- `scene.bin`: little-endian f32/u32/u8 geometry and mapping accessors; and
- `coarse.bin`: optional prototype AABB surfaces and edges for an early useful
  frame; and
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
writes `scene.gltf`, `scene.bin`, `coarse.bin`, `build-report.json`, and
`adapter-report.json`. Target geometry remains the ordinary glTF node mesh;
`extras.madi.coarseMesh` selects a bounds mesh backed only by `coarse.bin`.
`extras.madi.progressive.targetChunks` maps each reusable target prototype mesh
to a deterministic byte range in `scene.bin`, ordered by occurrence count and
then payload size. This allows ordinary HTTP Range delivery without inventing
another container or duplicating target geometry.
Its expanded Scene IR is temporary and is deleted after the package passes
validation. `phase1:compile:evidence` retains the historical small Scene IR
regression path without coarse output. The evidence check validates both plus the
canonical PyGamer package: source and resource hashes, buffer/accessor ranges,
hierarchy, prototype reuse, triangle/edge counts, and official Khronos glTF
validation.

## Compile an IFC federation

Install the separate pinned adapter environment, then repeat `--document` for
each discipline. `--uri-hint` records a stable non-sensitive source label
instead of a local machine path.

```sh
python -m venv output/venv-ifc
output/venv-ifc/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

pnpm madi compile-ifc \
  --document architecture=path/to/architecture.ifc \
  --uri-hint architecture=models/architecture.ifc \
  --document plumbing=path/to/plumbing.ifc \
  --uri-hint plumbing=models/plumbing.ifc \
  --python output/venv-ifc/Scripts/python \
  --threads 4 \
  --output output/ifc/federation
```

The command preflights every Part 21 envelope, verifies adapter/source digests,
validates the expanded Scene IR, emits the compiled package and adapter report,
and deletes Scene IR unless `--retain-scene-ir` is requested. The qualified
four-discipline result is under `artifacts/ifc/digital-hub/`.

## Current limits

- The direct STEP command currently depends on the pinned CadQuery/OCP Python
  adapter. Moving the proven extraction behavior into the native C++ adapter
  remains production hardening work.
- The IFC command currently depends on pinned IfcOpenShell 0.8.5. IFC topology
  edge classification, non-flattened property indexing, and cross-document
  reconciliation remain explicit follow-up work.
- The first coarse representation is a per-prototype AABB, not a
  shape-preserving LOD. Target ranges are prototype-granular and use a static
  initial priority; spatial partitioning, compression, view reprioritization,
  and bounded residency are not implemented.
- Geometry and node transforms are f32 in glTF; the large-coordinate precision
  profile remains an open ADR gate.
- `extras.madi` is an experimental profile, not a public interchange standard.
- The browser runtime proves coarse-first promotion on the direct AP242 package;
  the canonical PyGamer benchmark remains a monolithic target-only baseline.
