# ADR-0009: Key persistent compiled caches by complete import identity

Status: Accepted
Accepted: 2026-08-27

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
  same-parent rename; partial or corrupt entries are never hits. The storage
  layer rejects them; the compile orchestration reports the failure and falls
  back to a full recompile, so a damaged cache can never block compilation.
- Derive the compiler half of the key from a content hash of the compiler's
  own module files (plus Node/OS/architecture until cross-platform determinism
  is proven), so compiler changes invalidate entries without hand-maintained
  version bumps.
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

- Exact adapter identity requires deliberate version/fingerprint maintenance;
  the compiler fingerprint is automatic but makes every compiler edit a cold
  cache.
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
normalization, idempotent atomic publication, verified restore, storage-layer
rejection of corrupted entries, and an unchanged STEP cache hit that skips
extraction after the OCCT identity probe. IFC orchestration tests likewise prove a cheap
identity probe, unchanged adapter-skipping hit, stable package digest, retained
intermediate restore, and URI-hint invalidation. The acceptance gate defined in
`docs/IMPORT_AND_CACHE.md` is closed by the recorded product evidence in
`artifacts/cache/import-cache-evidence.json`
(`naru.import-cache-evidence.1`, validated by
`scripts/validate-import-cache-evidence.mjs` in the `pnpm check` chain): the
pinned PyGamer STEP fixture and the four-document Digital Hub IFC federation
each record a cold miss, a byte-identical warm restore (19.9 s → 1.7 s STEP,
46.3 s → 0.5 s IFC), and a corrupted-entry run that fails closed and recompiles
byte-identically. A later real-large record extends the same properties to the
seven-document sixty5 federation with five fresh-process samples per cache
state (`artifacts/cache/sixty5/sixty5-cache-evidence.json`,
`naru.sixty5-cache-evidence.1`, validated by
`scripts/validate-sixty5-cache-evidence.mjs`): cold median 381.4 s, warm median
1.36 s, corrupt-entry median 89.0 s, one package digest across all fifteen
samples, and a fallback that leaves the damaged entry unpublished.
