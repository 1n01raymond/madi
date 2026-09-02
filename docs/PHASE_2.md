# Phase 2 Execution and Evidence Tracker

Status: Current (opened 2026-08-28)

Phase 2 turns the completed source-to-browser vertical slice into a usable
large-scene alpha. The [roadmap](ROADMAP.md) remains authoritative for scope and
exit criteria. This tracker owns the current work order, dependencies, and
evidence debt so the completed [Phase 1 tracker](PHASE_1.md) can remain a
historical record.

This document uses four states deliberately:

- **Recorded** means a committed artifact and validator reproduce the claim.
- **Implemented** means focused automated tests cover the behavior, but the
  Phase 2 product gate has not been recorded.
- **Partial** means only part of the stated gate has evidence.
- **Pending** means the capability or its required evidence does not exist yet.

An implementation is not a performance result, and validating a committed
record is not the same as re-running its native or headed recorder.

## North Star

Opening a real-large STEP or IFC source should expose structure and a useful
coarse view quickly, keep expensive import work cancellable, and make unchanged
or localized follow-up work proportional to what changed.

| User path | Product target | Current baseline | Gate state |
|---|---:|---|---|
| First real-large source import | Minutes are allowed | Five fresh-process cold sixty5 imports median 381.4 s, observed p95 385.3 s, peaking at a 5.08 GB process tree ([record](../artifacts/cache/sixty5/README.md)); their medians decompose it into 292.4 s of adapter extraction and 89.0 s of packaging | The cold cost is **Recorded**; progress, cancellation, background execution, and durable completion are **Pending** |
| Hierarchy and coarse preview during first import | 5–15 s | An already compiled sixty5 package reaches hierarchy/search in 2.3 s and its first coarse frame in a 4.487 s three-run median ([record](../artifacts/ifc/sixty5-first-frame/README.md)) | The compiled-package path is **Recorded**; publishing that preview while source import continues is **Pending** |
| Reopen unchanged inputs | 1–5 s | Five fresh-process warm sixty5 reopens median 1.36 s of compiler time and 1.43 s including `node` startup, 281× faster than the cold import that published the entry ([record](../artifacts/cache/sixty5/README.md)); mid-size single runs are 1.7 s for PyGamer STEP and 0.5 s for Digital Hub IFC ([record](../artifacts/cache/README.md)) | **Recorded** at real-large scale on one disclosed host |
| Change one IFC discipline | Work proportional to the affected dependency set | Unchanged document extraction can skip IfcOpenShell; federation-wide compiled resources are still rebuilt ([integration test](../native/adapter-ifc/tests/test_document_artifact_integration.py), [ADR-0010](adr/0010-ifc-incremental-dependency-index.md)) | Adapter reuse is **Implemented**; partial compiled-payload reuse is **Pending** |
| Reuse within a team | Avoid duplicate local import when policy permits | A local verified [whole-package cache](../artifacts/cache/README.md) and [document-artifact cache](../native/adapter-ifc/tests/test_document_artifact_cache.py) exist | Authorized shared lookup/publication is **Pending** |

The 4.487 s browser result above starts from an existing compiled package. It
must not be reported as a 4.487 s first source import. The complete product
contract, including cache identity and security, is in
[Import and compiled-cache product contract](IMPORT_AND_CACHE.md).

## Official exit criteria

Phase 2 exits only when all four criteria in the roadmap are recorded. Partial
signals are listed to prevent an adjacent result from being mistaken for a
closed gate.

