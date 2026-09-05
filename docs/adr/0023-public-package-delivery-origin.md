# ADR-0023: Serve public demo packages from a Cloudflare R2 delivery origin

Status: Proposed

Reviewed: 2026-09-05

## Context

Phase 2 exit criterion 1 is qualified but not delivered. The
[engineering baseline record](../../artifacts/ifc/engineering-baseline/README.md)
proves the 31-document sixty5 Design + Engineering package clears all three
floors together, and what remains is delivery: publish the digest-locked
854,446,743-byte package, open it through the Studio, and record a
public-delivery smoke result.

Delivery is blocked by the mechanism the current demo uses, not by the package.
`.github/workflows/deploy-demo.yml` downloads the Digital Hub package at deploy
time and hands it to Vite as `NARU_SCENE_DIR`, which
[`apps/webgpu-spike/vite.config.ts`](../../apps/webgpu-spike/vite.config.ts)
uses as `publicDir` -- so every package byte is copied *into* the GitHub Pages
site artifact. Digital Hub's ~63 MB fits under the published 1 GB site limit;
the workflow's own comment already records that sixty5's 657 MB is
"deliberately excluded", and the 854 MB baseline is further outside it again.
Making the site bigger is not available, so the package has to leave the site.

Three properties of the shipped loader decide what an outside origin has to do.
They were read from the code, not assumed:

- **A cross-origin package already loads.** `parseSceneUrl`
  ([`scene-source.ts`](../../apps/webgpu-spike/src/scene-source.ts)) accepts any
  HTTP(S) URL without credentials via `assertPackageUrl`, and
  `resolvePackageResourceUrl`
  ([`package-transport.ts`](../../packages/runtime-webgpu/src/package-transport.ts))
  resolves each declared resource against **its own document's** origin, since
  `allowedOrigins` defaults to `[documentUrl.origin]`. A package served whole
  from one other origin therefore needs no `additionalOrigins`, no embedder
  policy override, and no change to [ADR-0011](0011-remote-package-limits.md).
- **Range delivery fails closed on a header CORS hides by default.** The
  geometry Worker rejects a 206 whose `Content-Range` it cannot read or that
  does not match the request
  ([`geometry.worker.ts`](../../apps/webgpu-spike/src/geometry.worker.ts)).
  `Content-Range` is not a CORS-safelisted response header, so an origin that
  omits `Access-Control-Expose-Headers: Content-Range` yields a page that loads,
  reports no error the user can act on, and never receives geometry.
- **Redirects are refused.** The transport fetches with `redirect: "error"`, so
  a GitHub Release asset URL -- which answers 302 with a per-download CDN
  location -- can be fetched by a CI job but can never be a loader target. The
  release-asset trick that supplies Digital Hub today does not generalise into
  a delivery path.

The current deploy's trust anchor is a digest check: every downloaded file's
SHA-256 is compared against the committed `build-report.json` before the site
is published. Moving the bytes must not move that anchor.

## Decision

Keep the site on GitHub Pages and move only compiled packages to a Cloudflare
R2 bucket published under a custom domain, under an explicit origin contract.

1. **Delivery-origin contract.** An origin qualifies only if, for every
   declared resource of a published package, it answers over HTTPS with: no
   redirect; `200` carrying an exact `Content-Length`; a `Content-Type` inside
   the loader's per-kind allowlist (`model/gltf+json` or `application/json` for
   the document, `application/json` for JSON sidecars, `application/octet-stream`
   for binaries); `Access-Control-Allow-Origin` covering the site origin;
   `Access-Control-Expose-Headers` including `Content-Range`; and an honest
   `206` with a matching `Content-Range` for a byte range.
2. **Immutable package prefixes.** A published package directory is never
   overwritten in place. A new compilation is published under a new prefix, so
   an edge-cached resource can never disagree with the document that names it.
3. **The Studio's default scene becomes build configuration.**
   `VITE_NARU_DEFAULT_SCENE_URL`, when set, must be an absolute HTTP(S) URL
   naming a compiled glTF document; unset keeps today's site-relative
   `${BASE_URL}scene.gltf` byte for byte. A configured value that is not usable
   is a build defect and is refused, never silently replaced by the
   site-relative default.
4. **Verification moves with the bytes.** Deployment verifies every declared
   resource's SHA-256 **at the live origin** against the committed build report
   before publishing a site that points there, and the public-demo smoke check
   asserts the contract in point 1 from outside.
5. **Fail closed.** If an origin cannot meet the contract, this decision is
   rejected and another origin is chosen. The loader's redirect refusal,
   content-type allowlist, byte ceilings, and `Content-Range` verification are
   not relaxed to accommodate a host.
6. **License travels with the package.** Any package published this way carries
   its fixture's license and attribution as recorded in
   `fixtures/external/manifest.json` -- Digital Hub is MIT; both sixty5
   datasets, and therefore the engineering baseline, are CC-BY-4.0 and require
   attribution wherever they are served.

Cloudflare R2 is chosen because the maintainer holds that account. The contract
above is vendor-neutral and the deployment reads the origin from a repository
variable, so a different qualifying origin is a configuration change, not a
code change.

## Consequences

### Positive

- The size ceiling that blocks exit criterion 1 disappears: the site artifact
  stops carrying package bytes, so what can be published no longer depends on
  what fits beside the application.
- No runtime change is needed to read a cross-origin package, so the trust
  boundary stays where [ADR-0011](0011-remote-package-limits.md) put it. The
  transport is exercised, not widened.
- Site deploys get smaller and faster, and a package can be republished without
  rebuilding the application.
- The same contract covers any future package -- including the ones this
  repository cannot commit -- without another delivery mechanism.

### Negative

