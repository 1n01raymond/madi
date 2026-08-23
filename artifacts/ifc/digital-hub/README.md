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
| Compiled package bytes | 60,721,476 |

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

pnpm ifc:federation:evidence
pnpm ifc:federation:check
```

The checked package digest is
`32c5cf2183db37e6d2718e603f4ad833df72e684b94a98ce4086ee32d7d0451c`.

## Deliberate limits

- IFC curve and boundary-edge classification is deferred; this slice reports
  zero explicit CAD edge segments instead of guessing from triangle edges.
- Properties are flattened for the first queryable semantic path.
- Cross-document identity stays document-scoped; names are not used to infer
  object equivalence.
- Prototype-granular delivery produces 3,383 target ranges. The current Phase
  1 browser can display coarse geometry and consume those ranges, but range
  coalescing and incremental GPU residency are Phase 2 scheduler work.
