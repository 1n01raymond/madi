# OCCT extraction evidence

These artifacts are generated inspection evidence, not a stable MADI
interchange format.

- `adafruit-pygamer.report.json` records the canonical real-world electronics
  fixture after OCCT 7.9.3 STEPCAF/XDE import.
- `repeated-fasteners.scene.json` and its report remain the small committed
  Scene IR regression case for deterministic compiler tests.
- `unsupported-layer-assignment.scene.json` and its report prove partial import
  with a stable diagnostic for intentionally unmapped AP214 layer metadata.

## Canonical fixture result

The canonical source is the unmodified Adafruit PyGamer STEP assembly pinned in
`fixtures/step/manifest.json`. It is copyright Adafruit Industries and is
redistributed under the MIT License; this use does not imply endorsement.

| Signal | Result |
|---|---:|
| STEP source bytes | 6,879,875 |
| Part prototypes / occurrences | 34 / 85 |
| Hierarchy depth below root | 2 |
| 0603 package reuse | 1 prototype / 26 occurrences |
| 0805 package reuse | 1 prototype / 11 occurrences |
| Unique triangles | 162,838 |
| OCCT face / edge source refs | 4,622 / 12,462 |
| Explicit edge segments | 13,897 |
| Adapter warnings / errors | 0 / 0 |

The extracted JSON is 80.6 MB because Phase 0 evidence serializes expanded
numeric arrays as text. It is generated into ignored `output/` storage rather
than committed. The small report, source STEP checksum, compiled glTF package,
and independent validators are committed. This is also concrete evidence that
JSON must not become MADI's production delivery format.

## Focused regression fixtures

`repeated-fasteners` retains one mounting plate, one center rail, and eight
transformed fastener occurrences sharing one prototype. The unsupported
variant adds one `PRESENTATION_LAYER_ASSIGNMENT` at STEP entity `#2135`.
`pnpm occt:diagnostics:check` proves geometry preservation while reporting
`OCCT_UNSUPPORTED_PRESENTATION_LAYER_ASSIGNMENT`.

## Reproduce

Create and activate a disposable Python environment, then run from the
repository root:

```sh
python -m pip install -r native/adapter-occt/tools/requirements-evidence.txt
python native/adapter-occt/tools/extract_scene_ir.py \
  fixtures/step/adafruit-pygamer.step \
  --scene output/occt/adafruit-pygamer.scene.json \
  --report artifacts/occt/adafruit-pygamer.report.json
node packages/compiler/dist/cli.js \
  output/occt/adafruit-pygamer.scene.json \
  artifacts/phase1/adafruit-pygamer
pnpm check
```

The reviewed two-engine rendering and picking evidence is in
[`artifacts/browser-matrix`](../browser-matrix/README.md).
