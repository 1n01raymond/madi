# ADR-0007: Rebrand MADI to NARU without invalidating recorded evidence

Status: Accepted
Accepted: 2026-08-24

## Context

The project launched under the working name MADI. That name collides with
`google/madi`, an established open-source anomaly-detection project, which
harms search discovery and invites confusion. The project rebrands to **NARU**
(npm scope `@naru3d`, CLI `naru`).

The roadmap is evidence-gated: committed records under `artifacts/` hardcode
digests of compiled packages, adapter outputs, and fixture bytes, and
determinism (two compilations producing byte-identical output) is a validated
feature. Many `madi` strings are serialized into those bytes: schema IDs
(`madi.ifc-adapter-report.4`, `madi.package-properties.1`, …), the glTF
`extras.madi` key, the glTF generator strings ("MADI compiler 0.0.0 / …"),
the report identity `"@madi/compiler"`, benchmark backend/workload IDs
(`"madi"`, `madi.industrial-pipe-rack.1`), the GPU-timing scope
(`madi-surface-pass`), and the STEP fixture headers ("MADI Contributors").
Renaming any of them would change output bytes, break every hardcoded digest,
and force a full re-measurement of the evidence base for zero functional gain.

## Decision

Rename everything human-facing; freeze every identifier that participates in
serialized bytes or is asserted by an evidence validator.

Renamed: repository branding and documentation, npm package names
(`@madi/*` → `@naru3d/*`), the CLI (`madi` → `naru`, `pnpm naru`), environment
variables (`MADI_PYTHON` → `NARU_PYTHON`, `MADI_IFC_PYTHON` → `NARU_IFC_PYTHON`,
`MADI_SCENE_DIR` → `NARU_SCENE_DIR`), exported runtime symbols
(`MadiWebGpu*` → `NaruWebGpu*`), Studio/benchmark UI strings and DOM ids,
brand assets (`docs/media/naru-*.svg`), GPU debug labels, temporary-directory
prefixes, and the native adapter build targets
(`naru-occt-spike`, `NARU_OCCT_REQUIRED`).

Frozen at their historical `madi` spellings, deliberately:

- every serialized schema/profile/encoding ID with the `madi.` prefix;
- the glTF `extras.madi` key and everything emitted inside compiled packages
  ("MADI compiler 0.0.0 / …" generators, "MADI fallback …", "MADI source
  frame", `"@madi/compiler"`, extension notes);
- IFC/OCCT adapter report emissions (`madi.ifc-adapter-report.4`,
  `madi.phase0.occt`, "MADI neutral", …);
- benchmark backend/workload IDs (`?backend=madi`), the recorded schema
  versions, and the `madi-surface-pass` timing scope;
- everything under `artifacts/` (historical records are never rewritten) and
  the committed STEP fixtures with their manifest, license, and generator.

Each frozen family migrates to a `naru.` ID at its next deliberate schema bump
(for example `madi.ifc-scene-ir-split.3` → `naru.ifc-scene-ir-split.4` when
E2.1 explicit edges land), at which point the paired validator and re-recorded
evidence change together, as the existing schema-bump rule already requires.

## Consequences

### Positive

- The rebrand lands as one reviewable change with zero re-measurement: every
  committed digest, byte-identity claim, and validator keeps passing.
- Recompiling a source still reproduces the committed evidence byte for byte.
- Schema IDs keep their promise of changing only with a deliberate format bump.

### Negative

- `madi` remains visible inside serialized outputs and evidence until each
  format's next natural bump; contributors must not "fix" those spellings in
  isolation.
- The GitHub repository rename (`1n01raymond/madi` → `1n01raymond/naru`) must
  happen on GitHub; old URLs survive through GitHub's redirect.

## Alternatives considered

- **Rename serialized IDs immediately and re-record all evidence.** Rejected:
  hours of re-measurement (sixty5 alone compiles for ~4 minutes and its browser
  record takes ~5.5 minutes per run) and a noisy evidence diff, for no
  functional change.
- **Hand-edit committed evidence JSONs to the new name.** Rejected: digests
  inside the records would no longer match the referenced bytes, and evidence
  must only ever come from commands actually run.

## Validation

`pnpm check` passes on the rebrand commit: every evidence validator still
verifies the committed records against the frozen identifiers, and lint,
typecheck, tests, and builds pass under the `@naru3d/*` package names.
