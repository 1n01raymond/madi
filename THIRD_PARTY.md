# Third-party dependencies

This file records current bootstrap tooling and architectural intent. The
lockfile is the exact dependency inventory; `pnpm licenses list` reports the
resolved license set.

## Phase 0 TypeScript toolchain

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

Versions are pinned in `package.json` and `pnpm-lock.yaml`. Updates must pass
the complete check and browser smoke path and must not introduce an incompatible
runtime license.

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
