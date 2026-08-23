# IFC federation adapter slice

This adapter keeps IfcOpenShell behind the same process boundary used for the
OCCT STEP adapter. It reads multiple discipline IFC files into one Engineering
Scene IR while retaining document-scoped source identity.

The first executable slice preserves:

- one source document and SHA-256 identity per discipline;
- IFC GlobalId-backed semantic entities, types, groups, classifications, and
  flattened inherited property sets;
- project/site/building/storey/product containment and local transforms;
- IfcOpenShell local triangulation separated from occurrence placement;
- prototype reuse keyed by IfcOpenShell's geometry identity; and
- source units normalized to a metre/Z-up federation frame.

IFC curve and boundary-edge classification is intentionally deferred. The
adapter emits surfaces and a stable diagnostic rather than labeling triangle or
topological edges as explicit CAD edges.

## Reproduce the Digital Hub extraction

Fetch the external fixture, create an isolated Python environment, and use the
public compiler command documented in `packages/compiler/README.md`:

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
  --output output/ifc/digital-hub
```

The Scene IR is a large disposable intermediate and stays under `output/`. The
adapter writes it as a split pair rather than one document: `--scene` receives
structure-only JSON whose representation surfaces hold
`{encoding, byteOffset, byteLength}` references, and `--geometry` receives the
concatenated little-endian streams those references point into. Every stream
starts on an eight-byte boundary so the compiler can take typed-array views
without copying, and the report carries a SHA-256 for each half. Reviewed
counts and hashes live under `artifacts/ifc/`; normal CI validates those
compact records without installing IfcOpenShell or downloading the IFC sources.

IfcOpenShell is LGPL-3.0-or-later. It is an adapter dependency and is not
bundled into MADI's browser runtime.
