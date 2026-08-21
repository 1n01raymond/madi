# Planned third-party dependencies

This file records architectural intent, not a final bill of materials.

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
