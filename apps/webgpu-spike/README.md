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

The assembly tree is virtualized: only the rows its scrollport covers exist as
elements, and the rest of the list is two spacers. The sixty5 federation has
188,319 rows, which used to be 565,134 elements; a host with accessibility mode
enabled then spent minutes walking that tree before the first frame could be
painted, because the browser process stops servicing its own network sockets
while it does. Arrow, Home, and End move a roving focus across the whole list
rather than the rendered window, so keyboard and screen-reader users still
reach every row, and search, review visibility, and picked-row reveal all
address rows by position. Row names ellipsize instead of wrapping, so every row
is the same height and the window arithmetic
(`apps/webgpu-spike/src/hierarchy-list.ts`, `pnpm test`) stays exact. The
measured effect on the sixty5 first frame is in
`artifacts/ifc/sixty5-first-frame/README.md`.

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
surface batches. One session Worker validates the glTF document, composes its
float64 world transforms, and indexes target-chunk occurrence membership once.
Every later Range decode reuses that state and visits only the selected chunk's
renderable occurrences; transferred results clone only their occurrence
transforms so the prepared state remains attached. Chunk decode responses omit
the document hierarchy — it crosses the Worker boundary once and the decoder
reattaches its cached copy, so per-admission messages carry only the chunk's
own batches. Prototype-local surface
bounds are cached once and only eight corners are transformed per occurrence,
rather than rescanning every vertex. IFC compilation coalesces adjacent prototype ranges
into deterministic requests (512 KiB by default), while the existing
`prototype-aabb-v1` tier is collapsed at runtime into one canonical box batch
with contiguous occurrence transforms. The browser enforces separate 64 MiB
decoded and GPU admission budgets. Promoted targets mask matching coarse
instances; evicting colder target groups reveals those shared fallbacks again,
so visibility intent and stable object IDs survive every batch update. An
admission is delta-priced end to end: residency totals update incrementally,
visibility tables of unchanged batches are reused by object identity (only the
shared coarse mask and new batches recompute), and the renderer re-packs and
re-uploads instance buffers for the changed batches only. Target
promotion reuses the hierarchy's node lookup and does not rescan DOM visibility
markers because residency changes no user visibility intent. Add
`?residencyMiB=5` to force a small budget during local exploration. Orbit,
pan, zoom, fit, and resize rank visible retained-coarse chunk bounds by distance
from the view center. If the hottest nonresident chunk
changes, the scheduler aborts the obsolete HTTP Range and Worker decode before
starting its replacement; the same order re-ranks eviction priority. An
unchanged camera does not retry a demand signature already blocked by the
residency budget. Before a range is requested at all, the chunk's measured
decoded and GPU cost is tested against the budget: a chunk that cannot fit the
free headroom, and for which no colder unpinned group could be evicted, is
skipped without a transfer or a decode. The gate refuses only what admission
would certainly reject, so the resident set is unchanged; `data-target-scheduler-skips`
counts the skipped chunks beside `data-target-scheduler-requests`. Both that
price and the resident charge count a prototype's vertex pool once however many
material groups read it, which is what lets a large multi-material prototype be
admitted at all: the largest sixty5 chunk cost 75,373,776 bytes when each group
kept its own copy of one 673,080-byte pool. Packages
with `naru.spatial-demand-index.1` instead authenticate `spatial.bin`, query
only frustum-visible BVH leaves, and keep cold chunks out of the fetch queue.
The focused headed record plus Digital Hub and sixty5 offline co-demand
censuses and their headed localized camera traces are under
`artifacts/spatial-demand/`. Persistent cache tiers, spatial draw clusters, and
screen-space LOD remain Phase 2 work.

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
