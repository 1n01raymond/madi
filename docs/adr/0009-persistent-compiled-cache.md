# ADR-0009: Key persistent compiled caches by complete import identity

Status: Proposed

## Context

ADR-0002 makes source documents authoritative and compiled render payloads
disposable. Real-large IFC translation can take minutes, while users expect an
unchanged project to reopen in seconds. Reusing output from only a source hash
is unsafe when adapter versions, compiler behavior, or tessellation/chunking
options change. ADR-0004 also forbids treating a derived cache as a new CAD
interchange format without comparative evidence.

## Decision

- Address a compiled entry by normalized source roles/digests, exact adapter
  identity, cache-compatible compiler identity, compile-affecting options, and
  cache schema version.
- Store an immutable manifest with the package digest and every resource's
  portable path, byte count, and SHA-256.
- Verify a complete entry before restore and publish/restore through atomic
  same-parent rename; partial or corrupt entries are misses/errors, never hits.
- Keep source paths, workspace/UI state, credentials, and machine-specific
  output locations out of the key.
- Treat pre-1.0 cache schemas as disposable. Enable adapter-skipping hits only
  after that adapter exposes an exact cheap implementation/toolchain identity.
- Keep the cache derived and access-controlled. Shared cache authorization is
  separate from content identity.

## Consequences

### Positive

- Unchanged source can eventually skip minute-scale native extraction safely.
- Local and shared stores can use the same content identity and integrity
  contract.
- Cache deletion or schema replacement cannot lose authored engineering data.

### Negative

- Exact adapter/compiler identity requires deliberate version/fingerprint
  maintenance.
- One changed source initially invalidates the whole federation until a proven
  dependency index exists.
- Full-resource verification adds I/O before reuse; later evidence may justify
  trusted local metadata or tiered verification without weakening publication.

## Alternatives considered

- Key only by source file modification time or path.
- Key only by source SHA-256.
- Replace the standard glTF delivery profile with BSON or a monolithic custom
  container as the first cache step.
- Re-run adapters on every open and cache only browser network responses.

## Validation

The proposed `naru.compiled-cache-entry.1` foundation is implemented by
`packages/compiler/src/compiled-cache.ts`. Unit tests prove deterministic
normalization, idempotent atomic publication, verified restore, fail-closed
resource corruption, and an unchanged STEP cache hit that skips extraction
after the OCCT identity probe. Acceptance additionally requires the IFC
skip/digest gate and cold/warm timing distributions defined in
`docs/IMPORT_AND_CACHE.md`.
