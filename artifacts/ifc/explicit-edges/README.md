# IFC explicit-edge evidence

Status: focused E2.1 compiler evidence

This record compiles the project-owned
`fixtures/ifc/explicit-edge-wall.ifc` through IfcOpenShell 0.8.5 and the normal
NARU IFC→Scene IR→glTF path. It proves that OpenCascade face-boundary output,
not a triangle wireframe, becomes source-linked explicit line geometry.

| Signal | Recorded result |
|---|---:|
| Source | IFC4 · 1,555 bytes · SHA-256 `cf15bb336ca6` |
| Surface | 8 vertices · 12 triangles |
| Triangle-wireframe control | 18 unique triangle edges |
| Explicit boundary output | 12 segments |
| Excluded face diagonals | 6 |
| Source mapping | all 12 segments → `IfcExtrudedAreaSolid#21` |
| Split transport | `naru.ifc-scene-ir-split.4` · 592 geometry bytes |
| Compiled package | SHA-256 `83ab598070ee` · 12 triangles · 12 explicit edges |
| glTF validation | Khronos 2.0.0-dev.3.10 · 0 errors · 0 warnings |

The edge primitive reuses the surface POSITION accessor rather than encoding
the same eight vertices twice. Edge indices, boundary classes, and source IDs
remain separate streams. The source mapping is intentionally at IFC
representation-item granularity: IfcOpenShell identifies the originating
`IfcExtrudedAreaSolid`, not a persistent IFC entity for each OpenCascade edge.
Analytic curve kinds and sharp/smooth/seam classification remain unproven and
are reported as `IFC_EDGE_CLASSIFICATION_BOUNDARY_ONLY`.

Two independent output-directory compilations, plus the committed artifact
generation, produced byte-identical adapter reports, build reports, glTF JSON,
and every package resource.

## Reproduce

```sh
python -m venv output/venv-ifc
output/venv-ifc/bin/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

pnpm naru compile-ifc \
  --document architecture=fixtures/ifc/explicit-edge-wall.ifc \
  --uri-hint architecture=fixtures/ifc/explicit-edge-wall.ifc \
  --python output/venv-ifc/bin/python \
  --threads 1 \
  --output output/ifc/explicit-edge-wall

pnpm ifc:edges:check
```

The older Digital Hub and sixty5 records intentionally remain at the historical
`madi.ifc-scene-ir-split.3` surface-only schema. The compiler accepts both
that transport and current split.4, so this focused evidence does not invalidate
the public demo package or rewrite large historical measurements.
