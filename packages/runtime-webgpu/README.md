# `@madi/runtime-webgpu`

Direct WebGPU rendering and the Phase 1 compiled glTF runtime boundary.

## Loading contract

- `inspectCompiledHierarchy(value)` validates glTF 2.0 plus
  `madi.experimental.gltf.1` metadata and returns the active occurrence tree
  without requiring geometry bytes.
- `decodeCompiledGltf(value, binary)` validates external-buffer accessor ranges,
  decodes surface and explicit-edge streams, composes node transforms, preserves
  picking identity, and groups nodes by shared mesh.
- `compiledSceneTransferables(scene)` lists owned typed-array buffers for a
  zero-copy Worker-to-main-thread transfer.
- `MadiWebGpuRenderer` uploads those batches and renders surfaces, edges, and an
  integer object-ID picking pass directly with WebGPU.

Object-ID rendering is on demand: navigation frames submit surfaces and
optional explicit edges, while a click renders and reads the ID target only
when requested. The renderer also accepts a fixed pixel ratio and can omit edge
uploads so cross-backend benchmark profiles do not silently compare different
resolution or resource contracts.

For allocation-stable visibility experiments, `updateVisibleInstances()` accepts
dense per-prototype `Int32Array` index tables and counts. It repacks visible
occurrences into reusable CPU staging storage and updates only the active prefix
of each existing GPU instance buffer; prototype geometry buffers remain intact.

The current experimental decoder accepts one external buffer and, per mesh, one
indexed `TRIANGLES` primitive plus at most one indexed `LINES` primitive. It is
not a general-purpose glTF loader. Unsupported profiles and layouts fail with a
typed `CompiledGltfError` instead of silently dropping engineering data.

Run `pnpm test` for package and committed-fixture regression coverage. The
headed cross-engine path is recorded by `pnpm browser:matrix`.