| Roadmap criterion | Current evidence | Missing before exit | State |
|---|---|---|---|
| Public engineering baseline: 100k+ renderable geometric occurrences, 10M+ submitted triangles, and 10k+ geometric prototypes | The qualified [31-document sixty5 Design + Engineering package](../artifacts/ifc/engineering-baseline/README.md) passes all three floors together: 104,337 renderable occurrences, 46,059,890 submitted triangles, and 66,396 geometric prototypes; it reports 10,394,938 unique triangles and Khronos validation at 0 errors / 0 warnings | Publish the digest-locked 854,446,743-byte package, open it through Studio, and add public-delivery smoke evidence; this committed record qualifies the source and package but does not measure startup, rendering, or delivery | **Partial** |
| Cold/warm startup, frame, memory, and interaction results published | Real-large [first-frame](../artifacts/ifc/sixty5-first-frame/README.md), [localized-demand](../artifacts/spatial-demand/sixty5-localized/README.md), [memory-envelope](../artifacts/memory/sixty5-envelope/README.md), and five-sample [cold/warm/corrupt cache](../artifacts/cache/sixty5/README.md) records exist | One coherent matrix that presents them together, and a repeat on a second engine and operating system | **Partial** |
| Forced low-memory scenario remains functional | The [memory envelope](../artifacts/memory/sixty5-envelope/README.md) records three default-budget and three forced-low 8 MiB sixty5 runs: hierarchy, coarse rendering, navigation, source-aware selection, and eviction all complete in both profiles, and every reported byte names its owner, lifetime, and collection method rather than folding unmeasurable categories into zero | A repeat on a second engine and operating system, and a resident-set figure that does not depend on one browser's own estimator; GPU driver allocation stays unavailable | **Partial** |
| Workspace reopens against unchanged source and detects changed source | [Cache tests](../packages/compiler/test/compiled-cache.test.ts) inspect source identity, and [IFC dependency tests](../packages/compiler/test/ifc-incremental-dependencies.test.ts) detect changed/deleted/renamed inputs | A persisted workspace manifest with sources, views, and reopen behavior exercised through Studio | **Pending** |

No percentage-complete claim is derived from this table. The gates differ too
much in risk and effort for a raw item count to be meaningful.

## Workstreams

### A. Trustworthy incremental import

| Capability | Current state | Next acceptance gate |
|---|---|---|
| Verified whole-package cache | **Recorded** under accepted [ADR-0009](adr/0009-persistent-compiled-cache.md): [warm restore evidence](../artifacts/cache/README.md) is byte-identical and corruption fails closed, and a [real-large five-sample distribution](../artifacts/cache/sixty5/README.md) adds cold/warm/corrupt medians, cache footprint, and process-tree peak memory; [focused storage tests](../packages/compiler/test/compiled-cache.test.ts) cover identity and restore rules | Break the restore itself into stages, and repeat the distribution on a second host class |
| IFC dependency ownership | **Implemented** under proposed [ADR-0010](adr/0010-ifc-incremental-dependency-index.md), including [changed/deleted/renamed/reconciliation tests](../packages/compiler/test/ifc-incremental-dependencies.test.ts) | Keep the index conservative while physical payload ownership is introduced |
| Per-document IFC extraction reuse | **Implemented** with [deterministic verified-artifact tests](../native/adapter-ifc/tests/test_document_artifact_cache.py) and [clean adapter-merge equivalence](../native/adapter-ifc/tests/test_document_artifact_integration.py) | Measure real-large artifact size, restore time, and peak memory |
| Real-large document serialization | **Recorded** under accepted [ADR-0016](adr/0016-streamed-gltf-document.md): the compiler emits `scene.gltf` as a stream of bounded chunks instead of building it as one string, so the [sixty5 record](../artifacts/cache/sixty5/README.md) now compiles the default pretty-printed federation document at 545,470,166 B - 8,599,278 B past the runtime's 536,870,888-byte maximum string length - while the compact package stays byte-identical over fifteen samples; [differential tests](../packages/compiler/test/json-stream.test.ts) compare every chunk against `JSON.stringify` | Give the report, property, and dependency documents the same bounded treatment before any of them approaches the same limit |
| Assembly-tree transport | **Recorded** under accepted [ADR-0017](adr/0017-relocated-hierarchy-sidecar.md): `--relocate-hierarchy-nodes` moves mesh-less nodes into a `naru.package-hierarchy.1` sidecar, taking the engineering baseline's document from 405,570,167 to 317,466,183 B (-21.72%) and the whole package down 2.72% once the 64,825,238 B sidecar is charged against it ([record](../artifacts/compiler/hierarchy-relocation/README.md)); a Digital Hub round trip returns 13,681 entries and 5,152 world transforms with 0 mismatches. Paired sixty5 packages in a headed browser then measured what the smaller document buys: first coarse frame 4,408 -> 3,703 ms (-15.99%), peak JS heap -20.30%, sidecar fetched once per run ahead of the coarse payload, identical endpoint over 17 counters ([record](../artifacts/ifc/relocated-hierarchy-browser/README.md)) | Flip the default in its own slice, together with promoting `naru.package-hierarchy.1` out of `experimental-not-interchange` and the package re-digests that forces |
| Content-addressed compiled payloads | **Implemented, off by default** under proposed [ADR-0018](adr/0018-content-addressed-compiled-payloads.md): `--payload-cache <directory>` restores or builds one prototype payload at a time, publishes what it built, warns and rebuilds on a corrupt entry, and reports hits, misses, and degraded prototypes in `build-report.json`; [storage](../packages/compiler/test/compiled-payload-store.test.ts) and [orchestration tests](../packages/compiler/test/compiled-payload-cache.test.ts) pin identical package bytes across cold, warm, layout-changed, and corrupt-entry compiles | Record the acceptance evidence: a one-discipline rebuild that reproduces every clean-package byte, and a measured packaging saving that beats the store's own verification cost |
| Import lifecycle | **Pending** | A typed progress/cancellation contract must stop child processes, clean unpublished output, and retain prior valid cache entries |
| Progressive cold-import preview | **Pending** | Publish hierarchy/search and a recognizable coarse package within 5–15 s while the full import continues |
| Shared compiled cache | **Pending** and intentionally later | Require verified local immutable payloads plus authorization, tenant isolation, provenance, quota, and observability contracts first |

