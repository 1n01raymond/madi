# Malformed compiled-package campaign

Status: recorded product evidence for
[ADR-0011](../../../docs/adr/0011-remote-package-limits.md) and the
"Fuzz parsers and binary decoders" requirement in
[`SECURITY.md`](../../../SECURITY.md).

ADR-0011 bounds a remote package before it is parsed or allocated. A ceiling
only helps if what sits behind it fails predictably, so this record fixes the
contract the readers are held to and then tries to break it:

> A reader may **accept** a mutated package, or **refuse** it through a declared
> error class -- `CompiledGltfError` for the compiled-glTF loader,
> `SpatialDemandIndexError` for the spatial demand sidecar. Anything else that
> escapes a reader is an **uncontrolled** outcome and a defect.

Six targets cover the readers a browser client actually calls --
`parseCompiledGltf`, `inspectCompiledHierarchy`, `prepareCompiledGltfDecoder`,
`decodeCompiledGltf`, `decodeSpatialDemandIndex`, `querySpatialDemandIndex` --
over three committed packages plus a synthesized demand index.

| Target | Executions | Accepted | Refused | Uncontrolled |
|---|---:|---:|---:|---:|
| `explicit-edges/target` | 20,000 | 6,120 | 13,880 | 0 |
| `explicit-edges/coarse` | 20,000 | 3,791 | 16,209 | 0 |
| `repeated-fasteners/target` | 20,000 | 4,427 | 15,573 | 0 |
| `repeated-fasteners-ap242/target` | 20,000 | 11,866 | 8,134 | 0 |
| `repeated-fasteners-ap242/coarse` | 20,000 | 4,055 | 15,945 | 0 |
| `spatial-demand-index` | 20,000 | 5,086 | 14,914 | 0 |
| **total** | **120,000** | **35,345** | **84,655** | **0** |

Refusals land on the declared codes and nowhere else: `INVALID_BINARY`,
`INVALID_GLTF`, `UNSUPPORTED_GEOMETRY`, and `UNSUPPORTED_PROFILE` for the glTF
targets, `SpatialDemandIndexError` for the sidecar. The campaign takes 25.5 s.

## What it found

The campaign is not a formality: it found a real defect on its first full run.
Four call sites -- the vertex-pool key, batch measurement, and both decode paths
-- read `primitive.attributes.POSITION` off a mesh primitive that nothing had
established was an object, so a package declaring a `null` primitive, or one
whose `attributes` was missing, let a raw `TypeError` out of the loader.
Selection now settles both shapes once, in `selectMeshPrimitives`.

Running the identical seeded campaign against the loader as it stood before
that fix reports **102 uncontrolled outcomes across five of the six targets**,
in three kinds (`… (reading 'mode')`, `… (reading 'POSITION')` on `undefined`
and on `null`). The committed run reports 0. The regression cases live in
`packages/runtime-webgpu/test/compiled-gltf.test.ts`, and
`packages/runtime-webgpu/test/package-fuzz-campaign.test.ts` reruns a bounded
400-iteration campaign inside `pnpm test`, so the invariant is enforced before
it is ever recorded again.

The fix also **tightened acceptance for 15 of the 120,000 mutations** (35,360
accepted before, 35,345 after; nothing moved the other way). All fifteen are one
shape: an edge (`LINES`) primitive whose `attributes` is a primitive value
rather than an object. The old reader dereferenced it -- `false.POSITION` is
`undefined`, not a throw -- so the package passed preparation and failed only if
a client happened to request the range holding that mesh. Whether a package is
accepted must not depend on which byte range was asked for, so refusing it up
front is the intended behaviour, not collateral.

## Method

The campaign is deterministic: a mulberry32 stream seeded from the record's
`seed` and the target label produces every mutation, so the same inputs replay
on any host and the validator pins exact per-target counts.

Each iteration starts from a committed package, applies one to three document
mutations and one binary mutation, and runs the target's reader chain:

- **Document operators** -- `replace` (a poison value: `null`, `NaN`, a negative
  or fractional index, an over-large count, a string where a number belongs, an
  empty object or array), `delete`, `duplicate`, `truncate`, `swap`, `scale`,
  `retype`, and `chain` (rebuilds the node graph as a 1..200-deep parent chain,
  aimed at the traversal bound). Paths are enumerated under the roots a reader
  reads -- `accessors`, `bufferViews`, `buffers`, `meshes`, `nodes`, `scenes`,
  `extras` -- to a depth of 12.
- **Binary operators** -- `intact`, `truncate`, `flip` (a random byte), and
  `grow`. The seed buffer is never mutated in place.

Both halves are exercised on every glTF target; `spatial-demand-index` has no
document, so it is binary-only. Accounting is a closed ledger --
accepted + refused + uncontrolled equals executions for every target -- and the
validator asserts it, so a campaign that silently stopped running would fail
rather than pass.

Corpora are the committed packages already in this repository; nothing here
reads proprietary data:

| Corpus | Source record | Ranges exercised |
|---|---|---|
| `explicit-edges` | [`artifacts/ifc/explicit-edges`](../../ifc/explicit-edges/README.md) | target, coarse |
| `repeated-fasteners` | [`artifacts/phase1/repeated-fasteners`](../../phase1/README.md) | target |
| `repeated-fasteners-ap242` | [`artifacts/phase1/repeated-fasteners-ap242`](../../phase1/README.md) | target, coarse |

The spatial target's input is synthesized by the compiler's own
`encodeSpatialDemandIndex` (128 occurrences, 8 chunks), so no committed package
needs a `spatial.bin` sidecar for the sidecar reader to be covered.

## Reproduce

Validate the committed record, including re-hashing every corpus file from
disk:

```
pnpm fuzz:check
```

Re-record it (about 25 s, after `pnpm build`):

```
pnpm fuzz:evidence
```

## Files

| File | Contents |
|---|---|
| `package-fuzz-evidence.json` | The record: contract, method, corpus digests, and per-target counts. |

Recorder: `scripts/record-package-fuzz-evidence.mjs`. Validator:
`scripts/validate-package-fuzz-evidence.mjs`. The harness is
`scripts/lib/package-fuzz.mjs` with its targets in
`scripts/lib/package-fuzz-targets.mjs`; it imports nothing from the runtime --
the caller injects the reader chain -- so the recorder drives the built bundle
while `tools/package-fuzz/test/package-fuzz.test.ts` and the in-suite rerun
drive the sources.
