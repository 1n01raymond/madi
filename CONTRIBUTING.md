# Contributing to MADI

MADI is in an architecture-first phase. Contributions that sharpen a use case,
add reproducible evidence, challenge an assumption, or reduce implementation
risk are as valuable as code.

## Before opening a change

1. Read `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.
2. Search existing issues and architecture decision records.
3. For a large change, open a design issue before implementation.
4. Keep vendor-specific code behind an adapter boundary.
5. Do not commit proprietary CAD models or data derived from them without
   explicit redistribution rights.

## Change categories

- `docs:` product, architecture, or API documentation;
- `feat:` a user-visible or public API capability;
- `fix:` a correctness or compatibility correction;
- `perf:` a change supported by benchmark evidence;
- `refactor:` internal structure with no intended behavior change;
- `test:` tests, fixtures, or benchmark harnesses; and
- `build:` packaging, CI, or dependency management.

## Architecture changes

Changes that affect a public API, serialized representation, trust boundary,
source-of-truth rule, or major dependency require an ADR under `docs/adr/`.
Proposed ADRs begin as `Status: Proposed` and become `Accepted` after review.

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
the repository license. Sign commits with `git commit -s` once implementation
work begins.