ADR-0010 remains Proposed until physical compiled-payload reuse and complete
clean-package byte equivalence pass. Its logical index and document cache do not
authorize reuse of old glTF byte ranges by themselves.

### B. Bounded large-scene fidelity

| Capability | Current state | Next acceptance gate |
|---|---|---|
| Fixed target-geometry residency | **Recorded**: [sixty5 target promotion](../artifacts/ifc/sixty5-browser/README.md) remains inside separate 64 MiB decoded/GPU admission budgets while coarse fallback remains visible, and the [memory envelope](../artifacts/memory/sixty5-envelope/README.md) separates those budgets from observed process memory across a default and a forced-low 8 MiB profile | Repeat the ledger on a second engine and operating system, then decide whether any category it ranks is worth optimizing |
| Spatial demand | **Recorded** on [focused Chrome/Firefox](../artifacts/spatial-demand/README.md) and [real-large Chrome](../artifacts/spatial-demand/sixty5-localized/README.md) paths under proposed [ADR-0008](adr/0008-spatial-demand-partitioning.md) | Repeat a localized real-model trace in a non-Blink engine and cross-check nested large-coordinate transforms |
| Demand ordering | **Recorded** as opt-in: [projected-area ordering](../artifacts/spatial-demand/sixty5-demand-priority/README.md) wins one pose and loses another | Define and record a view-independent screen-space-error or blended cost before changing the default |
| Shape-preserving LOD | **Pending** | Define geometric/screen error, identity and edge behavior, compiler representation, and reference-image gates |
| Persistent browser cache and cache-aware eviction | **Pending** | Define storage quota, digest verification, version invalidation, and interaction with memory residency |
| Broader selection residency | **Pending** | Multi-selection pinning must have a bounded policy and retain coarse visibility under pressure |

The fixed 64 MiB measurements apply to progressive target geometry admitted by
the runtime. They are not a claim that total process memory is bounded at every
scene size: the [memory envelope](../artifacts/memory/sixty5-envelope/README.md)
measures both quantities in the same runs and reports the geometry residency as
a small share of the browser's working set.

### C. Product and contributor platform

