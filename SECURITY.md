# Security Policy

NARU processes complex, often proprietary engineering documents. Input files,
compiled caches, plugins, and remote endpoints are untrusted by default.

## Reporting

Until a private security contact is published, do not attach sensitive models,
credentials, or exploit samples to public issues. Open a minimal issue asking
for a private reporting channel without disclosing exploit details.

## Initial trust boundaries

- Native CAD and neutral exchange files are untrusted compiler inputs.
- Compiler adapters may contain native code and run outside the browser.
- Browser decoders operate in Workers and validate all lengths and offsets.
- GPU buffer allocation is subject to explicit per-model and global budgets.
- Plugins receive capability-scoped APIs rather than ambient application
  authority.
- Network loaders enforce origin, redirect, size, checksum, and content-type
  policy. The reviewed ceilings and the fetch policy that applies them are
  recorded in [ADR-0011](docs/adr/0011-remote-package-limits.md); an embedding
  application may lower them, never silently raise them.
- No document metadata is uploaded unless an embedding application explicitly
  configures a remote service.

## Security requirements

- Fuzz parsers and binary decoders. A seeded campaign over the compiled-package
  readers is recorded in
  [`artifacts/security/package-fuzz`](artifacts/security/package-fuzz/README.md):
  120,000 mutated packages, every refusal through a declared error class.
- Use checked arithmetic for offsets, counts, and allocation sizes.
- Reject recursive or cyclic structures beyond configured limits.
- Treat decompression ratios and nested archives as resource-exhaustion risks.
- Verify cache chunks with content hashes before decoding.
- Keep credentials out of project files and plugins.
- Recover from malformed input without leaving stale GPU resources.

## Supported versions

No supported production release exists yet. This section will be updated when
the first release is published.
