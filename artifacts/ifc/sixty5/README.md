# sixty5 IFC federation evidence

This is the first `real-large` IFC result compiled end to end: the
seven-discipline IFC-Bench sixty5 federation extracted through pinned
IfcOpenShell 0.8.5 into the split Scene IR transport, then compiled through the
record-streaming structure reader into a Khronos-validated glTF 2.0 package.
It is an adapter and compiler result, not a renderer benchmark.

## Reviewed extraction result

| Measure | Result |
|---|---:|
| Source IFC documents | 7 |
| Source bytes | 839,866,782 |
| Part 21 entities | 11,376,756 |
| Semantic entities | 192,316 |
| Occurrences | 188,319 |
| Occurrences carrying geometry | 78,173 |
| Unique geometric prototypes | 42,435 |
| Mapped items | 38,812 |
| Reused geometry occurrences | 35,738 |
| Submitted triangles before reuse | 40,310,966 |
| Unique triangles | 4,866,386 |
| Unique vertices | 2,596,268 |
| Property values | 4,503,078 |
| Property index keys / key-sets | 35,510 / 299 |
| Duplicate GlobalIds | 0 |
| Intermediate structure bytes | 419,502,749 |
| Intermediate geometry bytes | 151,864,848 |

Every document declares `IFC2X3`, so this federation also qualifies the older
schema path. Prototype reuse removes 87.9% of submitted triangles, which is the
first evidence that IFC mapped representations carry real instancing at this
scale rather than only in the smaller Digital Hub federation.

## Reviewed compiled result

The split.1 structure document measured 631,943,761 bytes — past the
536,870,888-code-unit maximum string length on the 64-bit V8 this repository
pins — so it could not be parsed as one JavaScript string; the compiler's
record-streaming reader (`packages/compiler/src/ifc-structure-stream.ts`),
which walks the file in bounded chunks and parses one record at a time, is
what made that compile possible (recorded at commit `41e6973`). Property
indexing (`madi.ifc-scene-ir-split.2`) — 35,510 distinct keys and 299 key
combinations interned once at scene level — then shrank the structure to
419,502,749 bytes (−33.6 %), back under the string limit; the reader remains
the compile path and the guard against any future crossing.

| Measure | Result |
|---|---:|
| Package digest | `638aaf1784efebe5b4ce041fe3dc56674c7f99a1f7248eaa86739d7c7143333f` |
| `scene.gltf` bytes | 448,823,616 |
| `scene.bin` bytes | 120,707,064 |
| `coarse.bin` bytes | 38,700,720 |
| glTF nodes | 188,320 |
| glTF meshes | 84,870 |
| Compiled prototypes | 42,435 |
| Renderable occurrences | 78,173 |
| Materials | 318 |
| Unique triangles | 4,866,386 |
| Explicit edge segments | 0 (deferred, as extracted) |
| Coalesced target chunks (512 KiB budget) | 234 |
| Khronos glTF Validator 2.0.0-dev.3.10 | 0 errors / 0 warnings |

Determinism was verified at full scale on the split.1 record (commit
`41e6973`): two complete `madi compile-ifc` runs, each re-running the adapter
extraction, produced byte-identical `scene.gltf`, `scene.bin`, `coarse.bin`,
`build-report.json`, and `adapter-report.json`. The measured second run on the
recording machine (16 CPUs, `--threads 6`, warm OS file cache) took 302 s wall
clock end to end; the Node compiler process peaked at 4,043,804,672 bytes
working set (≈3.8 GB) inside the default V8 heap, with no
`--max-old-space-size` override. The split.2 record here comes from one full
run of the same command; `scene.bin`, `coarse.bin`, the geometry half, every
compiler count, and all 4,503,078 property values match the split.1 record
byte for byte or count for count, and `scene.gltf` keeps its exact byte length
with a digest change explained by the recorded `optionsDigest`
(`propertyMode: "indexed-flattened-psets"`).

## Reproduce

```sh
pnpm fixtures:external fetch ifc-bench-sixty5 --allow-large
python -m venv output/venv-ifc
output/venv-ifc/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

pnpm madi compile-ifc \
  --document architecture=output/external-fixtures/ifc-bench-sixty5/arc.ifc \
  --uri-hint architecture=projects/sixty5/arc.ifc \
  --document electrical=output/external-fixtures/ifc-bench-sixty5/electrical.ifc \
  --uri-hint electrical=projects/sixty5/electrical.ifc \
  --document facade=output/external-fixtures/ifc-bench-sixty5/facade.ifc \
  --uri-hint facade=projects/sixty5/facade.ifc \
  --document kitchen=output/external-fixtures/ifc-bench-sixty5/kitchen.ifc \
  --uri-hint kitchen=projects/sixty5/kitchen.ifc \
  --document plumbing=output/external-fixtures/ifc-bench-sixty5/plumbing.ifc \
  --uri-hint plumbing=projects/sixty5/plumbing.ifc \
  --document structure=output/external-fixtures/ifc-bench-sixty5/str.ifc \
  --uri-hint structure=projects/sixty5/str.ifc \
  --document ventilation=output/external-fixtures/ifc-bench-sixty5/ventilation.ifc \
  --uri-hint ventilation=projects/sixty5/ventilation.ifc \
  --python output/venv-ifc/Scripts/python \
  --threads 6 \
  --output output/ifc/sixty5

pnpm ifc:federation:evidence:sixty5
pnpm ifc:federation:check
```

The federation source digest is
`e334c6a9295a0adbf8ffbb15c61ea05c47b0135a319ee370f853bb9a36d21dec`. The 571.4 MB
intermediate pair and the 608.2 MB compiled package stay under ignored
`output/` storage; only the adapter report, the compiler build report, and the
Khronos validation envelope are reviewed here.

## Deliberate limits

- IFC curve and boundary-edge classification is deferred, as in Digital Hub.
  This federation reports zero explicit CAD edge segments.
- Extraction is single-pass and resident: the adapter holds the whole federation
  in memory before writing. The compiler streams the structure document and
  property keys are interned at scene level, but the hydrated scene — including
  all 4,503,078 property values — stays resident during compilation; a binary
  column encoding for the values themselves is separate follow-up work.
- A browser and residency record for this package now exists under
  `artifacts/ifc/sixty5-browser/`, but no timing benchmark does. The 302 s
  compile time above is a recording note, not a benchmark result; neither
  record may be cited as ADR-0003 evidence.
- 56 source `IfcAxis2Placement` entities carry a zero-length or parallel axis
  vector, which IfcOpenShell's placement projection turns into a non-finite
  matrix component. `native/adapter-ifc/tools/placement_math.py` replaces each
  with an identity transform and records an `IFC_DEGENERATE_PLACEMENT` warning
  naming the entity and document (`native/adapter-ifc/README.md`). Without this
  guard the structure document held 448 bare `NaN` tokens across 60 occurrence
  records and was not valid JSON.
