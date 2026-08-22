# OCCT adapter feasibility spike

This directory keeps OCCT behind an adapter boundary. It contains two Phase 0
paths:

- the C++/CMake executable is the production-boundary experiment; and
- `tools/extract_scene_ir.py` is a reproducible evidence harness using the OCP
  Python binding for OCCT 7.9.3 STEPCAF/XDE.

Neither output defines a serialized MADI format, and no OCCT type crosses into
the browser packages.

## Prerequisites

- CMake 3.25 or newer;
- a C++20 compiler and Ninja;
- an Open CASCADE development package that exports `OpenCASCADEConfig.cmake`.

The current Windows workspace does not have these native prerequisites. Run
`pnpm native:check` for an actionable diagnostic. Once installed:

```sh
cmake --preset dev
cmake --build --preset dev
../../build/adapter-occt/madi-occt-spike path/to/assembly.step
```

Set `OpenCASCADE_DIR` when OCCT is installed outside CMake's normal search path.

## Reproducible evidence harness

The Python harness exists so the XDE-to-Scene-IR boundary can be exercised while
the native development toolchain is unavailable. It still reads the STEP file
through OCCT STEPCAF/XDE; CadQuery supplies the assembly wrapper and tessellation
helpers.

Create and activate a temporary virtual environment, then run:

```sh
python -m pip install -r tools/requirements-evidence.txt
python tools/extract_scene_ir.py \
  ../../fixtures/step/repeated-fasteners.step \
  --scene ../../artifacts/occt/repeated-fasteners.scene.json \
  --report ../../artifacts/occt/repeated-fasteners.report.json
python tools/extract_scene_ir.py \
  ../../fixtures/step/unsupported-layer-assignment.step \
  --scene ../../artifacts/occt/unsupported-layer-assignment.scene.json \
  --report ../../artifacts/occt/unsupported-layer-assignment.report.json
```

The generated logical scene preserves assembly containers, reusable part
prototypes, occurrence transforms, names, millimetre units, source colors,
tessellated surfaces, explicit edge polylines, and revision-local face/edge
source references. `pnpm test` hydrates the JSON into typed arrays and runs the
normal `@madi/scene-ir` validator.

Before transfer, the harness scans addressable STEP entity declarations against
the Phase 0 capability set. Known omitted semantics become stable diagnostics
with STEP entity source references; they do not make supported geometry fail.
`pnpm occt:diagnostics:check` verifies the fixture digest, geometry preservation,
Scene IR warning, and matching build-report record.

## Native spike output contract

The JSON is inspection evidence, not a stable API. It reports:

- one prototype record per referred XDE shape label;
- one occurrence record per assembly placement;
- source label entries and row-major transforms;
- face and edge counts for every prototype; and
- deterministic edge references of the form `<prototype-label>:edge:<ordinal>`.

The native executable still emits inspection JSON rather than the complete
logical scene. Porting the proven extraction behavior into the C++ adapter is a
separate implementation task once the native toolchain is available.
