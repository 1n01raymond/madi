# ADR-0006: License MADI-owned code under Apache-2.0

Status: Accepted
Accepted: 2026-08-23

## Context

MADI is intended for open collaboration, commercial embedding, self-hosting,
research, and vendor-neutral infrastructure. The project may attract geometry,
rendering, compression, and workflow contributions where an explicit patent
grant is useful.

## Decision

MADI-owned code and documentation are licensed under Apache License 2.0 unless a
subdirectory clearly declares otherwise. Third-party dependencies retain their
licenses and obligations. Planned OCCT adapters must comply with OCCT's
LGPL-2.1-plus-exception terms and notices.

## Consequences

### Positive

- Permissive use, including commercial embedding and hosted services.
- Explicit contributor patent grant and termination terms.
- Familiar license for infrastructure projects and companies.

### Negative

- Downstream proprietary modifications are not required to be published.
- License/notice compliance must be managed for differently licensed adapters.
- The project name/logo require a separate trademark policy if adoption grows.

## Alternatives considered

- MIT for maximum brevity.
- MPL-2.0 for file-level copyleft.
- LGPL/AGPL for stronger downstream sharing requirements.

## Validation

The repository root carries the Apache License 2.0, JavaScript packages declare
`Apache-2.0`, MADI-authored STEP fixtures record Apache-2.0 provenance, and the
contribution workflow requires Developer Certificate of Origin sign-off. This
accepts the license for MADI-owned work.

Before the first packaged release, maintainers must add an automated third-party
license inventory and verify notices for every distributed dependency and
adapter. Trademark policy remains a separate future decision.
