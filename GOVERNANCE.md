# Governance

NARU is a maintainer-led open-source project in its Phase 2 large-scene alpha.
Governance remains lightweight during the single-maintainer bootstrap, while
making current work explicit enough for additional contributors to join.

## Roles

- **Users** open issues, test releases, and provide datasets and workflows.
- **Contributors** submit documentation, tests, adapters, and implementation.
- **Maintainers** review changes, publish releases, and steward architecture.

## Decision making

- Routine changes use pull-request review and maintainer consensus.
- The roadmap owns phase outcomes, the current phase tracker owns priority and
  evidence debt, and GitHub issues own reviewed, independently assignable work.
  Distant or insufficiently specified ideas remain in the roadmap instead of
  becoming an unmaintainable issue queue.
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
