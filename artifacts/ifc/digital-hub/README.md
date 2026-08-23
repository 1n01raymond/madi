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
| Renderable occurrences | 5,152 |
| Unique geometric prototypes | 3,383 |
| Reused geometry occurrences | 1,769 |
| Unique triangles | 913,520 |
| Submitted triangles before reuse | 2,534,364 |
| Coalesced target requests | 45 |
| Target request budget | 512 KiB (except one indivisible 1.12 MiB prototype) |
| Intermediate structure bytes | 39,135,637 |
| Intermediate geometry bytes | 28,134,848 |
| Compiled package bytes | 59,679,456 |

The adapter hands the compiler a split Scene IR transport: a structure-only
JSON document plus a little-endian geometry file, each digest-linked in the
adapter report. That pair replaced a single 81,805,061-byte JSON document, so
the structure the compiler must parse as one string is 52.2% smaller while the
compiled package stays byte-identical.

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
`a6d5c0eecebf286208e151d281af26e6747e8a163ba3eb4a3b5cfe9353260d5d`.

## Deliberate limits

- IFC curve and boundary-edge classification is deferred; this slice reports
  zero explicit CAD edge segments instead of guessing from triangle edges.
- Properties are flattened for the first queryable semantic path.
- Cross-document identity stays document-scoped; names are not used to infer
  object equivalence.
- The compiler coalesces the 3,383 prototype ranges into 45 deterministic
  target requests at a 512 KiB budget. A single prototype exceeding that
  budget is kept whole at 1.12 MiB: splitting one mesh's accessor payload is a
  later spatial-chunking concern. The browser promotes these requests through
  stable GPU batch keys and stops safely at its published 64 MiB decoded/GPU
  residency cap, retaining coarse geometry for anything not admitted.
