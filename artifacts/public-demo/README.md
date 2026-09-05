# Public demo records

Status: recorded delivery evidence for Phase 2 exit criterion 1, "a public
engineering baseline" ([tracker](../../docs/PHASE_2.md)), under
[ADR-0023](../../docs/adr/0023-public-package-delivery-origin.md) (Accepted
2026-09-05 on the second record below).

`pnpm demo:smoke --package-origin <url>` settles the delivery contract from
outside a browser: no redirect, an exact `Content-Length`, an allowlisted
`Content-Type`, CORS covering the site, an exposed `Content-Range`, and an
honest `206`. What that check cannot settle is whether the deployed Studio,
opened by a person with no query string, actually reads the package across
origins and reaches a picture. That is what this family records.

| Record | What it settles |
|---|---|
| [`digital-hub-origin/`](digital-hub-origin/README.md) | One headed Chrome run of the deployed Studio at `https://1n01raymond.github.io/naru/studio/` opening the Digital Hub package from `https://packages.blacktanlabs.com/naru/digital-hub/v1/`: hierarchy, first coarse frame, ready with all 45 chunks resident, 49 origin responses (45 of them `206` Range reads of `scene.bin`), and a pick with resolved properties, 0 console issues |
| [`engineering-baseline-origin/`](engineering-baseline-origin/README.md) | One headed Chrome run of the same deployed Studio opening the 854,447,023-byte engineering baseline from `https://packages.blacktanlabs.com/naru/engineering-baseline/v1/` through the scene query: hierarchy, first coarse frame, the budget-limited ready state with 82 of 626 chunks resident under 64 MiB (544 refused before fetch), 87 origin responses (82 of them `206` Range reads of `scene.bin`), and a pick with 9 resolved property entries, 0 console issues; ADR-0023 gate 4 and Phase 2 exit criterion 1 |

```sh
pnpm demo:browser:check
pnpm demo:baseline:check
```

Re-record with `pnpm demo:browser:evidence` and `pnpm demo:baseline:evidence`;
both need a headed browser, the live site, and the live origin, and each
verifies every origin resource against the build report committed for it (the
[Digital Hub report](../ifc/digital-hub/build-report.json); the
[baseline report](engineering-baseline-origin/build-report.json) of the bytes
actually uploaded) before and after the browser runs.

What this family does not settle: a second engine or operating system, any
stable timing — the milestones cross two public CDNs and are bounded by the
validator, not pinned — and whether the public baseline bytes equal the macOS
[qualification record](../ifc/engineering-baseline/README.md)'s; they are this
host's compile of the same sources, and both digests are pinned.
