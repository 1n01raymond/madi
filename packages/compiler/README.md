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
`extras.madi.progressive.targetChunks` maps reusable target prototype meshes to
deterministic byte ranges in `scene.bin`, ordered by occurrence count and then
payload size. The IFC command coalesces adjacent prototype ranges into 512 KiB
requests by default; an oversized individual prototype stays whole rather than
splitting its accessors. Use `--target-chunk-kib` to change that budget. This
allows ordinary HTTP Range delivery without inventing another container or
duplicating target geometry.
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
  --target-chunk-kib 512 \
  --output output/ifc/federation
```

The command preflights every Part 21 envelope, verifies adapter/source digests,
validates the intermediate Scene IR, emits the compiled package and adapter
report, and deletes Scene IR unless `--retain-scene-ir` is requested. The
qualified four-discipline result is under `artifacts/ifc/digital-hub/`.

### Split Scene IR transport

The IFC adapter does not hand back one expanded JSON document. It writes a
structure-only JSON file whose representation surfaces hold
`{encoding, byteOffset, byteLength}` references into a separate little-endian
geometry file, and reports a SHA-256 for each half. The compiler verifies both
digests and then resolves the references into typed-array views without copying
the coordinate data.

This keeps the structure document far below the JavaScript maximum string
length that a real-large federation otherwise exceeds, and it removes the
decimal round-trip for every coordinate. The observable `EngineeringScene`
contract is unchanged, so the split exists only between the adapter and the
compiler. `--retain-scene-ir` therefore writes both `scene-ir.json` and
`scene-ir-geometry.bin`; the JSON alone is not a loadable scene.

## Current limits

- The direct STEP command currently depends on the pinned CadQuery/OCP Python
  adapter. Moving the proven extraction behavior into the native C++ adapter
  remains production hardening work.
- The IFC command currently depends on pinned IfcOpenShell 0.8.5. IFC topology
  edge classification, non-flattened property indexing, and cross-document
  reconciliation remain explicit follow-up work. A degenerate source
  `IfcAxis2Placement` (zero-length or parallel axes) is replaced with an
  identity transform and reported as `IFC_DEGENERATE_PLACEMENT`; the adapter
  never hands the compiler a non-finite matrix
  (`native/adapter-ifc/README.md`).
- The split transport moves geometry out of the structure document but still
  parses that document as one JSON string, and it requires a little-endian
  host. Streaming the structure and encoding flattened properties as binary
  streams remain follow-up work.
- The first coarse representation is a per-prototype AABB, not a
  shape-preserving LOD. IFC target ranges are coalesced with a static initial
  priority; spatial partitioning, compression, and view reprioritization are
  still pending. The browser applies a fixed decoded/GPU admission budget and
  retains coarse fallbacks when it reaches that cap; eviction and cache policy
  are Phase 2 follow-up work.
- Geometry and node transforms are f32 in glTF; the large-coordinate precision
  profile remains an open ADR gate.
- `extras.madi` is an experimental profile, not a public interchange standard.
- The browser runtime proves coarse-first promotion on the direct AP242 package;
  the canonical PyGamer benchmark remains a monolithic target-only baseline.
