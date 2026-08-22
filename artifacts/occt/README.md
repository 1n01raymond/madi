# OCCT Phase 0 evidence

These artifacts are generated evidence, not a stable MADI interchange format.

- `repeated-fasteners.scene.json` is the logical `EngineeringScene` extracted
  from `fixtures/step/repeated-fasteners.step`.
- `repeated-fasteners.report.json` records the source digest, pinned OCCT/OCP
  toolchain, extraction tolerances, counts, prototype reuse, and known limits.

## Recorded result

The extraction uses CadQuery 2.8.0 with the OCP binding for OCCT 7.9.3.1. The
source is a MADI-authored AP214 assembly in millimetres with SHA-256
`de177178a4bb86a6983cabc7ad265117c56d7324df7912b94ece1263a6c8865d`.

| Signal | Result |
|---|---|
| Scene IR validation | Passed in `apps/webgpu-spike/test/evidence.test.ts` |
| Part prototypes / occurrences | 3 / 10 |
| Fastener reuse | 1 prototype / 8 occurrences |
| Unique triangles | 2,076 |
| OCCT face / edge source refs | 30 / 69 |
| Explicit edge segments | 181 |
| Two-engine visual smoke, 2026-08-23 | Chrome/Blink and Firefox/Gecko on Windows |
| Object picking | Both engines selected `center-rail`, object ID 2, with 12 OCCT edge refs |
| Browser console | No warnings or errors in either engine |

The committed screenshots and machine-readable browser metadata are in
[`artifacts/browser-matrix`](../browser-matrix/README.md). This proves the two
browser-engine path on one workstation; it is not a broad GPU compatibility or
performance claim.

## Reproduce

Create and activate a disposable Python virtual environment, then run from the
repository root:

```sh
python -m pip install -r native/adapter-occt/tools/requirements-evidence.txt
python native/adapter-occt/tools/extract_scene_ir.py \
  fixtures/step/repeated-fasteners.step \
  --scene artifacts/occt/repeated-fasteners.scene.json \
  --report artifacts/occt/repeated-fasteners.report.json
pnpm check
pnpm dev
```

Open the local page in a WebGPU-capable browser. The ready state must report
three geometry prototypes and ten part occurrences. Clicking the upper-right
fastener in the default isometric view should select `fastener-03`, object ID 5,
and resolve 21 revision-local OCCT edge references.
