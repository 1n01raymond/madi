# `@madi/runtime-webgpu`

Direct WebGPU rendering and the Phase 1 compiled glTF runtime boundary.

## Loading contract

- `inspectCompiledHierarchy(value)` validates glTF 2.0 plus
  `madi.experimental.gltf.1` metadata and returns the active occurrence tree
  without requiring geometry bytes.
- `decodeCompiledGltf(value, binary, { representation })` validates the selected
  external-buffer accessor ranges,
  decodes surface and explicit-edge streams, composes node transforms, preserves
  picking identity, and groups nodes by shared mesh.
- `compiledSceneTransferables(scene)` lists owned typed-array buffers for a
  zero-copy Worker-to-main-thread transfer.
- `MadiWebGpuRenderer` uploads those batches and renders surfaces, edges, and an
  integer object-ID picking pass directly with WebGPU.

`setSelection(objectId)` updates a small scene uniform so the selected
occurrence's surfaces and explicit edges are highlighted without repacking
prototype or occurrence buffers. Object ID zero clears selection.

Object-ID rendering is on demand: navigation frames submit surfaces and
optional explicit edges, while a click renders and reads the ID target only
when requested. The renderer also accepts a fixed pixel ratio and can omit edge
uploads so cross-backend benchmark profiles do not silently compare different
resolution or resource contracts.

For allocation-stable occurrence visibility, `updateVisibleInstances()` accepts
dense per-prototype `Int32Array` index tables and counts. It repacks visible
occurrences into reusable CPU staging storage and updates only the active prefix
of each existing GPU instance buffer; prototype geometry buffers remain intact.
Studio uses this path for hide/isolate/show-all, and render/picking passes skip
prototype batches whose visible instance count is zero.

`setSectionPlane({ normal, offset })` enables one world-space clipping plane and
keeps the half-space where `dot(normal, position) <= offset`. The renderer
normalizes the equation and applies the same fragment discard to shaded
surfaces, explicit CAD edges, and the on-demand object-ID pass. Passing
`undefined` disables clipping without rebuilding pipelines or scene buffers.

The current experimental decoder accepts a target-only package or a progressive
package with separate target and coarse external buffers. The progressive slice
uses `extras.madi.coarseMesh` and preserves node-derived object IDs while the
renderer replaces prototype AABBs with target meshes. When target chunk metadata
is present, `targetChunkId` decodes only one declared byte range and its mesh
occurrences. The browser requests those ranges sequentially, displays each
promotion before requesting the next, and falls back safely when a host returns
the complete buffer with HTTP 200. Changing scenes terminates the active Worker
and its fetch; explicit cancellation uses the same boundary. Intentional
renderer destruction does not surface as a device-loss error. Per mesh, the decoder
accepts one indexed `TRIANGLES` primitive plus at most one indexed `LINES`
primitive. It is not a general-purpose glTF loader. Unsupported profiles and
layouts fail with a typed `CompiledGltfError` instead of silently dropping
engineering data.

Run `pnpm test` for package and committed-fixture regression coverage. The
headed cross-engine path is recorded by `pnpm browser:matrix`.
