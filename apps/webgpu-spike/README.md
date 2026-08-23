# MADI compiled-scene browser proof

This Vite app is the current Phase 1 runtime evidence, despite the historical
`webgpu-spike` directory name. It deliberately does not fetch the Phase 0 Scene
IR JSON.

```text
scene.gltf
  └─ main thread: validate profile, expose hierarchy and source identity
scene.bin
  └─ Worker: validate accessors, decode shared typed-array batches
       └─ direct WebGPU: surfaces, explicit CAD edges, object-ID picking
            └─ Studio slice: orbit/pan/zoom/fit + synchronized selection
```

Run it with `pnpm dev`. Use `pnpm browser:matrix` for the reproducible headed
Chrome and Firefox visual/picking check. The default scene is the canonical
MIT-licensed Adafruit PyGamer electronics assembly: 34 shared meshes, 85 part
occurrences, 162,838 triangles, 13,897 explicit CAD edge segments, and direct
joystick-to-source picking. Drag to orbit, Shift-drag or middle-drag to pan,
use the wheel to zoom, and press `F` to fit the current view. Selecting from the
viewport or hierarchy highlights the same occurrence and preserves its source
identity. `H` hides the selection, `I` isolates it, and `Shift+H` restores all
occurrences. These actions compact stable per-prototype visibility tables into
existing instance buffers rather than rebuilding scene resources. Adafruit does
not endorse MADI. Press `C` to enable one world-space section plane; choose its
X/Y/Z axis, drag the normalized position, or flip the retained side. Surfaces,
explicit edges, and GPU picking share the same clipping equation.

The Scene Inspector searches hierarchy names, occurrence/prototype IDs, and
source references as soon as `scene.gltf` is available; geometry residency is
not required. Press `/` to focus search and Enter to select its first renderable
result. Viewport, tree, and search selection populate the same source-identity
property panel, including glTF node/object IDs and a bounded preview of
revision-local CAD edge references.

## Open another compiled scene

Use **Open URL** for an HTTP(S) `scene.gltf`. A successful URL is retained in
the page's `?scene=` query so the view can be reopened or shared; the remote
host must allow cross-origin requests for both the glTF and its external binary.

Use **Open local pair** to select exactly one MADI-profile `.gltf` and the
matching external `.bin`. The browser validates the declared binary file name
and byte length before sending the local `File` to the geometry Worker. Local
files stay on the client and do not create a shareable URL. This is a compiled
scene workflow, not direct STEP import; local STEP AP242 input remains a
compiler milestone.
