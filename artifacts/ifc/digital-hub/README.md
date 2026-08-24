# Digital Hub IFC federation evidence

This is the first executable IFC federation slice across architecture,
heating, plumbing, and ventilation documents from the qualified IFC-Bench
Digital Hub dataset.

## Reviewed result

| Measure | Result |
|---|---:|
| Source IFC documents | 4 |
| Source bytes | 67,829,367 |
| Part 21 entities | 482,994 |
| Semantic entities | 14,675 |
| Property values | 273,188 |
| Property index keys / key-sets | 1,656 / 279 |
| Renderable occurrences | 5,152 |
| Unique geometric prototypes | 3,383 |
| Reused geometry occurrences | 1,769 |
| Unique triangles | 913,520 |
| Submitted triangles before reuse | 2,534,364 |
| Coalesced target requests | 45 |
| Target request budget | 512 KiB (except one indivisible 1.12 MiB prototype) |
| Intermediate structure bytes | 30,592,935 |
| Intermediate geometry bytes | 28,134,848 |
| Compiled package bytes | 59,679,456 |

The adapter hands the compiler a split Scene IR transport
(`madi.ifc-scene-ir-split.2`): a structure-only JSON document plus a
little-endian geometry file, each digest-linked in the adapter report. The
split replaced a single 81,805,061-byte JSON document, and property indexing —
1,656 distinct keys and 279 key combinations interned once at scene level —
then shrank the structure from 39,135,637 to 30,592,935 bytes (62.6% below the
single document). `scene.bin`, `coarse.bin`, every compiler count, and all
273,188 resolvable property values are unchanged from the split.1 record;
`scene.gltf` differs only through the recorded `optionsDigest`
(`propertyMode: "indexed-flattened-psets"`).

IfcOpenShell 0.8.5 generated local prototype geometry and occurrence
placements in metres. MADI retained document-scoped GlobalIds, hierarchy,
types, groups, classifications, and flattened inherited property sets, then
compiled the scene into standards-first glTF 2.0. Khronos glTF Validator
2.0.0-dev.3.10 reported zero errors and zero warnings.

The three compact JSON files bind the qualified source revision and four source
hashes to the adapter report, compiler report, package resources, and official
validation result. They do not redistribute the source IFC or the 60.7 MB
compiled package.

## Reproduce

```sh
pnpm fixtures:external fetch ifc-bench-digital-hub
python -m venv output/venv-ifc
output/venv-ifc/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

pnpm madi compile-ifc \
  --document architecture=output/external-fixtures/ifc-bench-digital-hub/arc.ifc \
  --uri-hint architecture=projects/digital_hub/arc.ifc \
  --document heating=output/external-fixtures/ifc-bench-digital-hub/heating.ifc \
  --uri-hint heating=projects/digital_hub/heating.ifc \
  --document plumbing=output/external-fixtures/ifc-bench-digital-hub/plumbing.ifc \
  --uri-hint plumbing=projects/digital_hub/plumbing.ifc \
  --document ventilation=output/external-fixtures/ifc-bench-digital-hub/ventilation.ifc \
  --uri-hint ventilation=projects/digital_hub/ventilation.ifc \
  --python output/venv-ifc/Scripts/python \
  --threads 4 \
  --retain-scene-ir \
  --output output/ifc/digital-hub
# --retain-scene-ir writes scene-ir.json and scene-ir-geometry.bin together;
# the structure JSON alone is not a loadable scene.

pnpm ifc:federation:evidence
pnpm ifc:federation:check
```

The checked package digest is
`98399341020db499115aa5b7962dbca82cfdd839b7a6b1aea70a1af7517a6e63`.

## Deliberate limits

- IFC curve and boundary-edge classification is deferred; this slice reports
  zero explicit CAD edge segments instead of guessing from triangle edges.
- Properties are flattened for the first queryable semantic path; keys and
  key combinations are interned into the scene-level property index.
- Cross-document identity stays document-scoped; names are not used to infer
  object equivalence.
- The compiler coalesces the 3,383 prototype ranges into 45 deterministic
  target requests at a 512 KiB budget. A single prototype exceeding that
  budget is kept whole at 1.12 MiB: splitting one mesh's accessor payload is a
  later spatial-chunking concern. The browser promotes these requests through
  stable GPU batch keys and stops safely at its published 64 MiB decoded/GPU
  residency cap, retaining coarse geometry for anything not admitted.
