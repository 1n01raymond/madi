@AGENTS.md

## Claude Code notes

- Orient from `docs/PHASE_1.md` ("Not yet proven", "Next slice") and
  `docs/ROADMAP.md` before planning. Machine-specific paths and personal
  workflow notes belong in `CLAUDE.local.md` (untracked), not in this file.
- Reference large files by path instead of `@`-including them. Evidence JSONs
  run past 1,000 lines, and several sources exceed 1,000 lines
  (`apps/webgpu-spike/src/main.ts`, `packages/runtime-webgpu/src/compiled-gltf.ts`,
  `packages/compiler/src/gltf.ts`,
  `native/adapter-ifc/tools/extract_federation_scene_ir.py`). Read the section
  you need.
- Prefer `pnpm <script>` over ad-hoc `node` invocations so validators run with
  the same arguments CI uses.
- Filter validator and test output down to failures before reading it.

## Compact instructions

When compacting, keep: the branch and task in progress; files modified and
why; validator and test commands already run with their pass/fail result; any
schema ID, digest, or count that changed; documentation still to sync; open
questions and decisions already taken. Drop file contents, full tool output,
and exploratory reads.
