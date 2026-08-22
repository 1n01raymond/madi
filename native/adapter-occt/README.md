# OCCT adapter feasibility spike

This executable is a deliberately isolated native experiment. It reads a STEP
document through OCCT/XDE and emits deterministic JSON describing reusable
prototypes, assembly occurrences, transforms, and generated revision-local edge
references. It does not define a serialized MADI format and none of its OCCT
types cross into browser packages.

## Prerequisites

- CMake 3.25 or newer;
- a C++20 compiler and Ninja;
- an Open CASCADE development package that exports `OpenCASCADEConfig.cmake`.

The current Windows workspace does not have the native prerequisites installed.
Run `pnpm native:check` for an actionable diagnostic. Once installed:

```sh
cmake --preset dev
cmake --build --preset dev
../../build/adapter-occt/madi-occt-spike path/to/assembly.step
```

Set `OpenCASCADE_DIR` when OCCT is installed outside CMake's normal search path.

## Spike output contract

The JSON is inspection evidence, not a stable API. It reports:

- one prototype record per referred XDE shape label;
- one occurrence record per assembly placement;
- source label entries and row-major transforms;
- face and edge counts for every prototype; and
- deterministic edge references of the form `<prototype-label>:edge:<ordinal>`.

The next OCCT task must add names, units, colors, tessellation arrays, and a
direct conversion into `@madi/scene-ir`, followed by validation against a
licensed fixture from `fixtures/step/manifest.json`.
