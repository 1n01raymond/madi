# Third-party dependencies

This file records current bootstrap tooling and architectural intent. The
lockfile is the exact dependency inventory; `pnpm licenses list` reports the
resolved license set.

## TypeScript toolchain

These are development/build dependencies and are not shipped as an OCCT or
browser runtime bundle by themselves.

| Dependency | Version | License | Purpose |
|---|---:|---|---|
| TypeScript | 6.0.3 | Apache-2.0 | strict package compilation |
| Vite | 8.2.2 | MIT | WebGPU spike development and production build |
| Vitest | 4.1.11 | MIT | unit tests |
| ESLint / `@eslint/js` | 10.9.0 / 10.0.1 | MIT | static analysis |
| `typescript-eslint` | 8.67.0 | MIT | TypeScript lint integration |
| `@webgpu/types` | 0.1.72 | BSD-3-Clause | WebGPU API declarations |
| Khronos `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 | official glTF 2.0 schema and binary validation for compiler evidence |

Versions are pinned in `package.json` and `pnpm-lock.yaml`. Updates must pass
the complete check and browser smoke path and must not introduce an incompatible
runtime license.

## STEP fixture authoring tools

These tools generated the committed Phase 0 STEP fixtures. They are not pnpm
dependencies, are not required by normal CI, and are not bundled into MADI.

| Dependency | Version | Package license | Purpose |
|---|---:|---|---|
| CadQuery | 2.8.0 | Apache-2.0 | authored and exported the synthetic B-rep and assembly fixtures |
| `cadquery-ocp` | 7.9.3.1.1 | Apache-2.0 package metadata | Python OCCT binding used by CadQuery during fixture generation |

The generated models and generator source are original MADI contributions under
Apache-2.0. Their provenance, exact checksums, and regeneration policy are in
`fixtures/step/`.

## Third-party STEP fixture

`fixtures/step/adafruit-pygamer.step` is an unmodified copy of the Adafruit
PyGamer CAD assembly from `adafruit/Adafruit_CAD_Parts`, pinned to commit
`a94289fc02e7312f11647eb5e68f5c5ec06cabb6`. It remains copyright Adafruit
Industries and is redistributed under the MIT License. The full notice is in
`fixtures/step/licenses/adafruit-cad-parts-MIT.txt`; the source URL, license URL,
artifact path, and SHA-256 digest are locked in the fixture manifest. Adafruit
does not endorse MADI.

## Open CASCADE Technology

The initial STEP/IGES adapter is expected to use Open CASCADE Technology
(OCCT). OCCT is licensed under LGPL-2.1 with an additional exception. The
adapter and distribution process must preserve required notices and make the
license available to recipients. OCCT types must not cross the neutral adapter
boundary into the browser runtime API.

## TypeGPU and WebGPU

TypeGPU is being evaluated as a type-safe implementation aid for WebGPU buffer
schemas and shaders. It is not part of the serialized scene contract. Runtime
code must retain a narrow abstraction over raw WebGPU so that TypeGPU can be
upgraded or replaced without invalidating caches or public scene semantics.

## Candidate codecs and standards

- glTF 2.x and relevant extensions;
- 3D Tiles spatial and metadata concepts;
- meshoptimizer / EXT_meshopt_compression;
- Draco where its decode and random-access trade-offs are favorable;
- KTX2 / Basis Universal for textures; and
- a schema library such as FlatBuffers only after the logical IR stabilizes.

Every dependency added to implementation must be recorded with version,
license, distribution obligations, security update path, and browser/native
footprint.
