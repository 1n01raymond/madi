# STEP fixtures

Phase 0 requires explicitly redistributable STEP fixtures. A file is not
committed here merely because it can be downloaded without authentication. Its
redistribution terms, source, checksum, and intended test purpose must all be
reviewable.

The first two fixtures are original MADI project assets generated from the
auditable Python source in `generators/generate_fixtures.py`. This avoids
depending on unclear licensing for vendor or community CAD samples while still
exercising real STEP AP214 B-rep and assembly structures.

`manifest.json` is the source of truth. Each entry records:

```json
{
  "id": "repeated-fasteners",
  "kind": "assembly",
  "path": "repeated-fasteners.step",
  "sourcePath": "generators/generate_fixtures.py",
  "sourceUrl": "https://github.com/1n01raymond/madi/blob/main/fixtures/step/generators/generate_fixtures.py",
  "license": "Apache-2.0",
  "licenseUrl": "https://github.com/1n01raymond/madi/blob/main/LICENSE",
  "licenseFile": "LICENSE.md",
  "sha256": "64 lowercase hexadecimal characters",
  "purposes": ["assembly", "instancing", "hierarchy"],
  "attribution": "MADI Contributors",
  "generatedWith": {
    "tool": "CadQuery",
    "toolVersion": "2.8.0",
    "binding": "cadquery-ocp",
    "bindingVersion": "7.9.3.1.1",
    "kernel": "Open CASCADE Technology",
    "kernelVersion": "7.9.3"
  }
}
```

## Selected fixtures

| Fixture | Phase 0 risks |
|---|---|
| `precision-bracket.step` | curved seams, through-holes, fillets, explicit source edges, tolerance-sensitive B-rep traversal |
| `repeated-fasteners.step` | nested hierarchy, eight occurrences of one prototype, transforms, names, and colors |

See [`INSPECTION.md`](INSPECTION.md) for the qualification counts and known
limits, and [`LICENSE.md`](LICENSE.md) for redistribution terms.

## Regeneration

Regeneration is an intentional maintainer operation, not part of normal CI.
Use an isolated Python environment and the exact direct tool versions:

```sh
python -m pip install cadquery==2.8.0 cadquery-ocp==7.9.3.1.1
python fixtures/step/generators/generate_fixtures.py
pnpm fixtures:check
```

The script normalizes the machine path and timestamp in each STEP header.
OCCT may still emit presentation entities in a different order, so a deliberate
regeneration must update the manifest checksum and receive normal fixture
review. Normal builds consume the committed, checksum-locked files and do not
need Python or CadQuery.

## Acceptance checklist

- The license explicitly permits redistribution, modification, and automated
  testing.
- The committed file checksum matches the manifest.
- Attribution and the original source URL are retained.
- The file exercises a named Phase 0 risk rather than adding opaque test data.
- A fixture inspection report records units, hierarchy depth, prototype and
  occurrence counts, face/edge counts, warnings, and unsupported entities.
