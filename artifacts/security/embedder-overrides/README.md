# Embedder transfer-policy overrides

Status: recorded product evidence for
[ADR-0011](../../../docs/adr/0011-remote-package-limits.md).

ADR-0011 bounds a remote package before it is parsed or allocated, and its open
gate was not the ceilings themselves but who could change them:

> This ADR stays Proposed until the embedder-facing override surface is settled
> against a second consumer; nothing in this repository exercises an override
> other than the tests.

The obstacle was reachability. The structural half of the policy shipped in
`@naru3d/runtime-webgpu`, but the transport half -- ceilings on transferred
bytes, the same-origin rule, and the transfer itself -- lived inside the Studio
app, where no embedder could reach it. It now ships with the runtime package as
`PackageTransport`, and this record is a host other than the Studio driving it.

That host is [`tools/package-embedder`](../../../tools/package-embedder): a
headless Node consumer that imports only the published entry point, shares no
code with the Studio, and chooses its own policy. It is first-party and was
written alongside the surface it exercises -- a second consumer, not an
independent adopter. What it demonstrates is that the surface is reachable and
sufficient from outside the app, not that someone else has adopted it.

## What the record shows

Every scenario runs against packages committed in this repository, served over
real local HTTP from two distinct origins. Ports vary per run, so the record
names them `origin-a` and `origin-b`.

**The reviewed defaults still open every committed package** -- the check-chain
regression [`docs/PHASE_2.md`](../../../docs/PHASE_2.md) asks for. Five opens,
each through the second consumer, each on the unmodified ceilings:

| Package | Range | Batches | Occurrences | Triangles | Binary bytes |
|---|---|---:|---:|---:|---:|
| `ifc/explicit-edges` | target | 1 | 1 | 12 | 492 |
| `ifc/explicit-edges` | coarse | 1 | 1 | 12 | 912 |
| `phase1/repeated-fasteners` | target | 3 | 10 | 2,076 | 188,044 |
| `phase1/repeated-fasteners-ap242` | target | 3 | 10 | 2,076 | 188,044 |
| `phase1/repeated-fasteners-ap242` | coarse | 3 | 10 | 36 | 2,736 |

**Each override axis is exercised, and each refusal names the ceiling that
stopped it.** A host debugging its own configuration reads these messages, so
they are pinned:

| Scenario | Axis | Outcome |
|---|---|---|
| `document-ceiling` | `limits.documentBytes` | refused: `… declares 65815 bytes; the limit is 65814.` |
| `resource-ceiling` | `limits.resourceBytes` | refused: `scene.bin declares 188044 bytes; the limit is 188043.` |
| `package-ceiling` | `limits.packageBytes` | refused: `The package declares more than 4096 bytes across its resources.` |
| `resource-count-ceiling` | `limits.resourceCount` | refused: `The package declares 3 external resources; the limit is 1.` |
| `structural-node-ceiling` | `packageLimits.nodes` | refused: `The package declares 13 nodes; the limit is 2.` |
| `structural-depth-ceiling` | `packageLimits.traversalDepth` | refused: `The active scene nests deeper than 1 nodes at nodes[1].` |
| `split-host-default` | `additionalOrigins` | refused: `… points at http://origin-b; package resources must stay on http://origin-a.` |
| `split-host-announced` | `additionalOrigins` | opened, binary transferred from `origin-b` |
| `injected-transfer` | `policy.fetch` | opened, 0 requests reached either server |
| `injected-transfer-bounded` | `policy.fetch` + `limits` | refused: `scene.bin declares 188044 bytes; the limit is 4096.` |

Fifteen scenarios: seven opened, eight refused.

Two of them answer questions ADR-0011 raised and left open. The same-origin
rule made a CDN-split package unloadable, which the ADR recorded as a
consequence; `split-host-announced` shows the embedder lifting it for exactly
the host it names, with the resource genuinely fetched from the second origin.
And a host that resolves its own URLs -- signing them, or reading from a cache
-- supplies `policy.fetch`; `injected-transfer` opens the package with
`servedRequests: 0`, proving the transfer never touched the network, while
`injected-transfer-bounded` shows the ceilings still apply to bytes the
embedder delivered itself.

## Method

Two `node:http` servers bind ephemeral loopback ports and serve the committed
packages; the recorder rewrites their addresses to `origin-a` and `origin-b`
before writing the record, and the validator refuses a record that still
carries a per-run address. Apart from `recordedAt`, two runs produce identical
JSON.

Each scenario reports one of two outcomes. An **opened** row carries what the
policy admitted -- the resolved ceilings and origins, the declared resources,
the decoded totals, every URL transferred, and `servedRequests`, the number of
HTTP requests the two servers answered while it ran. A **refused** row carries
the error name and the message a host would see. Refusals are the point of the
record, so nothing is caught and summarized: the message is the message.

No committed package is split across hosts. The two `origins` scenarios
therefore serve a **synthesized** document -- `repeated-fasteners-ap242` with
its buffer URIs rewritten to `origin-b`, nothing else changed -- and those rows
carry `synthesized: true`. Both binaries are the committed bytes.

Corpora are committed packages; nothing here reads proprietary data:

| Corpus | Source record |
|---|---|
| `ifc-explicit-edges` | [`artifacts/ifc/explicit-edges`](../../ifc/explicit-edges/README.md) |
| `step-repeated-fasteners` | [`artifacts/phase1/repeated-fasteners`](../../phase1/README.md) |
| `step-repeated-fasteners-ap242` | [`artifacts/phase1/repeated-fasteners-ap242`](../../phase1/README.md) |

The validator re-hashes every corpus file from disk, so the record cannot drift
away from the packages it claims to have opened.

## Reproduce

Validate the committed record:

```
pnpm embedder:check
```

Re-record it (a few seconds; builds the runtime package and the embedder
first):

```
pnpm embedder:evidence
```

## Files

| File | Contents |
|---|---|
| `embedder-override-evidence.json` | The record: gate, method, reviewed defaults, corpus digests, and the fifteen scenarios. |

Recorder: `scripts/record-embedder-override-evidence.mjs`. Validator:
`scripts/validate-embedder-override-evidence.mjs`. The consumer under test is
`tools/package-embedder`; the surface it drives is `PackageTransport` in
`packages/runtime-webgpu/src/package-transport.ts`.
