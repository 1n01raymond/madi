# Workspace records

Status: recorded product evidence for Phase 2 exit criterion 4, "a workspace
reopens against unchanged source and detects changed source"
([tracker](../../docs/PHASE_2.md)).

The `naru.workspace.1` manifest, its fail-closed parser, its canonical
serializer, and the reopen decision are covered by unit tests in
[`packages/workspace`](../../packages/workspace/README.md) — those settle the
format and the precedence rules. What a unit test cannot settle is whether a
person gets their session back: hidden objects, selection, section plane and
camera, in a renderer, after the tab closed. That is what this family records.

| Record | What it settles |
|---|---|
| [`reopen/`](reopen/README.md) | One headed Chrome run over the Digital Hub package: a session saved (1,871 B manifest), reopened against the unchanged package (`unverifiable` → `verified`, byte-identical re-save), reopened after a same-length source edit (`changed-source`, `geometryIsCurrent` false, package still verified), and reopened through a reload so both of the Studio's restore paths are exercised |

```sh
pnpm workspace:reopen:check
```

Re-record with `pnpm workspace:reopen:evidence`; it needs a headed browser and
the compiled Digital Hub package named in the record README.

What this family does not settle: a second engine or operating system (see
[`docs/REAL_LARGE_RESULTS.md`](../../docs/REAL_LARGE_RESULTS.md) for the
cross-engine startup matrix), and a reopen at real-large scale — Digital Hub is
84.5 MB of package, not sixty5's 657 MB.
