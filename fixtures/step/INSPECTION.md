# STEP fixture inspection

Inspection date: 2026-08-23

The four MADI-authored files were generated from
`generators/generate_fixtures.py` with CadQuery 2.8.0 and `cadquery-ocp`
7.9.3.1.1. The upstream Adafruit PyGamer was imported byte-for-byte from the
pinned MIT-licensed source. Every file was then read through the same OCCT
binding. Counts below describe the occurrence-expanded B-rep import.

| Fixture | Units | Source hierarchy | Prototypes / part occurrences | Solids | Faces | Edges | Adapter diagnostics |
|---|---|---|---:|---:|---:|---:|---|
| `precision-bracket.step` | mm | one part | 1 / 1 | 1 | 18 | 40 | none |
| `repeated-fasteners.step` | mm | root → fastener bank → fastener | 3 / 10 | 10 | 100 | 216 | none |
| `repeated-fasteners-ap242.step` | mm | root → fastener bank → fastener | 3 / 10 | 10 | 100 | 216 | none |
| `adafruit-pygamer.step` | mm | Adafruit PyGamer v12 → PCB Component → parts | 34 / 85 | 177 | 6,351 | 16,486 | none |
| `unsupported-layer-assignment.step` | mm | root → fastener bank → fastener | 3 / 10 | 10 | 100 | 216 | `OCCT_UNSUPPORTED_PRESENTATION_LAYER_ASSIGNMENT` × 1 |

The AP214 and AP242 assembly variants contain one mounting-plate occurrence, one center-rail
occurrence, and eight transformed occurrences of the same fastener shape. It
has three distinct RGB colors and eleven
`NEXT_ASSEMBLY_USAGE_OCCURRENCE` relationships: three below the root and eight
below the fastener bank. The file contains three `MANIFOLD_SOLID_BREP`
definitions rather than ten copied geometric definitions.

The PyGamer is the canonical visual and real-world complexity fixture. OCCT
finds 34 unique part prototypes across 85 part occurrences, including one 0603
package reused 26 times, one 0805 package reused 11 times, five LED occurrences,
four button-cap occurrences, a display, joystick, PCB, headers, connectors, and
IC packages. Unique geometry contains 4,622 face and 12,462 edge source
references; occurrence-expanded inspection reaches 177 solids, 6,351 faces,
and 16,486 edges.

The unsupported fixture adds `#2135`, a valid AP214
`PRESENTATION_LAYER_ASSIGNMENT` that targets the first B-rep. OCCT still imports
all supported geometry. The Phase 0 adapter records the omitted layer metadata
as a warning linked to that exact STEP entity; the committed Scene IR and build
report are independently checked by `pnpm occt:diagnostics:check`.