- A second service to operate, pay for, and keep aligned with the repository. A
  demo that used to depend only on GitHub now depends on an origin outside it.
- Publication becomes two steps that can disagree: the package is uploaded, the
  site is deployed. Deploy-time digest verification at the origin is what keeps
  a stale upload from being presented as the committed record, and it turns a
  disagreement into a failed deploy rather than a wrong page.
- A CORS or Range misconfiguration is invisible to a page load: the Studio
  renders its shell and never receives geometry. This is why the smoke check
  asserts the exposed `Content-Range` header explicitly instead of inferring
  delivery from a 200.
- Package digests are host-local (recorded for Digital Hub in
  [the localized-trace record](../../artifacts/spatial-demand/digital-hub-localized/README.md)),
  so the maintainer must upload the package whose digests the committed build
  report names, not a locally recompiled one.
- The public demo's cost and availability become a maintainer responsibility
  rather than a property of the repository.

## Alternatives considered

- **Keep packages inside the Pages artifact.** Cannot hold the baseline: the
  site is also carrying the application and evidence media, and GitHub Pages
  publishes at most a 1 GB site. This is the status quo the decision replaces.
- **Point the loader at GitHub Release assets.** Refused by the transport's
  `redirect: "error"`, and a release asset is a tarball, not a resource tree
  addressable by range. Release assets remain a fine CI download, which is what
  the Digital Hub path already uses them for.
- **Git LFS.** Not a delivery origin, and it would put derived geometry into
  history, which `AGENTS.md` forbids.
- **Move the whole site to Cloudflare Pages.** Removes the site-size ceiling
  but not the problem: Cloudflare Pages enforces a per-file limit far below a
  448 MB compiled glTF document, so packages would still need object storage.
  It needs no runtime change and stays open as a later, independent decision.
- **Another object store (S3, GCS, a self-hosted origin).** Equivalent under
  the contract above; the deployment reads the origin from a variable precisely
  so this stays a configuration choice.

## Validation

Gate 0 is met by this slice, and the repository half of gates 1 and 2 is
implemented with it: `.github/workflows/deploy-demo.yml` reads the origin from
the repository variable `NARU_PACKAGE_ORIGIN`, verifies every declared
resource's SHA-256 at that origin before publishing a site that points there,
builds the Studio with `VITE_NARU_DEFAULT_SCENE_URL`, and
[`scripts/check-public-demo.mjs`](../../scripts/check-public-demo.mjs) asserts
the Decision's point 1 contract when given `--package-origin`. With the
variable unset the deployment keeps its current behaviour, so nothing here
depends on the decision being accepted.

The origin was provisioned on 2026-09-05: Cloudflare R2 bucket `naru-packages`
behind the custom domain `packages.blacktanlabs.com`, serving the committed
Digital Hub package at `https://packages.blacktanlabs.com/naru/digital-hub/v1/`
with the five declared resources uploaded at the digests
[`artifacts/ifc/digital-hub/build-report.json`](../../artifacts/ifc/digital-hub/build-report.json)
records, each under the `Content-Type` the compiler emits, next to
`LICENSE.txt` and `ATTRIBUTION.txt` for the MIT fixture (Decision point 6). Its
CORS rule allows `GET`/`HEAD` with the `Range` header from the GitHub Pages
origin and the local development origins and exposes `Content-Range`,
`Content-Length`, `ETag`, and `Accept-Ranges`; the repository variable
`NARU_PACKAGE_ORIGIN` names that prefix; the custom domain accepts TLS 1.2 or
newer only. The maintainer recipe lives in the
[Studio guide](../../apps/webgpu-spike/README.md). Gates 1 and 2 closed with
the first deployment that read the variable, GitHub Actions run
[33954446446](https://github.com/1n01raymond/naru/actions/runs/33954446446)
on `c55814c` (2026-09-05). An exploratory headed-Chrome load of the deployed
Studio, opened without a query, reached hierarchy, first frame, 45
`Content-Range` responses, and a pick with no console issues, but that run is
not committed evidence and gate 3 stays open until one is recorded.

0. **Loader wiring proven by tests.** `resolveDefaultSceneUrl` refuses a
   relative value, a non-HTTP(S) scheme, embedded credentials, a query or
   fragment, and a directory URL, and falls back to the site-relative document
   when the variable is unset or empty
   ([tests](../../apps/webgpu-spike/test/default-scene.test.ts)). **Met.**
1. **The origin meets the contract.** `pnpm demo:smoke --package-origin <url>`
   passes for every declared resource of the published package: no redirect,
   exact `Content-Length`, allowlisted `Content-Type`, `Access-Control-Allow-Origin`
   covering the site origin, `Access-Control-Expose-Headers` carrying
   `Content-Range`, and an honest `206`. **Met** 2026-09-05: the smoke check
   passed against the deployed site with the seven package resources and four
   Range responses served from the origin, the default scene resolving to
   `https://packages.blacktanlabs.com/naru/digital-hub/v1/scene.gltf`.
2. **Digests verified at the origin.** The deploy verifies every declared
   resource's SHA-256 at the live origin against the committed build report,
   and a mismatch fails the deploy. **Met** 2026-09-05: run 33954446446 ran
   in delivery-origin mode, verified the five Digital Hub resources at the
   origin, and published the site.
3. **A browser record of a cross-origin package.** The deployed Studio opens a
   package served by the origin and reaches hierarchy, first frame, and a pick.
4. **The baseline delivered.** The 854,446,743-byte engineering baseline is
   published this way and opened through the Studio, which is what Phase 2 exit
   criterion 1 asks for.

Failing gate 1 or gate 2 rejects this decision. Neither is closed by relaxing
the loader.
