# Security evidence

Records that back the promises in [`SECURITY.md`](../../SECURITY.md) with
measurements rather than intent.

| Record | What it proves |
|---|---|
| [`package-fuzz/`](package-fuzz/README.md) | A seeded malformed-package campaign over the compiled-package readers: 120,000 mutated packages, every refusal through a declared error class. |
| [`embedder-overrides/`](embedder-overrides/README.md) | A second consumer driving the transfer policy: every committed package opens on the reviewed defaults, and each override axis -- ceilings, announced origins, an injected transfer -- refuses or admits with the message a host would see. |

Reader bounds themselves — the ceilings a package is checked against before it
is parsed or allocated — are specified in
[ADR-0011](../../docs/adr/0011-remote-package-limits.md).
