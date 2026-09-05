# Public demo records

Status: recorded delivery evidence for Phase 2 exit criterion 1, "a public
engineering baseline" ([tracker](../../docs/PHASE_2.md)), under proposed
[ADR-0023](../../docs/adr/0023-public-package-delivery-origin.md).

`pnpm demo:smoke --package-origin <url>` settles the delivery contract from
outside a browser: no redirect, an exact `Content-Length`, an allowlisted
`Content-Type`, CORS covering the site, an exposed `Content-Range`, and an
honest `206`. What that check cannot settle is whether the deployed Studio,
opened by a person with no query string, actually reads the package across
origins and reaches a picture. That is what this family records.

| Record | What it settles |
|---|---|
| [`digital-hub-origin/`](digital-hub-origin/README.md) | One headed Chrome run of the deployed Studio at `https://1n01raymond.github.io/naru/studio/` opening the Digital Hub package from `https://packages.blacktanlabs.com/naru/digital-hub/v1/`: hierarchy, first coarse frame, ready with all 45 chunks resident, 49 origin responses (45 of them `206` Range reads of `scene.bin`), and a pick with resolved properties, 0 console issues |

```sh
pnpm demo:browser:check
```

Re-record with `pnpm demo:browser:evidence`; it needs a headed browser, the
live site, and the live origin, and it verifies every origin resource against
the committed [Digital Hub build report](../ifc/digital-hub/build-report.json)
before and after the browser runs.

What this family does not settle: the 854,446,743-byte engineering baseline
(ADR-0023 gate 4, still owed), a second engine or operating system, and any
stable timing — the milestones cross two public CDNs and are bounded by the
validator, not pinned.
