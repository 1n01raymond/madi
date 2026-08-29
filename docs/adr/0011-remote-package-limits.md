# ADR-0011: Bound remote compiled packages before parsing or allocating

Status: Accepted
Accepted: 2026-08-29

## Context

`SECURITY.md` already declares remote endpoints untrusted and states that
network loaders enforce origin, redirect, size, checksum, and content-type
policy. Only part of that is true today. The Studio verifies declared byte
lengths and SHA-256 digests for the property and spatial sidecars, and the
Worker verifies that a `206` response matches the requested range, but the
compiled glTF document itself and the geometry buffers are read with an
unbounded `arrayBuffer()`, resource URIs are resolved with `new URL(uri, base)`
without an origin check, redirects are followed silently, and no response's
content type is examined.

Three consequences are already observable. A hostile or misconfigured host can
serve an unbounded body and exhaust the tab before any length is checked. A
package can name `https://other.example/scene.bin` in `buffers[0].uri` and the
Studio will fetch it. A dev server that answers a missing resource with its
SPA fallback returns `200 text/html`, and the loader currently discovers that
only when JSON parsing or binary decoding fails with an unrelated message.

Phase 2 plans broad external-input testing and a persistent browser cache tier.
Both enlarge this trust boundary, so the limits must be decided before either
lands, and they must be decided against measured packages rather than guesses.

## Decision

Treat a compiled package as untrusted input with a single, explicit budget
applied before the work it authorizes.

- **Scheme and credentials.** Package documents and their resources use `http:`
  or `https:` only. A URL carrying a username or password is rejected rather
  than stripped.
- **Origin.** Every resource URI resolves against the document URL and must
  land on the document's origin. Cross-origin resource references are rejected
  at resolution time, before any request is made.
- **Redirects.** Package fetches use `redirect: "error"`. The Studio does not
  follow redirects for package resources; an embedder that needs one resolves
  it before handing NARU a URL.
- **Content type.** A glTF document must answer `model/gltf+json` or
  `application/json`; a JSON sidecar `application/json`; a binary resource
  `application/octet-stream`. Parameters after `;` are ignored and comparison
  is case-insensitive. A response with no `Content-Type` is rejected, because
  every host this repository targets sets one.
- **Bytes.** Each response is bounded before it is buffered. When the resource
  has a declared length, that length is the bound and the received body must
  equal it exactly. Otherwise the applicable ceiling below is the bound. A
  `Content-Length` above the bound fails before the body is read; a missing or
  dishonest `Content-Length` fails during a streaming read that stops at the
  bound instead of buffering past it.
- **Aggregate.** The declared sizes of a package's resources are summed with
  checked arithmetic and compared against a total-package ceiling before the
  first geometry request.
- **Counts and depth.** Node, mesh, accessor, buffer-view, and target-chunk
  counts and traversal depth are bounded during inspection, and scene traversal
  uses an explicit stack so a deep package fails with a stable diagnostic
  instead of a `RangeError` from stack exhaustion.
- **Overrides.** Every ceiling is a documented default that an embedding
  application may raise or lower through one options object. Defaults are
  policy, not format: no compiled package records a limit, and changing a limit
  never changes package bytes.
- **Failure.** A rejected package leaves the previously loaded scene usable.
  Limit violations are `TypeError` or `RangeError` with the resource label, the
  measured value, and the bound.

### Default ceilings

These are backstops against a hostile declaration, not a size policy. A ceiling
set near the largest real model buys no safety that a ceiling an order of
magnitude above it lacks, because what stops an attacker is that every response
is bounded and checked at all. A tight ceiling does reliably turn a legitimate
larger federation into a load failure. Each default is therefore set far above
what this repository compiles. The measured column is the sixty5
federation (`output/ifc/sixty5-prb`, 657,116,508 bytes over five resources)
except where a smaller package is the deeper one.

| Bound | Largest measured | Default | Headroom |
|---|---|---|---:|
| glTF document bytes | 448,823,852 (sixty5 `scene.gltf`) | 1 GiB | 2.4x |
| One external resource's bytes | 120,707,064 (sixty5 `scene.bin`) | 2 GiB | 17.8x |
| Total declared package bytes | 657,116,508 (sixty5) | 8 GiB | 13.1x |
| External resources per package | 4 (sixty5) | 256 | 64x |
| glTF nodes | 188,320 (sixty5) | 2,000,000 | 10.6x |
| glTF meshes | 84,870 (sixty5) | 1,000,000 | 11.8x |
| glTF accessors | 343,886 (sixty5) | 4,000,000 | 11.6x |
| glTF buffer views | 343,886 (sixty5) | 4,000,000 | 11.6x |
| Progressive target chunks | 234 (sixty5) | 65,536 | 280x |
| Scene traversal depth | 7 nodes (Digital Hub) | 64 | 9.1x |

The depth row uses Digital Hub because federation depth is a property of the
IFC spatial structure rather than of model size: Digital Hub nests 7 glTF nodes
and 5 occurrences, PyGamer 4 and 2.

Two rows are not free choices. `documentBytes` is bounded from above by the
engine: both readers decode the document to a JavaScript string before parsing
it, so V8's maximum string length of 536,870,888 bytes is a wall this ADR
cannot move, and the repository has already crossed it once (a 631,943,761-byte
split.1 Scene IR). One GiB sits above that wall, so the limit never rejects a
document an engine would have accepted; raising it further would only allocate
more before the parse fails. `packageBytes`, at the other end, is the weakest
memory signal of the four, because the package is never fully resident: target
detail is admitted under a separate residency budget. It is a sanity bound on
the declaration rather than an allocation bound, and is set accordingly.

