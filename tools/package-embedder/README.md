# `@naru3d/package-embedder`

A second consumer of the compiled-package loader, used as evidence rather than
as a product.

[ADR-0011](../../docs/adr/0011-remote-package-limits.md) bounds a remote package
before it is parsed or allocated and lets an embedding application change the
policy: its own ceilings, further origins a package may span, or a transfer it
performs itself. A surface nothing exercises is a claim, not a decision, so this
package opens packages the way an embedder would:

- it imports only the published `@naru3d/runtime-webgpu` entry point and shares
  no code with the Studio;
- it is headless -- Node's `fetch`, no DOM, no WebGPU -- so what it proves is
  about the loader, not about a browser;
- it chooses its own `PackageTransportPolicy` instead of inheriting one, and
  reports what that policy admitted.

`openCompiledPackage({ documentUrl, policy, packageLimits, representation })`
fetches the document under the policy, resolves and budgets the resources it
declares, fetches the requested binary, decodes it, and returns the decoded
totals together with the resolved policy and every URL it transferred.

It is first-party and was written alongside the surface it exercises. It settles
whether that surface is reachable and sufficient from outside the Studio; it
does not stand in for adoption by an unrelated application, which is a separate
gate in [`docs/PHASE_2.md`](../../docs/PHASE_2.md).

The record it produces is
[`artifacts/security/embedder-overrides`](../../artifacts/security/embedder-overrides/README.md),
recorded by `pnpm embedder:evidence` and validated by `pnpm embedder:check`.
