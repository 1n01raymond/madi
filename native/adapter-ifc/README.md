# IFC federation adapter slice

This adapter keeps IfcOpenShell behind the same process boundary used for the
OCCT STEP adapter. It reads multiple discipline IFC files into one Engineering
Scene IR while retaining document-scoped source identity.

The first executable slice preserves:

- one source document and SHA-256 identity per discipline;
- IFC GlobalId-backed semantic entities, types, groups, classifications, and
  flattened inherited property sets, with keys and key combinations interned
  once into the scene-level `propertyIndex` (`tools/property_index.py`) and
  the values themselves deduplicated into the binary property column file
  (`madi.ifc-scene-ir-split.3`, `tools/property_columns.py`);
- project/site/building/storey/product containment and local transforms;
- IfcOpenShell local triangulation separated from occurrence placement;
- prototype reuse keyed by IfcOpenShell's geometry identity; and
- source units normalized to a metre/Z-up federation frame.

IFC curve and boundary-edge classification is intentionally deferred. The
adapter emits surfaces and a stable diagnostic rather than labeling triangle or
topological edges as explicit CAD edges.

## Degenerate placement handling

Some source `IfcAxis2Placement` entities carry zero-length or parallel axis
vectors; IfcOpenShell's placement projection then divides by a zero-length
normal and produces `NaN` components. `native/adapter-ifc/tools/placement_math.py`
is the single choke point every world, parent, and derived local transform
passes through before serialization: a matrix with any non-finite component is
replaced with the identity matrix, and the adapter appends an
`IFC_DEGENERATE_PLACEMENT` warning naming the affected document and entity.
`write_scene`/`write_report` additionally call `json.dump(..., allow_nan=False)`
as a backstop, so any future gap in the per-value guards fails loudly at write
time (`ValueError`) instead of emitting invalid JSON with a bare `NaN` token.

## Adapter unit tests

`placement_math.py`, `property_index.py`, and `property_columns.py` have no
IfcOpenShell import, so their tests run without the pinned adapter
environment:

```sh
python -m venv output/venv-ifc-test  # or reuse output/venv-ifc
output/venv-ifc-test/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-dev.txt

pnpm adapter:ifc:test
```

`pnpm adapter:ifc:test` looks for a Python interpreter with `pytest` and
`numpy` importable via `--python <path>`, `NARU_PYTHON`, then plain `python`/
`python3` on `PATH`, and runs `native/adapter-ifc/tests/`. This is separate
from `pnpm check`, the same way `native:check` is: it needs a Python
interpreter present, and CI runs it in its own `python-adapter` job.

## Reproduce the Digital Hub extraction

Fetch the external fixture, create an isolated Python environment, and use the
public compiler command documented in `packages/compiler/README.md`:

```sh
pnpm fixtures:external fetch ifc-bench-digital-hub
python -m venv output/venv-ifc
output/venv-ifc/Scripts/python -m pip install \
  -r native/adapter-ifc/tools/requirements-evidence.txt

pnpm naru compile-ifc \
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
  --output output/ifc/digital-hub
```

The Scene IR is a large disposable intermediate and stays under `output/`. The
adapter writes it as a split triple rather than one document: `--scene`
receives structure-only JSON whose representation surfaces hold
`{encoding, byteOffset, byteLength}` references, `--geometry` receives the
concatenated little-endian streams those references point into, and
`--properties` receives the binary property value columns
(`madi.property-columns.1`): every distinct semantic property value encoded
once as canonical compact JSON in a byte-sorted UTF-8 heap, with u32 reference
and offset columns joining each semantic's row back to its interned key set.
Every stream starts on an eight-byte boundary so the compiler can take
typed-array views without copying, and the report carries a SHA-256 for each
of the three files. Reviewed counts and hashes live under `artifacts/ifc/`;
normal CI validates those compact records without installing IfcOpenShell or
downloading the IFC sources.

IfcOpenShell is LGPL-3.0-or-later. It is an adapter dependency and is not
bundled into NARU's browser runtime.
