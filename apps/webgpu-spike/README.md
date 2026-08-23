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

progressive package
  └─ coarse.bin → first WebGPU frame
       └─ scene.bin Range chunks → coalesced-request promotion
            └─ stable GPU batch reconciliation → bounded residency admission
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

To serve another locally compiled package as `/scene.gltf`, set
`MADI_SCENE_DIR` to an absolute path or a repository-relative directory before
starting Vite. For example, in PowerShell:

```powershell
$env:MADI_SCENE_DIR = "output/ifc/digital-hub"
pnpm dev
```

The runtime preserves one pickable occurrence ID across material-separated
surface batches. IFC compilation coalesces adjacent prototype ranges into
deterministic requests (512 KiB by default) and the runtime reconciles them by
stable batch key, so an arriving request does not re-upload every existing
batch. The browser enforces separate 64 MiB decoded and GPU admission budgets.
It keeps the coarse fallback for every promoted target group. When a selected
occurrence needs detail under pressure, the runtime pins that target and
replaces colder target groups with their retained coarse batches; visibility
intent and stable object IDs survive the batch update. Add `?residencyMiB=5`
to force a small budget during local exploration. Persistent cache tiers and
camera-driven reprioritization remain Phase 2 work.

## Open another compiled scene

Use **Open URL** for an HTTP(S) `scene.gltf`. A successful URL is retained in
the page's `?scene=` query so the view can be reopened or shared; the remote
host must allow cross-origin requests for both the glTF and its external binary.

Use **Open local package** to select exactly one MADI-profile `.gltf` and all of
its external `.bin` resources. The browser validates each declared file name
and byte length before sending local `File` objects to the geometry Worker.
Local files stay on the client and do not create a shareable URL. This is a
compiled scene workflow; direct STEP AP242/AP214 input belongs to the compiler.
For progressive packages, local `File.slice()` provides the same target chunk
boundary without network requests. **Cancel** aborts the active hierarchy or
geometry load, terminates its Worker, and prevents later target ranges from
starting.
