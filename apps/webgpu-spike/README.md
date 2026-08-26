# NARU compiled-scene browser proof

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
  └─ coarse.bin → one shared canonical-box batch → first WebGPU frame
       └─ retained coarse chunk bounds → current-view ranking
            └─ scene.bin Range chunks → cancellable Worker decode
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
not endorse NARU. Press `C` to enable one world-space section plane; choose its
X/Y/Z axis, drag the normalized position, or flip the retained side. Surfaces,
explicit edges, and GPU picking share the same clipping equation.

The camera chooses a JavaScript-number origin for every frame and sends a
camera-relative f32 projection plus that origin to the renderer. This keeps the
same review controls and section equation stable for site-scale transforms; the
committed ADR-0005 record compares a 0.25 mm gap at the origin and 10,000 km
away through headed Chrome and Firefox (`pnpm precision:check`).

The [public Studio demo](https://1n01raymond.github.io/naru/) serves the
qualified Digital Hub IFC federation by default, with PyGamer available as a
secondary scene. Its deployment verifies the Digital Hub package digests
before publishing, then checks the live Studio assets, every declared package
resource, and binary HTTP Range delivery with `pnpm demo:smoke`.

The Scene Inspector searches hierarchy names, occurrence/prototype IDs, and
source references as soon as `scene.gltf` is available; geometry residency is
not required. Press `/` to focus search and Enter to select its first renderable
result. Viewport, tree, and search selection populate the same source-identity
property panel, including glTF node/object IDs and a bounded preview of
revision-local CAD edge references.

When the package carries the property sidecar (`properties.json` +
`properties.bin`, `docs/COMPILER.md` section 21.2), selecting an occurrence
also resolves its IFC property sets: the sidecar is fetched lazily on the
first selection, validated once, and each lookup decodes only the selected
occurrence's rows through `resolvePropertyEntries`. Search deliberately does
not index property values in Phase 1 — it stays hierarchy-metadata-only, and
property resolution stays selection-driven so the 31.2 MB sixty5 column file
is never scanned wholesale on the main thread.

To serve another locally compiled package as `/scene.gltf`, set
`NARU_SCENE_DIR` to an absolute path or a repository-relative directory before
starting Vite. For example, in PowerShell:

```powershell
$env:NARU_SCENE_DIR = "output/ifc/digital-hub"
pnpm dev
```

The runtime preserves one pickable occurrence ID across material-separated
surface batches. One session Worker parses the glTF document once and reuses it
for every geometry request. IFC compilation coalesces adjacent prototype ranges
into deterministic requests (512 KiB by default), while the existing
`prototype-aabb-v1` tier is collapsed at runtime into one canonical box batch
with contiguous occurrence transforms. The browser enforces separate 64 MiB
decoded and GPU admission budgets. Promoted targets mask matching coarse
instances; evicting colder target groups reveals those shared fallbacks again,
so visibility intent and stable object IDs survive every batch update. Add
`?residencyMiB=5` to force a small budget during local exploration. Orbit,
pan, zoom, fit, and resize rank visible retained-coarse chunk bounds by distance
from the view center. If the hottest nonresident chunk
changes, the scheduler aborts the obsolete HTTP Range and Worker decode before
starting its replacement; the same order re-ranks eviction priority. Packages
with `naru.spatial-demand-index.1` instead authenticate `spatial.bin`, query
only frustum-visible BVH leaves, and keep cold chunks out of the fetch queue.
The focused headed record is `artifacts/spatial-demand/`. Persistent cache
tiers, spatial draw clusters, screen-space LOD, and real-model indexed evidence
remain Phase 2 work.

## Open another compiled scene

Use **Open URL** for an HTTP(S) `scene.gltf`. A successful URL is retained in
the page's `?scene=` query so the view can be reopened or shared; the remote
host must allow cross-origin requests for both the glTF and its external binary.

Use **Open local package** to select exactly one NARU-profile `.gltf` and all of
its external `.bin` and `.json` resources (including the optional
`properties.json` / `properties.bin` sidecar pair and `spatial.bin`). The browser validates each
declared file name and byte length before sending local `File` objects to the
geometry Worker.
Local files stay on the client and do not create a shareable URL. This is a
compiled scene workflow; direct STEP AP242/AP214 input belongs to the compiler.
For progressive packages, local `File.slice()` provides the same target chunk
boundary without network requests. **Cancel** aborts the active hierarchy or
geometry load, terminates its Worker, and prevents later target ranges from
starting.
