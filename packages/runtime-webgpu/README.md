# `@naru3d/runtime-webgpu`

Direct WebGPU rendering and the Phase 1 compiled glTF runtime boundary.

## Loading contract

- `inspectCompiledHierarchy(value)` validates glTF 2.0 plus
  `madi.experimental.gltf.1` metadata and returns the active occurrence tree
  without requiring geometry bytes. Hierarchy entries and pick evidence carry
  each occurrence's `semanticId` when present, and a package-level
  `extras.madi.properties` pointer (the `madi.package-properties.1` sidecar,
  `docs/COMPILER.md` section 21.2) surfaces as `hierarchy.properties`
  after shape validation — the runtime does not fetch or parse the sidecar
  itself.
- `decodeCompiledGltf(value, binary, { representation })` validates the selected
  external-buffer accessor ranges,
  decodes surface and explicit-edge streams, composes node transforms, preserves
  picking identity, and groups nodes by shared mesh.
- `compiledSceneTransferables(scene)` lists owned typed-array buffers for a
  zero-copy Worker-to-main-thread transfer.
- `NaruWebGpuRenderer` uploads those batches and renders surfaces, edges, and an
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

`render(viewProjection, { cameraOrigin })` accepts a double-precision world
origin. Decoded node transforms compose in JavaScript number precision, while
the 96-byte instance record stores translation high/low f32 components (the low
component reuses the existing alignment gap). Surface, edge, section, and pick
passes subtract a matching high/low camera origin before projection. The
project-owned 0.25 mm / 10,000 km headed Chrome/Firefox record is checked by
`pnpm precision:check`.

The current experimental decoder accepts a target-only package or a progressive
package with separate target and coarse external buffers. The progressive slice
uses `extras.madi.coarseMesh` and preserves node-derived object IDs while the
renderer replaces prototype AABBs with target meshes. When target chunk metadata
is present, `targetChunkId` decodes only one declared byte range and its mesh
occurrences. The browser requests those ranges sequentially, displays each
promotion before requesting the next, and falls back safely when a host returns
the complete buffer with HTTP 200. The Studio builds retained-coarse chunk
bounds once, ranks them in the current camera, keeps one Range/decode active at
a time, and aborts that request through the Worker when navigation makes another chunk
hotter. Changing scenes terminates the active Worker and its fetch; explicit
cancellation uses the same boundary. Intentional
renderer destruction does not surface as a device-loss error. Per mesh, the decoder
accepts one indexed `TRIANGLES` primitive plus at most one indexed `LINES`
primitive. It is not a general-purpose glTF loader. Unsupported profiles and
layouts fail with a typed `CompiledGltfError` instead of silently dropping
engineering data.

The package boundary also recognizes the optional
`extras.madi.progressive.spatialIndex` pointer and strictly decodes
`naru.spatial-demand-index.1`. The decoder preserves float64 bounds and rejects
invalid sizes, allocation limits, unreachable/cyclic nodes, duplicate
occurrence ownership, and out-of-range glTF or target-chunk references before
exposing query arrays. The Studio authenticates the SHA-256, performs a
camera-relative frustum traversal, requests only the deduplicated chunks of
visible leaves, and keeps non-demanded chunks cold for eviction. Packages
without the optional index retain aggregate retained-coarse chunk scheduling.
The indexed browser path has unit/oracle coverage but not yet a committed
headed or real-model evidence record.

Run `pnpm test` for package and committed-fixture regression coverage. The
headed cross-engine path is recorded by `pnpm browser:matrix`; the focused
large-coordinate path is recorded by `pnpm precision:evidence`.
