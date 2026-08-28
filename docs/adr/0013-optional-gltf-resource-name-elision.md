# ADR-0013: Allow opt-in glTF resource-name elision

Status: Proposed

## Context

Standard glTF `name` fields are optional display labels, but large NARU packages
emit one for every mesh, buffer view, and accessor. Those repeated diagnostic
strings add to `scene.gltf` without changing geometry, hierarchy,
materials, source identity, picking, or property lookup. The 31-document
sixty5 Design + Engineering qualification records a 405,570,167-byte compact
document against the recording host's 536,870,888-byte single-string limit, so
optional JSON growth must be an explicit package policy. This ADR makes no
before/after byte-savings claim for that model.

Names cannot be removed implicitly. Existing package digests and compiled-cache
keys are part of the reproducibility contract, and scene/node/material labels
remain useful to Studio users. Compiler validation also previously recognized
position accessors from a diagnostic name, which made that invariant unsafe to
elide until validation used semantic primitive references instead.

## Decision

- The glTF compiler adds an opt-in `omitResourceNames: true` option. The IFC
  CLI exposes the same decision as `--omit-resource-names`.
- The option omits only `name` on meshes, buffer views, and accessors. Scene,
  node, and material names remain. All `extras.madi` identities, source
  mappings, resource URIs, indices, accessors, buffers, and binary bytes remain
  semantically unchanged.
- The default remains named output and is byte-identical to output before this
  option existed.
- A build that opts in records `options.resourceNames: "omitted"`. The option
  participates in compiled-cache identity, so named and unnamed packages can
  never alias one cache entry.
- Validation derives position-accessor identity from each mesh primitive's
  `attributes.POSITION` index, not from an optional accessor label. Omitting
  names therefore cannot weaken POSITION min/max validation.
- The experimental glTF profile and `extras.madi` envelope do not change.
  Standard glTF consumers already must treat `name` as optional, so this is an
  option within the ADR-0004 representation rather than a new extension or
  required package version.

## Consequences

### Positive

- Real-large packages can remove repeated diagnostic strings while preserving
  user-visible hierarchy/material labels and every semantic identity.
- The package's geometry and sidecar bytes remain byte-identical across the two
  JSON label policies even though their package digests and cache entries differ.
- Internal correctness checks no longer depend on display text.

### Negative

- Tools that used mesh, buffer-view, or accessor labels for debugging see less
  descriptive JSON when the option is enabled.
- The same Scene IR can intentionally produce two package digests, so evidence
  and reproduction commands must state the label policy.
- This optimization only reduces JSON; it does not solve browser streaming,
  parse allocation, or the public delivery of an 854 MB package.

## Alternatives considered

- Remove all names by default. Rejected because it changes every historical
  package digest and removes useful scene/node/material labels without opt-in.
- Remove node and material names too. Rejected because those labels are part of
  Studio navigation and inspection, while the selected resource labels are
  diagnostic repetition.
- Shorten or hash every label. Rejected because it retains most object/property
  overhead, weakens debugging, and creates a new naming convention consumers
  might mistakenly treat as identity.
- Depend on minification alone. Rejected because compact JSON removes
  whitespace but not repeated optional strings; the two policies address
  independent bytes and are recorded independently.

## Validation

`packages/compiler/test/gltf.test.ts` proves that opting in removes only mesh,
buffer-view, and accessor names, preserves the parsed document after deleting
those fields from named output, leaves binary resources unchanged, and keeps
the unnamed package valid. A regression test deletes min/max from an unnamed
POSITION accessor and requires `POSITION_BOUNDS`, proving validation is driven
by primitive semantics. `packages/compiler/test/ifc-federation.test.ts` proves
the option changes compiled-cache identity and preserves node names.

The qualified 31-document engineering record uses compact JSON plus omitted
resource names and records the exact option, package digest, resource hashes,
and a clean Khronos result. This ADR remains Proposed until human review accepts
the option and its evidence.
