# Phase 1 compiler evidence

Two deterministic, standards-first packages cover complementary risks.

| Package | Role |
|---|---|
| `adafruit-pygamer/` | Canonical real-world electronics and browser demo fixture |
| `repeated-fasteners/` | Small MADI-authored deterministic compiler regression fixture |

Each package contains:

| Resource | Purpose |
|---|---|
| `scene.gltf` | glTF 2.0 hierarchy, shared meshes, materials, and experimental MADI `extras` |
| `scene.bin` | external little-endian geometry and source-map accessors |
| `build-report.json` | source/compiler/options identity, SHA-256 hashes, counts, diagnostics, reuse, and limits |

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

## Reproduce and validate

```sh
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
```

The first command reproduces the small regression package from committed Scene
IR. Reproducing PyGamer first requires the OCCT extraction command documented in
`artifacts/occt/README.md`; its large temporary JSON intentionally remains
outside Git. The independent evidence check validates both committed packages,
their source checksums, resource hashes, hierarchy, prototype reuse, accessor
ranges, geometry counts, and Khronos conformance.
