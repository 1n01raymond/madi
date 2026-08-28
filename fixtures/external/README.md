# External reference fixtures

This registry adds real public STEP and IFC sources without committing large
third-party binaries to NARU. `manifest.json` pins the exact source revision or
content-identity policy, retrieval contract, byte length, SHA-256 digest,
per-model license, attribution, and intended test role. Downloads stay in the
ignored `output/external-fixtures/` cache.

The registry deliberately separates two states:

- `qualified`: every selected file was downloaded, checksum-verified, and
  inspected as a STEP Part 21 envelope; reviewed aggregate evidence is
  committed under `artifacts/fixtures/external/`.
- `registered`: identity and licensing are pinned, but the source has not yet
  been promoted to reviewed evidence. It must not support a performance claim.

## Current ladder

| Dataset | State | Download | What it proves | What it does not prove |
|---|---|---:|---|---|
| `nist-pmi-step-files` | qualified smoke | 14.0 MB archive | AP242 edition 3 B-rep/PMI and an AP242 tessellated-geometry edge case | assembly or runtime scale |
| `ifc-bench-digital-hub` | qualified real-medium | 67.8 MB / 4 IFC files | real IFC4 federation across architecture, heating, plumbing, and ventilation | ship/plant scale or ADR-0003 performance |
| `ifc-bench-sixty5` | qualified real-large | 839.9 MB / 7 IFC files | real IFC2X3 federation an order of magnitude larger than Digital Hub, across architecture, structure, facade, kitchen, electrical, plumbing, and ventilation | IFC4-only semantics, renderer performance, or ADR-0003 evidence |
| `sixty5-engineering` | qualified real-large | 654.1 MB / 34 IFC files | official SDK-S1 Engineering vendor/fabrication federation delivered by a public Trimble Connect share | stable provider revision IDs, browser delivery, or renderer performance |

The qualified Digital Hub files contain 482,994 Part 21 entities in total,
including 79,663 `IfcRel*` relationships, 2,567 mapped items, twelve building
storeys, and 161,695 single-value properties. The qualified sixty5 files contain
11,376,756 entities across 167 distinct types, including 732,401 `IfcRel*`
relationships, 38,812 mapped items, seven buildings, 129 building storeys, and
2,867,886 single-value properties. These are source-complexity signals, not
triangle, occurrence, memory, or frame-time measurements.

The official SDK-S1 Engineering share contains 654,076,269 bytes and
11,892,551 Part 21 entities across 34 IFC2X3 documents. Its public share exposes
mutable latest-version URLs, so the registry pins each remote object ID and
filename and treats the independently verified byte length and SHA-256 as the
immutable revision identity under [ADR-0012](../../docs/adr/0012-mutable-public-fixture-downloads.md).

Every sixty5 document declares `IFC2X3`, so the federation qualifies the older
schema path rather than IFC4 additions such as `IfcProjectedCRS`.

## Commands

```sh
pnpm fixtures:external list
pnpm fixtures:external fetch nist-pmi-step-files
pnpm fixtures:external verify nist-pmi-step-files
pnpm fixtures:external inspect nist-pmi-step-files

pnpm fixtures:external fetch ifc-bench-digital-hub
pnpm fixtures:external inspect ifc-bench-digital-hub

# Deliberate 839.9 MB opt-in; never run by CI or the normal repository check.
pnpm fixtures:external fetch ifc-bench-sixty5 --allow-large
pnpm fixtures:external inspect ifc-bench-sixty5

# Deliberate 654.1 MB opt-in, resolved from the official public share.
pnpm fixtures:external fetch sixty5-engineering --allow-large
pnpm fixtures:external inspect sixty5-engineering
```

`pnpm fixtures:external:check` is offline. It validates manifest structure,
license snapshots, pinned identities, byte totals, and committed qualification
evidence without downloading a model. `pnpm check` includes that validation.

The fetcher refuses an existing file with the wrong digest, writes new downloads
through a temporary file, and renames only after size and SHA-256 verification.
For NIST's ZIP distribution it extracts only the two explicitly registered
members and verifies each member independently.

Manifest schema 1.1 also permits a dataset-level
`trimble-connect-public-share` downloader for a publisher whose stable public
share resolves to short-lived per-file URLs. Those assets register the remote
object ID and exact remote filename instead of an expiring URL. The fetcher
checks the share's public download permission, project, object identity, name,
and latest-version policy before resolving each HTTPS download, then applies
the same byte-length and SHA-256 checks. Direct-URL datasets retain their
existing shape. See [ADR-0012](../../docs/adr/0012-mutable-public-fixture-downloads.md).

## Why these sources

- The [NIST MBE PMI set](https://www.nist.gov/ctl/smart-connected-systems-division/smart-connected-manufacturing-systems-group/mbe-pmi-0)
  is a conformance corpus, not a benchmark. NIST explicitly
  permits unrestricted use of the test cases and STEP files and asks for
  acknowledgement. The two selected members cover a current AP242 edition 3
  B-rep case and the unusual tessellated FTC-08 file.
- [IFC-Bench](https://huggingface.co/datasets/sylvainHellin/ifc-bench)
  is useful because it preserves each project's own license and
  federation boundaries. Digital Hub is small enough for contributor workflows
  and contains the architecture/MEP split needed for an IFC adapter slice.
- `sixty5` is large enough to be a meaningful ingestion and memory-pressure
  tier. Its download stays opt-in, but its qualification run is reviewed and its
  per-file identity is committed.
- The official `sixty5-engineering` share adds vendor-authored precast, steel,
  facade, floor-system, and embedded-component documents. It is licensed at the
  pinned first-party SDK-S1 source revision; expiring delivery URLs are never
  treated as source identity.

Discovery catalogs are not automatically fixtures. [BIMData's R&D
list](https://github.com/bimdata/BIMData-Research-and-Development/blob/master/pages/IFC_FILES.md)
is a valuable index, but the linked models have heterogeneous provenance and no
single umbrella license. [`step.parts`](https://github.com/earthtojake/step.parts)
is useful as a broad part-import corpus, but its per-asset inherited licenses
and mostly individual-part focus make it a poor large-assembly runtime
benchmark. [OpenArm](https://github.com/enactic/openarm_hardware) has a useful
full STEP assembly, but its Google Drive delivery and CERN-OHL-S-2.0 obligations
need a separate provenance and distribution-policy review. These remain
candidate sources rather than checksum-locked datasets in this revision.

## Promotion rule

A registered dataset becomes qualified only when all of the following land in
one reviewed change:

1. every selected source file passes byte-length and SHA-256 verification;
2. its Part 21 envelope and schema are inspected without parse truncation;
3. aggregate evidence is committed with the current manifest digest;
4. license and attribution are rechecked at the pinned source revision; and
5. known scope limits are stated before the source is used in a benchmark.

Qualification still does not make a dataset ADR-0003 decision evidence. That
requires the same compiled output, visual features, camera trace, browser and
hardware matrix, and memory/frame-time methodology for NARU and the optimized
baseline.
