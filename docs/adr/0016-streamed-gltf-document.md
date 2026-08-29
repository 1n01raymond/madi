# ADR-0016: Serialize the compiled glTF document as a stream

Status: Accepted
Accepted: 2026-08-29

## Context

`compileSceneToGltf` built its output document with a single
`JSON.stringify(document, null, indent)` and returned the result as
`CompiledGltfPackage.json: string`. Every caller then treated that string as
the document: the packager wrote it, the build report measured it with
`TextEncoder().encode(json).byteLength`, and the package digest hashed it.

That works until a document is larger than the runtime's maximum string
length. On this host V8 reports `536,870,888` bytes
(`require("buffer").constants.MAX_STRING_LENGTH`). Since explicit IFC boundary
edges became the default the sixty5 federation crosses it under the compiler's
default pretty-printed formatting. The previous recording of
`artifacts/cache/sixty5/sixty5-cache-evidence.json` measured the consequence:
`defaultFormattingProbe.outcome` was `failed`, with
`RangeError: Invalid string length` thrown from `JSON.stringify` after
376,070.6 ms of completed adapter extraction and packaging work. `--compact-json`
was therefore mandatory at real-large scale, which is a flag a user has to know
about to import their own model at all.

The string is also expensive below the wall. A 448.8 MB compact document is
held whole, encoded to UTF-8 a second time to measure it, and hashed a third
time, so the peak the compiler reaches is several multiples of the document.

## Decision

Serialize the document in bounded chunks and never hold it whole.

`packages/compiler/src/json-stream.ts` walks the value and emits chunks that
concatenate to exactly what `JSON.stringify(value, null, indent)` would have
produced. Byte identity is a hard requirement, not an aspiration: every
committed package digest, every validator pin, and the compiled cache's
integrity check all read the same bytes as before. Three delegations keep that
promise verifiable rather than reimplemented:

- strings are escaped by `JSON.stringify` itself, so no escape table is
  duplicated here and lone surrogates, C0 controls, and `\u2028`/`\u2029` are
  handled by the engine;
- finite numbers are formatted with `String`, which is the same Number::toString
  operation the specification gives the serializer, including `-0` as `0`;
- object keys come from `Object.keys`, whose order is the
  EnumerableOwnPropertyNames order the serializer uses.

`packages/compiler/src/json-document.ts` wraps that walk as a
`StreamedJsonDocument`: a recipe that reports `bytes` and `sha256` and writes
itself again on request. `CompiledGltfPackage.json` becomes that type. The
measuring pass also feeds the package hash, so the compiler serializes the
document once to measure it and once when the packager writes it -- the same
two passes it already paid for as stringify plus encode.

The packager writes the file with synchronous `writeSync` calls. The writer
hands over chunks synchronously, so queueing them for an asynchronous write
would rebuild in memory the whole-document copy this exists to avoid.

## Consequences

`CompiledGltfPackage.json` is no longer a string. That is a breaking change to
a public API of `@naru3d/compiler`; the package is `0.0.0` and pre-release, and
the only in-repository consumer was the packager. A caller that needs the text
of a document it already knows is small can call `json.text()`, which throws
past the string limit exactly as `JSON.stringify` did.

Cycles are not detected: a self-referencing value exhausts the stack instead of
reporting a circular structure, and a boxed `BigInt` serializes as an object
rather than throwing. No compiled document contains either.

Digital Hub proves byte identity at real scale rather than only in unit tests:
recompiling from the retained split at `output/ifc/digital-hub-split4/`
reproduces `scene.gltf` at 41,903,482 B with digest
`580262628478689792bfee41c1281c37ae9c4aab17c0a75a135922ba33154fa3` and package
digest `0e2ed4547e298908744ce7d9075900b1c55a4e88f26af7a6bef2ea7ee6c6595d`, and
the streamed characters compare equal to `JSON.stringify(document, undefined, 2)`
over the whole 41.9 MB document.

## Evidence gate

Met. `artifacts/cache/sixty5/sixty5-cache-evidence.json` was re-recorded on the
host that produced the `RangeError`, with the same fifteen-sample protocol.
`defaultFormattingProbe.outcome` is now `compiled`: the default pretty-printed
document measures `documentBytes` 545,470,166 against `maximumStringLength`
536,870,888, 8,599,278 bytes past the limit, and produced package
`67675e2aead37e90e1cfb06a1fbc2aea8fb0049bf53ea8d434efe52d54979d55` in 383,009.9 ms
at a 5.10 GB peak process tree -- within the spread of the compact cold samples
recorded beside it, so streaming a document that cannot be a string costs no
more memory than the compact one did.

Byte identity holds at that scale, which is the part that could have silently
broken every committed digest: the fifteen compact samples all produced package
`3206ea40835d8ca70a0a82208e397a8dcdcd66351b29b4df0e8102ff910e6454`, the digest
the previous recording published, byte-identical file by file over fourteen
comparisons. `scripts/validate-sixty5-cache-evidence.mjs` pins the outcome, both
byte counts, and the probe's package digest.
