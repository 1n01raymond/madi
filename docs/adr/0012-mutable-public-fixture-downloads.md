# ADR-0012: Pin mutable public-share fixtures by content identity

Status: Proposed

## Context

The external-fixture manifest originally assumed that every asset had a stable,
direct HTTPS URL whose path included an immutable release or repository
revision. That assumption does not hold for the remaining sixty5 packages.
Their publisher distributes them through anonymous Trimble Connect public-share
links. The share token is stable, but the selected objects use their latest
versions and the per-object signed CDN URLs expire within hours.

Treating a signed URL as a revision would make the manifest expire. Treating
the current object as immutable would be false. Rejecting this source would
also discard the first-party CC BY 4.0 grant and the publisher's own federation
solely because of a transport detail.

## Decision

Manifest schema 1.1 adds an optional dataset-level `download` object for this
specific transport:

```json
{
  "provider": "trimble-connect-public-share",
  "apiBaseUrl": "https://…/tc/api/2.0",
  "projectId": "…",
  "shareToken": "…",
  "revisionPolicy": "content-digest-only"
}
```

Assets in such a dataset omit `url` and instead declare `remoteObjectId` and
the exact `remoteName`. They retain the same required `byteLength` and SHA-256
fields as direct-download assets. Existing direct-URL datasets keep their 1.0
shape unchanged under schema 1.1.

At fetch time the tool resolves the public share once per command and requires
all of the following before it requests any asset bytes:

- the share mode is `PUBLIC`, its permission is `DOWNLOAD`, and its project ID
  equals the manifest's `projectId`;
- every declared remote object exists exactly once, is a file, has the exact
  registered name, and has `useLatestVersion: true`;
- each `downloadurl` request uses the temporary bearer credential returned by
  the share lookup together with `x-share-token`;
- the download response carries the requested object ID and version ID, and
  its URL uses HTTPS.

The tool neither persists generated download URLs nor includes bearer tokens,
share tokens, or signed URLs in diagnostics. The downloaded body then goes
through the existing byte-length and SHA-256 verification before the temporary
file is renamed into the cache. A changed latest version therefore fails closed
until a contributor deliberately measures the new bytes and reviews a manifest
update.

`content-digest-only` is an explicit admission that the host exposes no
immutable source revision. It is not equivalent to a Git commit or release ID.
The content length and digest are the reproducible identity; the provider
fields only describe how to retrieve candidate bytes for that identity.

## Consequences

### Positive

- Expiring CDN URLs never enter Git history or evidence records.
- Mutable remote content cannot silently replace the reviewed fixture because
  the cache rename still depends on exact byte and digest verification.
- Share drift in access mode, project, object identity, filename, or latest-file
  policy is detected before a large transfer starts.
- The existing direct-URL path and its cache format remain unchanged.

### Negative

- Reproducibility still depends on the publisher keeping the public share
  available; a content digest proves identity but cannot restore deleted bytes.
- The public share token is a capability recorded in the manifest. Although it
  grants anonymous access by design, tooling must still avoid copying it into
  logs or error messages.
- Provider response fields are an external API contract. A compatible server
  change requires a reviewed resolver update even when the asset bytes do not
  change.
- A legitimate upstream replacement fails verification and requires a new
  manifest digest plus regenerated fixture evidence.

## Alternatives considered

- Commit the current signed CDN URLs. Rejected because they expire and may
  expose temporary credentials in repository history.
- Follow the publisher's `/download` web redirect. Rejected because it exposes
  a browser-oriented redirect containing the share token and does not validate
  object names or project identity.
- Mirror the IFC files under a NARU-controlled host. Rejected for now because it
  creates storage, attribution, takedown, and provenance obligations that the
  external-cache policy deliberately avoids.
- Trust the latest object without a digest. Rejected because it turns a mutable
  public share into an unreviewed input to evidence generation.
- Generalize schema 1.1 into a plugin system. Rejected because there is one
  measured need and a narrow, auditable provider is easier to secure.

## Validation

`tools/external-fixtures/test/external-fixtures.test.ts` uses mocked responses
to exercise one-share resolution, bearer and share-token request headers,
project and object drift, latest-version enforcement, download identity, HTTPS,
credential-safe errors, and the unchanged final byte/digest verification path.
The committed schema 1.1 manifest now registers the 34-file SDK-S1 Engineering
share as `qualified`: all 654,076,269 bytes were fetched, verified, and
inspected as valid IFC2X3 Part 21 documents, and the generated record is
`artifacts/fixtures/external/sixty5-engineering.json`.

`pnpm fixtures:external:check` validates the 1.1 provider metadata, pinned
license snapshot, current manifest digest, and committed qualification evidence
offline. This ADR makes no compile-time, render-time, occurrence-count,
triangle-count, or memory claim. The implementation and record satisfy its
technical validation gate; it remains Proposed until human review accepts the
decision.