## Consequences

### Positive

- The claim already published in `SECURITY.md` becomes true for the loader.
- A missing resource that a host answers with an SPA fallback now fails with
  "expected application/octet-stream" instead of a decode error further in.
- Streaming enforcement means an absent or dishonest `Content-Length` cannot
  buy unbounded allocation.
- Cross-origin resource references, the cheapest way to make a shared package
  point somewhere else, are impossible rather than merely unusual.
- A persistent browser cache tier can be specified against a bounded, verified
  input instead of an unbounded one.

### Negative

- A host that redirects (for example `http:` to `https:`, or a bucket that
  normalizes a path) stops working until the embedder passes the final URL.
- Packages split across a CDN origin and a document origin are refused by
  default. An embedder that hosts one announces the second origin through
  `additionalOrigins`, which is a decision the host states rather than a rule
  the package can bend; no such package exists in this repository.
- Ceilings expressed in absolute bytes will need a deliberate revision the
  first time a package legitimately exceeds them, and that revision is a policy
  change requiring evidence, not a silent constant edit.
- A host that serves binaries as `application/binary` or omits `Content-Type`
  is rejected even though the bytes are valid.

## Alternatives considered

- Keep checking only declared lengths and digests. Rejected: both are read
  from the same untrusted document, and neither bounds the transfer that
  precedes them.
- Follow redirects and validate only the final origin. Rejected: the request
  has already been made when the final origin is known, and `redirect: "error"`
  is both stricter and simpler to test.
- Bound only the total package and not each response. Rejected: the document is
  fetched before any total is known.
- Put the limits in the compiled package as declared metadata. Rejected by
  ADR-0004's standards-first delivery: a limit that travels with the package is
  a limit the attacker sets.
- Enforce the limits in the compiler instead of the loader. Rejected: the
  compiler does not see third-party packages, which is exactly the case the
  loader must survive.

## Validation

Focused Vitest coverage over stubbed `fetch` and malformed documents, covering
each ceiling, each policy branch, and each cleanup path:
`packages/runtime-webgpu/test/package-transport.test.ts` for the transport half (URL
policy, budget arithmetic, request shape, the content-type allowlist, and the
bounded body reader on its declared-length, dishonest-length, truncated, and
undeclared-length paths) and `apps/webgpu-spike/test/scene-source.test.ts` for
resource resolution and the pre-fetch package budget over a real compiled
document. `packages/runtime-webgpu/test/compiled-gltf.test.ts` covers the
structural half. `pnpm check` runs the whole suite.

Both recorded packages were confirmed to open unchanged in headed Chrome
151.0.7922.139 under the reviewed defaults. The 657 MB sixty5 package was
loaded three times: every residency, geometry, and traffic counter matched the
previous record exactly (111/234 chunks, 66,686,508 decoded bytes, 2,255,235
triangles, 111 requests, 113 Range responses, 0 console issues), so
`artifacts/ifc/sixty5-first-frame/` was re-recorded for its timing and heap
figures alone. The Digital Hub localized trace reproduced its committed record
field for field, including both screenshots byte-identical
(`artifacts/spatial-demand/digital-hub-localized/compatibility/`), so that
record is unchanged.

A bound is only useful if what sits behind it fails predictably, so the readers
are also held to a stated contract: a mutated package is either accepted or
refused through a declared error class -- `CompiledGltfError` for the compiled
glTF loader, `SpatialDemandIndexError` for the demand sidecar -- and anything
else escaping a reader is a defect. A seeded campaign over six reader targets
and three committed packages,
[`artifacts/security/package-fuzz`](../../artifacts/security/package-fuzz/README.md),
runs 120,000 mutated packages and records 35,345 accepted, 84,655 refused, and
0 uncontrolled outcomes. It found a real defect on its first full run: four
call sites read `primitive.attributes.POSITION` off a mesh primitive nothing had
established was an object, so the identical campaign against the pre-fix loader
reports 102 uncontrolled outcomes in three kinds. `pnpm fuzz:check` re-validates
the record and `packages/runtime-webgpu/test/package-fuzz-campaign.test.ts`
reruns a bounded campaign inside `pnpm test`.

The override surface is now settled against a consumer other than the Studio.
The transport half moved out of the app and into the published runtime package
as `PackageTransport` (`packages/runtime-webgpu/src/package-transport.ts`), which
an embedder opens with three axes -- `limits`, `additionalOrigins`, and a `fetch`
it performs itself -- and which crosses a Worker boundary as a descriptor of
resolved values, so a Worker can inherit a policy but never widen one. The
Studio settles exactly one transport per load and carries it through the
document, both sidecars, the demand index, and every geometry range; it passes
no overrides, so every committed record and digest is unchanged.

[`artifacts/security/embedder-overrides`](../../artifacts/security/embedder-overrides/README.md)
records a second consumer, `tools/package-embedder`, driving that surface over
real HTTP from two origins: five committed packages open on the reviewed
defaults -- the regression this ADR needed -- and ten scenarios exercise the
axes, each refusal carrying the message that names the ceiling responsible.
Two of them answer questions this ADR left open: a split-host package is
refused by default and admitted once the embedder announces the second origin,
and an injected transfer opens a package without a single request reaching
either server while the ceilings still refuse an oversized declaration.
`pnpm embedder:check` re-validates the record in the check chain.

That consumer is first-party and was written alongside the surface it
exercises. It settles the question this gate asked -- whether the policy is
reachable and sufficient from outside the Studio -- and it does not stand in
for adoption by an unrelated application, which is the separate
framework-neutral embedding gate in `docs/PHASE_2.md`.
