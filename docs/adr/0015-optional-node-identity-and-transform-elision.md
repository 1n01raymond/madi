# ADR-0015: Allow opt-in node identity and transform elision

Status: Proposed

## Context

A compiled federation's `scene.gltf` is dominated by its node array. Measured
on the engineering baseline (`artifacts/compiler/node-field-elision/`,
`naru.node-field-elision.1`), the 268,002 nodes are 36.2% of the 405,570,167 B
compact document, and inside them four members each cost more than 5% of the
whole document: `extras.madi.semanticId` 5.43%, `prototypeId` 5.26%,
`sourceRef` 5.23%, and `matrix` 5.10%.

Two of those members are, on this input, mostly redundant rather than
informative. The IFC adapter derives `sourceRef` from `semanticId` on 268,001
of 268,002 nodes by a fixed string rule, and 76,172 nodes carry a matrix that
is either the identity or a pure translation, which glTF can express in fewer
bytes without arithmetic. Nothing about that redundancy is safe to assume:
`semanticId` derived from `prototypeId` — the other rule the format allows —
holds for **zero** nodes on both measured models, so the compiler must measure
each document rather than trust a naming convention.

The measurement also corrects the ranking this work started from. Mesh-less
hierarchy nodes are 163,665 nodes and 88,741,293 B (21.88% of the document),
several times either lever here. Moving them out of the document is a
separate, larger slice with its own transport question; this ADR deliberately
covers only the two compiler-local levers, and the record publishes the larger
candidate rather than hiding it behind the smaller win.

Elision cannot be implicit. Package digests and compiled-cache keys are part of
the reproducibility contract (ADR-0009), and a consumer that cannot reconstruct
an absent field would silently lose source traceability, so reconstruction must
be declared in the document itself and must need no second request.

## Decision

- The glTF compiler adds two opt-in options, `elideDerivedIdentifiers: true`
  and `omitDefaultNodeTransforms: true`, exposed on both CLI compile paths as
  `--elide-derived-identifiers` and `--omit-default-node-transforms`. They join
  the option family ADR-0013 established; the defaults are unchanged and
  byte-identical to output from before these options existed.
- `elideDerivedIdentifiers` declares one document-level rule at
  `extras.madi.nodeIdentityDerivation`, chosen by counting which rule actually
  holds across the scene's occurrences (`semanticId` from `prototypeId`;
  `sourceRef` from `semanticId` or from `occurrenceId`, whichever covers more
  occurrences, ties broken by a fixed order so two compilations agree). A node
  whose value matches the declared rule omits the member entirely; a node whose
  value differs keeps it explicitly; a node that has no such identity at all
  serializes `null`, so an absent key always means "reconstruct" and never
  "there was nothing here". The rule is document-level on purpose: a per-node
  discriminator would spend most of what the elision saves, and an elided node
  must cost zero bytes.
- `omitDefaultNodeTransforms` emits no transform member for an identity matrix
  and `translation` for a translation-only matrix. Any rotation or scale keeps
  its `matrix`; the compiler never decomposes, because a decomposition would
  not round-trip exactly. glTF composes `M = T · R · S`, so a translation-only
  recomposition is bit-exact.
- The runtime loader reconstructs both fields from the declared rule while
  parsing the document it already has — no lookup table, no second request, and
  no change to picking, section, tree, or property lookup, all of which key off
  the reconstructed identity exactly as before.
- A build whose document declares a derivation records
  `options.nodeIdentifiers: "derived-elided"`, and one that opts into the
  transform lever records `options.nodeTransforms: "default-omitted"`. Both
  options participate in compiled-cache identity, so an elided and a full
  package can never alias one cache entry.
- The `extras.madi` envelope gains one optional document-level member and no
  new extension or required package version. Standard glTF consumers are
  unaffected by the transform lever (both forms are core glTF) and see one
  additional `extras` member they are already required to ignore.

## Consequences

### Positive

- A federation can drop 23,459,373 B (5.78%) of its compiled document with both
  levers on, and the two savings are exactly additive because they touch
  disjoint members.
- Source traceability survives elision: every `semanticId` and `sourceRef` the
  runtime resolves is identical to the un-elided one, proven occurrence by
  occurrence rather than argued from the rule.
- The document declares its own reconstruction, so a consumer needs nothing
  beyond the bytes it already fetched.

### Negative

- The same Scene IR intentionally produces two package digests, so evidence and
  reproduction commands must state the node-field policy, exactly as ADR-0013's
  label policy already requires.
- A consumer that reads `scene.gltf` without applying
  `extras.madi.nodeIdentityDerivation` sees fewer identity fields than before;
  the members are optional in glTF terms but load-bearing in NARU terms.
- The identifier lever's saving is input-shaped, not universal: on both
  measured models the `semanticId` rule fires on no node at all, and a source
  whose `sourceRef` is unrelated to its `semanticId` would save nothing.
- Neither lever touches the largest item the measurement found (mesh-less
  hierarchy nodes, 21.88%), so this ADR does not claim to have solved document
  size.

## Alternatives considered

- Elide by default. Rejected for the ADR-0013 reason: it changes every
  historical package digest and cache key without opt-in.
- A per-node derivation flag. Rejected because the flag costs a member on every
  node, which is most of what removing a member saves.
- A side table mapping node index to identity. Rejected because the acceptance
  criterion is reconstruction without a lookup table or a second request; a
  table also reintroduces the bytes in another resource.
- Decompose every matrix to TRS. Rejected because a general decomposition is
  not bit-exact, and this repository treats determinism and exact round-trip as
  contracts, not tolerances.
- Intern identifier strings in a document-level table. Not rejected — deferred:
  it is a different lever (it would also reach `prototypeId`, `occurrenceId`,
  and `tags`) and needs its own measurement and reconstruction rule.

## Validation

`packages/compiler/test/gltf.test.ts` proves that opting in elides only the
members the declared rule reconstructs, that a node whose identity does not
follow the rule keeps both fields explicitly, that an identity-free node
serializes `null`, that a rotating or scaling node keeps its `matrix`, and that
the default output is unchanged.
`packages/runtime-webgpu/test/compiled-gltf.test.ts` proves the loader
reconstructs both fields from the document alone.
`packages/compiler/test/ifc-federation.test.ts` proves both options change
compiled-cache identity.

`artifacts/compiler/node-field-elision/` records the measurement on two real
models: the per-field byte split, the ranked levers, the measured savings, a
repeat compile that is byte-identical, the default variant reproducing the
package digest the sanctioned pipeline already wrote, and a full decode-side
round trip over Digital Hub — 5,152 occurrences, 13,681 hierarchy entries, and
5,152 instance transforms compared element by element with zero mismatches.
`pnpm node-fields:check` pins all of it.

This ADR remains Proposed. Its open gate is the re-recorded engineering
baseline package the issue asks for: the committed
`artifacts/ifc/engineering-baseline/` record was taken on a macOS host whose
IFC adapter emits a split a few bytes different from this Windows host's, so
re-recording here would retarget that record's digests for reasons unrelated to
this decision. Accepting this ADR needs that record refreshed on its own host,
with the option pair declared.
