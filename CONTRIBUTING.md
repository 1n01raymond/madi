# Contributing to MADI

MADI is in an early vertical-slice phase. Contributions that sharpen a use case,
add reproducible evidence, challenge an assumption, or reduce implementation
risk are as valuable as code.

## Before opening a change

1. Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.
2. Search existing issues and architecture decision records.
3. For a large change, open a design issue before implementation.
4. Keep vendor-specific code behind an adapter boundary.
5. Do not commit proprietary CAD models or data derived from them without
   explicit redistribution rights.

## Branch and pull request workflow

MADI uses a lightweight GitHub Flow with `main` as its only permanent
development branch.

1. Create a short-lived work branch from the latest `main`.
2. Use a descriptive prefix such as `feat/`, `fix/`, `docs/`, `perf/`, or
   `spike/`.
3. Open a Draft PR early for risky or cross-cutting work.
4. Keep one logical change in each PR and record exact validation results.
5. Resolve review conversations, then squash-merge into `main`.
6. Delete the work branch after merge.

Direct pushes, force pushes, and merge commits are not part of the normal
workflow. During the single-maintainer bootstrap phase a PR is required but a
peer approval is not. See [the branching and release policy](docs/BRANCHING.md)
for branch names, merge rules, release backports, tags, and enforcement gates.

## Change categories

- `docs:` product, architecture, or API documentation;
- `feat:` a user-visible or public API capability;
- `fix:` a correctness or compatibility correction;
- `perf:` a change supported by benchmark evidence;
- `refactor:` internal structure with no intended behavior change;
- `test:` tests, fixtures, or benchmark harnesses; and
- `build:` packaging, CI, or dependency management.

## Development bootstrap

The TypeScript workspace requires Node.js 22.12 or newer and pnpm 11. From the
repository root:

```sh
pnpm install
pnpm check
pnpm dev
```

`pnpm check` validates ADR, fixture, OCCT, browser, and Phase 1 compiled
evidence, then lints, type-checks, tests, and builds every workspace package.
`pnpm phase1:compile:evidence` reproduces the first glTF package, while
`pnpm dev` opens the Phase 1 compiled glTF → Worker → direct WebGPU proof. Native OCCT work is isolated
under `native/adapter-occt`; run
`pnpm native:check` before configuring it. See the
[Phase 0 evidence record](docs/PHASE_0.md) for the completed feasibility gates,
current limits, and Phase 1 handoff.

## Documentation and translations

The English `README.md` is the canonical project landing page. Translations may
adapt phrasing naturally, but they should preserve project status, scope, and
technical claims. See `docs/TRANSLATIONS.md` for file naming, language status,
and terminology guidance.

Documentation-only contributions are welcome. A translation generated or
substantially assisted by a machine should be identified in the pull request so
a fluent reviewer can focus on terminology and natural phrasing.

## Architecture changes

Changes that affect a public API, serialized representation, trust boundary,
source-of-truth rule, or major dependency require an ADR under `docs/adr/`.
Proposed ADRs begin as `Status: Proposed` and become `Accepted` only after
review and their stated evidence gate. A reviewed ADR may remain Proposed when
the evidence is incomplete.

## Performance claims

Every performance pull request should include:

- the public or redistributable input model;
- cold/warm cache state;
- browser, OS, CPU, GPU, memory, and display resolution;
- exact build and command;
- median and p95 values across repeated runs; and
- a comparison against the previous commit.

## Developer certificate of origin

By contributing, you certify that you have the right to submit the work under
the repository license. Sign every contribution commit with `git commit -s`.
GitHub's web editor is configured to require the equivalent sign-off.
