# Phase 1 compiler evidence

Three deterministic, standards-first packages cover complementary risks.

| Package | Role |
|---|---|
| `adafruit-pygamer/` | Canonical real-world electronics and browser demo fixture |
| `repeated-fasteners/` | Small MADI-authored deterministic compiler regression fixture |
| `repeated-fasteners-ap242/` | Direct local AP242 → OCCT → glTF compiler-entry evidence |

Each package contains:

| Resource | Purpose |
|---|---|
| `scene.gltf` | glTF 2.0 hierarchy, shared meshes, materials, and experimental MADI `extras` |
| `scene.bin` | external little-endian geometry and source-map accessors |
| `coarse.bin` | optional external prototype AABB surface/edge accessors for progressive first frame |
| `build-report.json` | source/compiler/options identity, SHA-256 hashes, counts, diagnostics, reuse, and limits |
| `adapter-report.json` | AP242 source identity, OCCT toolchain/options, extraction counts, and diagnostics (direct-input package only) |

## Canonical PyGamer result

- package digest:
  `300abb2446a19b9667cad6ed6d1e01a8178212e9f29232af233dfaa9ee2e3c4e`;
- 34 compiled part prototypes and 85 renderable occurrences;
- 26 0603 and 11 0805 occurrences each reuse one mesh;
- 162,838 unique triangles and 13,897 explicit CAD edge segments;
- 4,366,608 bytes of glTF JSON and 14,826,752 bytes of binary payload; and
- zero errors and zero warnings from Khronos glTF Validator 2.0.0-dev.3.10.

The compiled package is about 19.2 MB versus the 80.6 MB temporary Scene IR
JSON. It is still a monolithic baseline without compression, chunking, or LOD;
that gap is now measurable rather than hypothetical.

The package is marked `experimental-not-interchange`. It is standard glTF 2.0
plus an external binary and does not define a `.madi` file format.

## Direct AP242 result

`repeated-fasteners-ap242/` is produced from the checksum-locked local STEP
file by one public command. OCCT reads AP242 DIS through STEPCAF/XDE, extracts
three reusable part meshes and ten renderable occurrences, and the compiler
emits 2,076 triangles plus 181 explicit CAD edge segments. The expanded Scene
IR exists only in a temporary directory and is removed after validation. Its
2.7 KiB `coarse.bin` contains 36 triangles and 36 edge segments across three
shared prototype bounds; `scene.bin` remains the 183.6 KiB target payload. Its
three prototype ranges cover that file without overlap: the occurrence-heavy
fastener geometry is scheduled first, followed by the mounting plate and rail.

## Reproduce and validate

```sh
pnpm phase1:compile:evidence
pnpm madi compile fixtures/step/repeated-fasteners-ap242.step \
  --output output/repeated-fasteners-ap242
pnpm phase1:evidence:check
```

The first command reproduces the small regression package from committed Scene
IR. Reproducing PyGamer first requires the OCCT extraction command documented in
`artifacts/occt/README.md`; its large temporary JSON intentionally remains
outside Git. The independent evidence check validates both committed packages,
their source checksums, resource hashes, hierarchy, prototype reuse, accessor
ranges, geometry counts, and Khronos conformance.
