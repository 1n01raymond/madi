# Governance

MADI begins as a maintainer-led open-source project. Governance should remain
lightweight while the architecture and first vertical slice are being proven.

## Roles

- **Users** open issues, test releases, and provide datasets and workflows.
- **Contributors** submit documentation, tests, adapters, and implementation.
- **Maintainers** review changes, publish releases, and steward architecture.

## Decision making

- Routine changes use pull-request review and maintainer consensus.
- Cross-cutting technical decisions use Architecture Decision Records.
- Maintainers follow the same branch and pull-request rules as contributors;
  see `docs/BRANCHING.md`. Repository-setting exceptions are reserved for
  security or recovery emergencies and must be documented afterward.
- Security reports follow `SECURITY.md` and are not discussed publicly until
  coordinated disclosure is complete.
- Serialized compatibility promises begin only after the first explicitly
  stable release. Before then, every artifact must carry a schema version.

## Project neutrality

The core project should not privilege one CAD vendor, one cloud provider, or
one UI framework. Vendor-specific integrations belong in replaceable adapters.
The reference Studio demonstrates the platform but does not define every valid
application built on the runtime.
