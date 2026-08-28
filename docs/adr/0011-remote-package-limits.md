# ADR-0011: Bound remote compiled packages before parsing or allocating

Status: Proposed

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

Each default is set above the largest package this repository actually
compiles, so the reviewed evidence keeps loading unchanged, and close enough to
it that a hostile package cannot claim orders of magnitude more work. The
measured column is the sixty5 federation (`output/ifc/sixty5-prb`,
657,116,508 bytes over five resources) except where a smaller package is the
deeper one.

| Bound | Largest measured | Default |
|---|---|---|
| glTF document bytes | 448,823,852 (sixty5 `scene.gltf`) | 1 GiB |
| One external resource's bytes | 120,707,064 (sixty5 `scene.bin`) | 1 GiB |
| Total declared package bytes | 657,116,508 (sixty5) | 2 GiB |
| External resources per package | 4 (sixty5) | 64 |
| glTF nodes | 188,320 (sixty5) | 2,000,000 |
| glTF meshes | 84,870 (sixty5) | 1,000,000 |
| glTF accessors | 343,886 (sixty5) | 4,000,000 |
| glTF buffer views | 343,886 (sixty5) | 4,000,000 |
| Progressive target chunks | 234 (sixty5) | 65,536 |
| Scene traversal depth | 7 nodes (Digital Hub) | 64 |

The depth row uses Digital Hub because federation depth is a property of the
IFC spatial structure rather than of model size: Digital Hub nests 7 glTF nodes
and 5 occurrences, PyGamer 4 and 2.

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
- Packages split across a CDN origin and a document origin are unsupported
  until a reviewed allowlist exists; no such package exists in this repository.
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

Focused Vitest coverage over mocked `fetch` and generated malformed packages,
covering each ceiling, each policy branch, and each cleanup path; the pinned
public demo continues to load under the reviewed defaults through
`pnpm demo:smoke`; and `pnpm check` runs the whole suite. This ADR stays
Proposed until the loader implementation is complete on both the transport and
structural halves and a headed browser check confirms that the recorded sixty5
and Digital Hub packages still open unchanged.
