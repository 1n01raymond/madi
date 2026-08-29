# What a relocated assembly tree does in a browser

Status: recorded product evidence; closes the browser gate ADR-0017 left open.

[ADR-0017](../../../docs/adr/0017-relocated-hierarchy-sidecar.md) added
`--relocate-hierarchy-nodes`, which writes a federation's mesh-less nodes into
a package sidecar (`hierarchy.json` + `hierarchy.bin`,
`naru.package-hierarchy.1`) instead of into `scene.gltf`. The offline record
([`artifacts/compiler/hierarchy-relocation`](../../compiler/hierarchy-relocation/README.md))
measured the bytes: the document loses about 22%, the whole package only about
2.6%, because the tree is carried, not deleted. That left the question the ADR
stayed Proposed on — whether a smaller document is *faster to open* at
federation scale, and what the sidecar costs to fetch — for a browser to
answer.

This record answers it on the sixty5 federation (78,173 occurrences).

## Method

Two packages compiled from the same retained Scene IR split differ in one
thing: whether the mesh-less nodes live in the document or in the sidecar.
`scene.bin`, `coarse.bin`, `properties.json`, and `properties.bin` are
**byte-identical** between them — the validator checks each digest — so a
difference measured here is relocation and nothing else.

Each sample spawns the committed browser recorder
(`scripts/record-ifc-browser-evidence.mjs`) in a fresh process: fresh Vite,
fresh headed Chrome 151.0.7922.139, viewport 1320x1000. Three runs per arm,
interleaved, so host drift cannot accumulate against one arm. Medians are the
lower median of three, so every figure below is one of the runs.

## What it changes

| Median of 3 | In place | Relocated | Change |
|---|---:|---:|---:|
| Hierarchy ready | 2,220 ms | 2,191 ms | −29 ms (−1.31%) |
| **First coarse frame** | **4,408 ms** | **3,703 ms** | **−705 ms (−15.99%)** |
| Budget-limited ready | 9,687 ms | 8,987 ms | −700 ms (−7.23%) |
| Peak JS heap | 839,726,321 B | 669,299,303 B | −170,427,018 B (−20.30%) |

Per run (hierarchy / first frame / ready, ms):

- in place — 2,254 / 4,408 / 9,774 · 2,220 / 4,431 / 9,621 · 2,182 / 4,369 / 9,687
- relocated — 2,198 / 3,703 / 8,511 · 2,168 / 3,695 / 8,987 · 2,191 / 3,790 / 9,086

The two arms' spreads do not overlap on first frame or on heap. Hierarchy-ready
barely moves, which is the honest reading: the tree still has to be read before
the panel can list it, and reading it from a sidecar costs about what reading it
from the document did.

## What it costs

| | In place | Relocated | Change |
|---|---:|---:|---:|
| `scene.gltf` | 448,823,852 B | 347,731,160 B | −101,092,692 B (−22.52%) |
| Sidecar (`hierarchy.json` + `hierarchy.bin`) | — | 46,253,688 B | +46,253,688 B |
| Package | 657,116,508 B | 602,277,504 B | −54,839,004 B (−8.35%) |

The document delta plus the sidecar equals the package delta exactly; the
validator asserts that arithmetic, so no other resource moved under cover of
the comparison.

`hierarchy.bin` is fetched **once per run**, as response 3 of 118, ahead of
`coarse.bin` — the Studio reads the tree on the main thread while the Worker is
still decoding geometry, which is why a 46 MB extra fetch costs 29 ms rather
than a round trip. The in-place arm requests no sidecar at all. Both facts are
derived per run from the response stream, not asserted.

## What it must not change

Every run of both arms reaches the same endpoint over **17 counters**: status
text (`Residency budget reached · 24326 surface batches retained · 78173
renderable occurrences`), 42,435 prototypes, 78,173 occurrences, 2,255,235
triangles, 12 edges, 111 of 234 chunks resident, 66,686,508 decoded /
66,783,808 GPU bytes against the 67,108,864 B budget, 111 scheduler requests +
123 skips, 113 ranged `scene.bin` responses, the same picked occurrence and its
six IFC2X3 property entries. Zero console issues in all six runs.

One thing deliberately differs: the picked node **index** (148735 → 64079). A
relocated document keeps only the nodes that draw, so they are renumbered. The
occurrence, its identity, and its properties are unchanged.

## Host locality

The package digests (`a2d6c72a6e93` in place, `b821e4316a5b` relocated) are
**host-local**: this Windows host's IFC adapter emits a Scene IR split a few
bytes different from the macOS host's. The validator says so, and they must not
be retargeted to make a re-record pass. Timings are held as bounds, not pins.

## Reproducing

```
pnpm spatial:package --input output/ifc/sixty5 --output output/ifc/sixty5-relocated --no-spatial-index --relocate-hierarchy-nodes
pnpm hierarchy:browser:evidence
pnpm hierarchy:browser:check
```

The in-place arm is `output/ifc/sixty5-prb`, the package the committed
[`sixty5-first-frame`](../sixty5-first-frame/README.md) record uses. Six headed
browser runs take roughly thirteen minutes on this host.
