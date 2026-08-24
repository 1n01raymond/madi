# sixty5 IFC federation extraction evidence

This is the first `real-large` IFC result: the seven-discipline IFC-Bench
sixty5 federation extracted through pinned IfcOpenShell 0.8.5 into the split
Scene IR transport. It is an adapter result and a measured compiler boundary,
not a compiled package and not a renderer benchmark.

## Reviewed result

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
| Duplicate GlobalIds | 0 |
| Intermediate structure bytes | 631,943,761 |
| Intermediate geometry bytes | 151,864,848 |

Every document declares `IFC2X3`, so this federation also qualifies the older
schema path. Prototype reuse removes 87.9% of submitted triangles, which is the
first evidence that IFC mapped representations carry real instancing at this
scale rather than only in the smaller Digital Hub federation.

## Measured compiler boundary

The extraction completes, but `madi compile-ifc` stops before compiling it. The
compiler parses the structure document as one JSON string, and this structure is
631,943,761 bytes against a 536,870,888-byte maximum string length on the
64-bit V8 this repository pins. The compiler reports that limit with the
measured size rather than surfacing an opaque allocation failure.

Splitting geometry out of the structure was necessary but not sufficient: the
remaining bulk is 4,503,078 flattened property values and 188,319 occurrence
records. The named follow-up work is a streamed structure section format, so
neither the transport nor the compiler needs the whole federation resident as
one string or one object graph.

This record therefore proves adapter-side extraction, source identity, and
prototype reuse at real-large scale. It does not prove compiled output, glTF
validation, residency, or frame behaviour for this dataset.

## Reproduce

```sh
pnpm fixtures:external fetch ifc-bench-sixty5 --allow-large
python -m venv output/venv-ifc
output/venv-ifc/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

output/venv-ifc/Scripts/python \
  native/adapter-ifc/tools/extract_federation_scene_ir.py \
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
  --scene output/ifc/sixty5-scene-ir/scene-ir.json \
  --geometry output/ifc/sixty5-scene-ir/scene-ir-geometry.bin \
  --report output/ifc/sixty5-scene-ir/adapter-report.json \
  --threads 6

pnpm ifc:federation:check
```

The federation source digest is
`e334c6a9295a0adbf8ffbb15c61ea05c47b0135a319ee370f853bb9a36d21dec`. The 783.8 MB
intermediate pair stays under ignored `output/` storage; only the 33.7 KB
adapter report is reviewed here.

## Deliberate limits

- IFC curve and boundary-edge classification is deferred, as in Digital Hub.
  This federation reports zero explicit CAD edge segments.
- Extraction is single-pass and resident: the adapter holds the whole federation
  in memory before writing. Streaming extraction is separate follow-up work.
- No compiled package, Khronos validation, browser evidence, or timing result
  exists for this dataset. It must not be cited as ADR-0003 evidence.
- 56 source `IfcAxis2Placement` entities carry a zero-length or parallel axis
  vector, which IfcOpenShell's placement projection turns into a non-finite
  matrix component. `native/adapter-ifc/tools/placement_math.py` replaces each
  with an identity transform and records an `IFC_DEGENERATE_PLACEMENT` warning
  naming the entity and document (`native/adapter-ifc/README.md`). Without this
  guard the structure document held 448 bare `NaN` tokens across 60 occurrence
  records and was not valid JSON.