| Capability | Current state | Next acceptance gate |
|---|---|---|
| Public Studio | **Recorded** in the [Phase 1 exit evidence](PHASE_1_REPORT.md#exit-decision) for the deployed Digital Hub/PyGamer paths; the [Studio guide](../apps/webgpu-spike/README.md) documents the live smoke check | Keep deployment digests and Range delivery smoke-checked as package schemas move |
| Sidecar integrity | Spatial and property sidecar loaders verify declared byte lengths and SHA-256 values before decode; [property-sidecar tests](../apps/webgpu-spike/test/property-sidecar.test.ts) cover local and URL same-length mutations | Preserve the fail-closed checks while remote limits expand to geometry, coarse resources, and aggregate package work |
| Untrusted package limits | **Recorded** under [ADR-0011](adr/0011-remote-package-limits.md): one transport policy (same origin, `redirect: "error"`, content-type allowlist, byte ceilings enforced while the body streams) covers every Studio fetch, and the compiled-glTF reader bounds node/mesh/accessor/buffer-view/chunk counts and traversal depth; [transport tests](../packages/runtime-webgpu/test/package-transport.test.ts) and [structural tests](../packages/runtime-webgpu/test/compiled-gltf.test.ts) cover each branch. Malformed-package behavior is recorded in [`artifacts/security/package-fuzz`](../artifacts/security/package-fuzz/README.md) (120,000 seeded mutations, 0 uncontrolled outcomes), and the policy is now embedder-facing: [`artifacts/security/embedder-overrides`](../artifacts/security/embedder-overrides/README.md) drives it from [`tools/package-embedder`](../tools/package-embedder), a consumer outside the Studio -- five committed packages open on the reviewed defaults and ten scenarios exercise the ceiling, origin, and transfer axes. Both records run in the check chain (`pnpm fuzz:check`, `pnpm embedder:check`) | Exercise the same policy from a consumer outside this repository, and extend it to any resource kind a package gains |
| Workspace | **Pending** | Persist source references, views, selection sets, and source fingerprints; reopen unchanged state and report changed sources |
| Framework-neutral embedding | **Pending** | Publish and test one application outside the reference Studio |
| Installable alpha release | **Pending**; workspace packages remain private pre-release packages | Define the supported public surface, compatibility policy, release notes, and installation smoke test |
| Contributor issue workflow | **Established**: the `Phase 2 — Large-scene alpha (0.2.x)` milestone, the `area:`/`priority:`/`status:` label taxonomy, the issue forms under [`.github/ISSUE_TEMPLATE`](../.github/ISSUE_TEMPLATE), and a reviewed `status:ready` queue exist; this tracker owns outcomes, issues own independently assignable work with acceptance criteria | Keep each open issue's status label and each epic checklist in step with merged work, so the queue never lists a blocker that has already landed |
| Documentation link integrity | **Recorded**: `pnpm docs:links:check` resolves every repository-local Markdown link and heading anchor against Git's tracked paths, offline, and `pnpm check` runs it; [focused tests](../tools/markdown-links/test/markdown-links.test.ts) cover fences, percent encoding, duplicate headings, Unicode anchors, and repository escapes | Extend the same portable gate to any generated documentation the repository starts publishing |

## Dependency order

| Outcome | Required predecessors | Why the order matters |
|---|---|---|
| Partial IFC package rebuild | Dependency index and per-document artifacts (**Implemented**) → content-addressed compiled payloads (**Implemented**, off by default) → conservative invalidation/reconstruction → clean-package equivalence | Logical provenance cannot prove that revision-local byte ranges are reusable |
| Preview during cold import | Import lifecycle contract → cancellable background adapter → stable hierarchy/coarse publication point → Studio progress UI | Publishing partial output without lifecycle and cleanup rules can expose incomplete or stale cache entries |
| Shape-preserving LOD | Error/identity contract → compiler representation → scheduler admission → visual and interaction evidence | An ordering heuristic is not an LOD representation and cannot establish fidelity |
| Persistent browser cache | Package integrity verification and resource limits → quota/version policy → cache-aware scheduler | Persisting unbounded or integrity-unverified remote resources enlarges the trust boundary |
| Workspace reopen | Stable source/cache identities → workspace manifest → change detection → Studio reopen evidence | A whole-package cache hit is not a saved workspace |
| Shared team cache | Immutable local payload reuse → authorization/provenance contract → remote lookup/publication → isolation evidence | Content knowledge must never imply access to proprietary source-derived data |
| Public `0.2.x` alpha | Integrity/resource hardening plus all four exit records | Package availability alone is not the evidence-gated alpha exit |

## Prioritized plan

### Now — close correctness and make the next performance claim measurable

1. Record the acceptance evidence
   [ADR-0018](adr/0018-content-addressed-compiled-payloads.md) demands, so it
   and [ADR-0010](adr/0010-ifc-incremental-dependency-index.md) can leave
   Proposed. The store itself is complete and off by default:
   `buildCompiledPayload` is the compiler's only geometry encoder,
   `appendGeometry` is that build followed by `appendCompiledPayload` (Digital
   Hub still reproduces its recorded package digest),
   `naru.compiled-payload-entry.1` entries publish atomically and restore only
   after the key is reproduced from the manifest and every byte verified, and
   `--payload-cache <directory>` on both compilers decides per prototype
   whether to restore or build, publishes what it built, warns and rebuilds on
   a corrupt entry, and reports hits, misses, publications, and degraded
   prototypes in `build-report.json`. Unit-scale byte identity across cold,
   warm, and corrupt-entry compiles is covered by tests. What remains is the
   record: clean-package resource equivalence with a changed discipline, and a
   measured packaging saving that beats the store's own verification cost at
   real-large scale without raising peak memory above a clean build's.

### Next — finish the user-visible import loop and bounded fidelity

1. Rebuild one changed IFC discipline from reusable payloads and prove every
   resulting package resource byte-identical to a clean full compile.
2. Define progress, cancellation, retry, cleanup, and durable-completion events;
   run import in a cancellable background process.
3. Publish hierarchy/search and coarse preview during that cold import inside
   the 5–15 s product target.
4. Deliver one shape-preserving LOD vertical slice with an explicit error and
   identity contract.
5. Add persistent browser cache tiers and cache-aware eviction after resource
   integrity verification and limits are complete.
6. Add the first minimal workspace manifest and prove unchanged reopen plus
   changed-source detection.
7. Close the most decision-relevant evidence debt and blockers: non-Blink
   real-large spatial demand, nested precision, a second-engine repeat of the
   memory ledger, and public Studio delivery of the qualified
   engineering-scale package.
8. Qualify the registered CadQuarry 1k STEP corpus through a bounded Parquet
   scanner, then compile its extracted parts as a CAD breadth/control record.
   Keep that synthetic corpus separate from the real public-baseline gate.
9. Make relocation the compiler default. Both halves of
   [ADR-0017](adr/0017-relocated-hierarchy-sidecar.md) are now measured — the
   document drops 21.72% offline
   ([record](../artifacts/compiler/hierarchy-relocation/README.md)) and a paired
   browser record puts that at -15.99% on first frame and -20.30% on peak heap
   ([record](../artifacts/ifc/relocated-hierarchy-browser/README.md)) — so what
   is left is the cost of flipping it: `naru.package-hierarchy.1` has to leave
   `experimental-not-interchange`, and every committed package digest, the
   deployed demo release asset, and the records that pin them have to be
   re-recorded together.

### Later — expand only after the core loop is reproducible

- authorized shared compiled cache;
- multi-selection residency and multi-view;
- improved sections, measurement, and snapping;
- property-value search and richer BIM/PMI schemas;
- framework-neutral embedding and a supported package/CLI release; and
- the broader hardware/browser matrix required for the final ADR-0003 decision.

## Evidence debt

Evidence debt means the behavior exists but the repository does not yet carry
the decision-quality record needed for the intended claim. It is different from
a missing capability; background import, LOD, workspace persistence, shared
cache, and remote-resource limits are implementation backlog, not evidence
debt.

| Debt | Record needed | Decision or claim blocked |
|---|---|---|
| Real-large reopen stage breakdown | A restore broken into its own stages — manifest read, resource verification, and file publication — rather than the single 1.36 s figure the [five-sample distribution](../artifacts/cache/sixty5/README.md) reports | Which part of a warm reopen would have to change if the 1–5 s target tightened; the distribution itself already closes the cold/warm/corrupt and cache-cost debt |
| Real-large document-artifact reuse | Repeat cold, warm, and one-document-changed extraction with artifact bytes, restore time, peak RSS, and clean-merge equivalence on a disclosed large fixture | Cost and scalability of the already-implemented per-document reuse tier |
| Cross-engine memory envelope | Repeat the [phase-sampled memory ledger](../artifacts/memory/sixty5-envelope/README.md) on a second engine and operating system, including whatever each reports in place of `measureUserAgentSpecificMemory` and the Windows process-tree sample | A memory claim that is not specific to one Chrome/Windows host |
| Cross-browser localized demand | Repeated Firefox or another non-Blink real-model localized trace with request order, query p50/p95, residency, and console results | ADR-0008 acceptance |
| Spatial precision cross-check | Nested-transform spatial bounds on the accepted ADR-0005 10,000 km fixture with no false negatives | ADR-0008 acceptance |
| Node-field elision at engineering scale | Re-record `artifacts/ifc/engineering-baseline/` on the host that produced it, with `--elide-derived-identifiers` and `--omit-default-node-transforms` declared, so the option pair is proven on the same package the qualification pins; the levers are measured on this Windows host, whose IFC split differs from that record's by a few bytes | ADR-0015 acceptance |
| Content-addressed payload reuse at scale | A changed-discipline rebuild whose every package resource matches a clean compile byte for byte, plus cold and warm packaging time, store footprint, and peak memory on Digital Hub and one real-large model | ADR-0010 and ADR-0018 acceptance; the store is implemented and tested at unit scale, but no record measures whether reuse beats its own verification cost |
| Current-toolchain large packages | Re-record Digital Hub and sixty5 with the current split.4 explicit-edge toolchain and synchronize the deployed package digest | Current-schema real-model claims |
| Renderer reference-hardware matrix | Repeat the existing harness on more disclosed discrete/integrated profiles with explicit edges and bounded residency | Hardware/browser portion of ADR-0003 acceptance or revision |

## Capability and external blockers

These items require implementation, diagnosis, licensed input, or a supported
external environment before recording alone can close them. They are not
evidence debt.

| Blocker | Required change or external condition | Gate blocked |
|---|---|---|
| Public engineering-package delivery | Publish the qualified [31-document package](../artifacts/ifc/engineering-baseline/README.md) at its recorded digest, open it through Studio, and smoke-check every resource and HTTP Range response; source/package qualification is already recorded | Complete Phase 2 public-scale exit and stronger ADR-0003 relevance |
| CAD breadth corpus qualification | Implement ADR-0014's bounded Parquet scanner, inspect the pinned CadQuarry 1k STEP corpus, and measure extracted-part compile outcomes without equating rows to prototypes | STEP/OCCT diversity coverage; explicitly not the real public-baseline gate |
| Cross-host IFC drift | Diagnose or deliberately scope the recorded 8-byte macOS/Windows Scene IR difference ([record](../artifacts/spatial-demand/digital-hub-localized/README.md)) | Cross-host cache portability claim |
| Real Safari rendering | Run on a Safari/macOS combination that exposes WebGPU under supported default settings; the current Sequoia record proves only graceful unsupported behavior | Safari renderer-conformance claim |

Every performance record follows [the benchmark rules](BENCHMARKS.md): disclose
input provenance, cache state, hardware/software, exact command and commit,
individual samples, median/p95, and limitations. Large or license-restricted
inputs remain outside Git and enter through the external fixture manifest.

## Execution contract

- The roadmap carries phase scope and exit criteria.
- This tracker carries current work order, dependency state, and evidence debt.
- ADRs carry public-format, trust-boundary, dependency, and major-technology
  decisions.
- GitHub issues carry reviewed, independently assignable work with explicit
  acceptance and validation steps; speculative Phase 3/4 ideas stay in the
  roadmap until they are ready to schedule.
- Pull requests carry implementation and only the validation results actually
  run for that change.
- Committed artifacts carry measured facts and remain explicit about host,
  browser, cache, and fixture boundaries.

The ready issue queue should stay intentionally small even if the roadmap is
large. Opening an issue is a promise that the maintainer can explain its scope,
review a contribution, and recognize completion.
