# STEP fixture inspection

Inspection date: 2026-08-23

All three files were generated from `generators/generate_fixtures.py` with CadQuery
2.8.0 and `cadquery-ocp` 7.9.3.1.1, then imported again through the same OCCT
binding. Counts below describe the flattened B-rep import. The source assembly
structure comes from the generator and the AP214 occurrence records in the
exported file.

| Fixture | Units | Source hierarchy | Prototypes / part occurrences | Solids | Faces | Edges | Adapter diagnostics |
|---|---|---|---:|---:|---:|---:|---|
| `precision-bracket.step` | mm | one part | 1 / 1 | 1 | 18 | 40 | none |
| `repeated-fasteners.step` | mm | root → fastener bank → fastener | 3 / 10 | 10 | 100 | 216 | none |
| `unsupported-layer-assignment.step` | mm | root → fastener bank → fastener | 3 / 10 | 10 | 100 | 216 | `OCCT_UNSUPPORTED_PRESENTATION_LAYER_ASSIGNMENT` × 1 |

The assembly contains one mounting-plate occurrence, one center-rail
occurrence, and eight transformed occurrences of the same fastener shape. It
has three distinct RGB colors and eleven AP214
`NEXT_ASSEMBLY_USAGE_OCCURRENCE` relationships: three below the root and eight
below the fastener bank. The file contains three `MANIFOLD_SOLID_BREP`
definitions rather than ten copied geometric definitions.

The unsupported fixture adds `#2135`, a valid AP214
`PRESENTATION_LAYER_ASSIGNMENT` that targets the first B-rep. OCCT still imports
all supported geometry. The Phase 0 adapter records the omitted layer metadata
as a warning linked to that exact STEP entity; the committed Scene IR and build
report are independently checked by `pnpm occt:diagnostics:check`.
