# NARU compiler

`@naru3d/compiler` is the first Phase 1 source-to-Web compiler slice. Its public
CLI accepts local STEP AP242/AP214 through the OCCT Python adapter and
multi-document IFC2X3/IFC4/IFC4X3 federations through IfcOpenShell; its library
boundary accepts a validated in-memory `EngineeringScene`. These paths emit:

- `scene.gltf`: glTF 2.0 hierarchy, nodes, shared meshes, materials, and NARU
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
a custom glTF extension. NARU-specific data uses standard `extras` while the
interoperability requirements are measured.

## Reproduce the committed slice

From the repository root:

```sh
python -m pip install -r native/adapter-occt/tools/requirements-evidence.txt
pnpm naru compile fixtures/step/repeated-fasteners-ap242.step \
  --output output/repeated-fasteners-ap242
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
pnpm test
```

The `naru compile` command reads the checksum-locked AP242 assembly through
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

### Persistent compiled-cache foundation

`src/compiled-cache.ts` starts the first priority in the
[import/cache product contract](../../docs/IMPORT_AND_CACHE.md). It derives a
deterministic key from source digests, adapter/compiler identities, and sorted
compile options; publishes immutable flat package resources atomically; and
verifies every byte count and SHA-256 before an atomic restore. Cache corruption
fails before the requested output directory is created.

The STEP path opts in with `--cache <directory>`. Before lookup, the OCCT
adapter's `--identity` reports a fingerprint over its implementation, pinned
CadQuery/OCP versions, Python, OS, and architecture; compiler identity similarly
includes Node and host class until cross-platform determinism is proven. A
verified hit reuses matching output or restores the package without running
source extraction; a miss compiles normally and publishes only after package
validation. The IFC command still invokes its adapter on every run;
IFC identity/integration, cold/warm evidence, incremental federation
dependencies, and shared-cache authorization remain follow-up gates.

## Compile an IFC federation

Install the separate pinned adapter environment, then repeat `--document` for
each discipline. `--uri-hint` records a stable non-sensitive source label
instead of a local machine path.

```sh
python -m venv output/venv-ifc
output/venv-ifc/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

pnpm naru compile-ifc \
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
geometry file, plus a binary property value column file, and reports a SHA-256
for each of the three. The compiler verifies the digests and then resolves the
references into typed-array views without copying the coordinate data.

This removes the decimal round-trip for every coordinate, and the compiler
never holds the structure document as one string either: a record-streaming
reader (`src/ifc-structure-stream.ts`) walks the file in bounded chunks and
parses one record at a time, so a structure above the JavaScript maximum
string length compiles the same way a small one does (the sixty5 federation's
split.1 structure measured 631.9 MB against the 536,870,888 code-unit ceiling;
property indexing has since brought it to 419.5 MB, and the reader still
protects against any future crossing). Since `madi.ifc-scene-ir-split.2` the
structure also interns property keys and key combinations once into a
scene-level `propertyIndex` instead of repeating key text per entity, and
since `madi.ifc-scene-ir-split.3` the property values themselves live in a
third binary column file (`madi.property-columns.1`): each semantic entity
carries only `{set, row}`, and the compiler checks every row's arity against
its interned key set through typed-array views without materializing a single
value (values decode lazily through `resolvePropertyEntries` /
`openPropertyValueColumns` in `@naru3d/scene-ir`). The observable
`EngineeringScene` contract is unchanged apart from those tables, so the split
exists only between the adapter and its consumers. `--retain-scene-ir`
therefore writes `scene-ir.json`, `scene-ir-geometry.bin`, and
`scene-ir-properties.bin`; the JSON alone is not a loadable scene.

`naru.ifc-scene-ir-split.4` adds explicit OpenCascade face-boundary streams.
Edge positions may alias the surface position range; indices, boundary classes,
and IFC representation-item source ids remain separate typed-array views. The
compiler still accepts historical split.3 reports so existing Digital Hub,
sixty5, and public-demo packages remain reproducible. The focused split.4
record is checked by `pnpm ifc:edges:check`.

### Package property sidecar

A compiled package built from a column-bag scene republishes the properties as
two additional package resources (`docs/COMPILER.md` section 21.2):
`properties.bin` — the adapter column file byte for byte — and
`properties.json`, a `madi.package-properties.1` document holding the interned
property index plus a sorted columnar semantic table, parsed and validated by
`parsePackageProperties` in `@naru3d/scene-ir`. `scene.gltf` points at the
sidecar through `extras.madi.properties`, both resources join
`output.resources` and the package digest, and `compileSceneToGltf` refuses a
column-bag scene without `options.propertyColumns` (and the reverse). Inline
`PropertyBag` scenes — the STEP path — emit no sidecar and are byte-identical
to before; the glTF profile and report schema are unchanged.

## Current limits

- The direct STEP command currently depends on the pinned CadQuery/OCP Python
  adapter. Moving the proven extraction behavior into the native C++ adapter
  remains production hardening work.
- The IFC command currently depends on pinned IfcOpenShell 0.8.5. IFC topology
  edge classification and cross-document reconciliation remain explicit
  follow-up work. A degenerate source
  `IfcAxis2Placement` (zero-length or parallel axes) is replaced with an
  identity transform and reported as `IFC_DEGENERATE_PLACEMENT`; the adapter
  never hands the compiler a non-finite matrix
  (`native/adapter-ifc/README.md`).
- The split transport requires a little-endian host. The structure document
  streams record by record, property keys are interned, and property values
  stay in the binary column file — the hydrated scene never materializes them
  — but the occurrence and semantic records themselves stay resident during
  compilation. The largest recorded compile — the sixty5 federation with
  4,503,078 property values (`artifacts/ifc/sixty5/`) — peaked at
  3,845,181,440 bytes (≈3.6 GB, sampled at 2 s intervals) compiler working
  set inside the default 64-bit Node 22 heap with no `--max-old-space-size`
  override (4,043,804,672 bytes on the split.1 631.9 MB structure, commit
  `41e6973`); expect peak memory to scale with occurrence and semantic record
  counts, not with geometry bytes.
- The first coarse representation is a per-prototype AABB, not a
  shape-preserving LOD. IFC target ranges are coalesced with a static initial
  priority; spatial partitioning, compression, and view reprioritization are
  still pending. The browser applies a fixed decoded/GPU admission budget and
  retains coarse fallbacks when it reaches that cap; eviction and cache policy
  are Phase 2 follow-up work.
- Local geometry and transform linear components are f32. Node translations
  stay as ordinary glTF JSON numbers when f32 delivery error would exceed the
  10 nm budget, allowing the NARU loader to compose and camera-rebase them in
  JavaScript number precision. The 0.25 mm / 10,000 km ADR-0005 record is
  checked by `pnpm precision:check`.
- `extras.madi` is an experimental profile, not a public interchange standard.
- The browser runtime proves coarse-first promotion on the direct AP242 package;
  the canonical PyGamer benchmark remains a monolithic target-only baseline.
