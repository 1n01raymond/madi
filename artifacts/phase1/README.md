# Phase 1 compiler evidence

`repeated-fasteners/` is the first deterministic, standards-first compiled
package produced from the committed OCCT Scene IR evidence.

| Resource | Purpose |
|---|---|
| `scene.gltf` | glTF 2.0 hierarchy, shared meshes, materials, and experimental MADI `extras` |
| `scene.bin` | external little-endian geometry and source-map accessors |
| `build-report.json` | source/compiler/options identity, SHA-256 hashes, counts, diagnostics, reuse, and limits |

## Recorded result

- package digest: `f8116762c49651d89c7c4f18770da80dc007f194057126462313ba9ea57d1566`;
- 3 compiled part prototypes and 10 renderable occurrences;
- 8 fastener nodes reference one mesh;
- 2,076 unique triangles and 181 explicit CAD edge segments;
- 53,211 bytes of glTF JSON and 188,044 bytes of binary payload; and
- zero errors and zero warnings from Khronos glTF Validator 2.0.0-dev.3.10.

The package is evidence for the compiler/runtime boundary. It is explicitly
marked `experimental-not-interchange` and does not define a `.madi` file format.

## Reproduce

```sh
pnpm phase1:compile:evidence
pnpm phase1:evidence:check
```

The compiler output is byte-identical for identical Scene IR and options. Unit
tests compile the source twice and compare the JSON, binary payload, and report.
