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
| First real-large source import | Minutes are allowed | A historical split.1 sixty5 diagnostic took 302 s end to end in one run with a warm OS file cache ([record](../artifacts/ifc/sixty5/README.md)); a current-toolchain cold distribution is unrecorded | Progress, cancellation, background execution, and durable completion are **Pending** |
| Hierarchy and coarse preview during first import | 5–15 s | An already compiled sixty5 package reaches hierarchy/search in 2.4 s and its first coarse frame in a 4.283 s three-run median ([record](../artifacts/ifc/sixty5-first-frame/README.md)) | The compiled-package path is **Recorded**; publishing that preview while source import continues is **Pending** |
| Reopen unchanged inputs | 1–5 s | Recorded single warm runs are 1.7 s for PyGamer STEP and 0.5 s for Digital Hub IFC ([record](../artifacts/cache/README.md)) | Mid-size behavior is **Recorded**; a real-large three-run distribution is **Pending** |
| Change one IFC discipline | Work proportional to the affected dependency set | Unchanged document extraction can skip IfcOpenShell; federation-wide compiled resources are still rebuilt ([integration test](../native/adapter-ifc/tests/test_document_artifact_integration.py), [ADR-0010](adr/0010-ifc-incremental-dependency-index.md)) | Adapter reuse is **Implemented**; partial compiled-payload reuse is **Pending** |
| Reuse within a team | Avoid duplicate local import when policy permits | A local verified [whole-package cache](../artifacts/cache/README.md) and [document-artifact cache](../native/adapter-ifc/tests/test_document_artifact_cache.py) exist | Authorized shared lookup/publication is **Pending** |

The 4.283 s browser result above starts from an existing compiled package. It
must not be reported as a 4.283 s first source import. The complete product
contract, including cache identity and security, is in
[Import and compiled-cache product contract](IMPORT_AND_CACHE.md).

## Official exit criteria

Phase 2 exits only when all four criteria in the roadmap are recorded. Partial
signals are listed to prevent an adjacent result from being mistaken for a
closed gate.

| Roadmap criterion | Current evidence | Missing before exit | State |
|---|---|---|---|
| Public baseline scene with 100k+ occurrences and 10M+ triangles | The [public benchmark](../artifacts/benchmarks/heterogeneous-repeatability/README.md) reaches 100,000 occurrences and 10,223,768 submitted triangles | A redistributable engineering scene at that scale, with source/license provenance and a published package | **Partial** |
| Cold/warm startup, frame, memory, and interaction results published | Real-large [first-frame](../artifacts/ifc/sixty5-first-frame/README.md) and [localized-demand](../artifacts/spatial-demand/sixty5-localized/README.md) records exist; mid-size STEP/IFC [cache records](../artifacts/cache/README.md) publish single cold/warm runs | One coherent real-large cold/warm matrix with repeated samples, cache size, stage timing, total client memory, and interaction results | **Partial** |
| Forced low-memory scenario remains functional | [sixty5 browser evidence](../artifacts/ifc/sixty5-browser/README.md) retains all coarse occurrences and source-aware interaction while target geometry is admitted under separate fixed 64 MiB decoded/GPU budgets | An explicit forced-low-memory profile and total-process accounting; current residency counters do not bound hierarchy, sidecars, Worker state, JavaScript heap, or every GPU allocation | **Partial** |
| Workspace reopens against unchanged source and detects changed source | [Cache tests](../packages/compiler/test/compiled-cache.test.ts) inspect source identity, and [IFC dependency tests](../packages/compiler/test/ifc-incremental-dependencies.test.ts) detect changed/deleted/renamed inputs | A persisted workspace manifest with sources, views, and reopen behavior exercised through Studio | **Pending** |

No percentage-complete claim is derived from this table. The gates differ too
much in risk and effort for a raw item count to be meaningful.

## Workstreams

### A. Trustworthy incremental import

| Capability | Current state | Next acceptance gate |
|---|---|---|
| Verified whole-package cache | **Recorded** under accepted [ADR-0009](adr/0009-persistent-compiled-cache.md): [warm restore evidence](../artifacts/cache/README.md) is byte-identical and corruption fails closed; [focused storage tests](../packages/compiler/test/compiled-cache.test.ts) cover identity and restore rules | Add a repeated real-large reopen distribution and resource/RSS measurements |
| IFC dependency ownership | **Implemented** under proposed [ADR-0010](adr/0010-ifc-incremental-dependency-index.md), including [changed/deleted/renamed/reconciliation tests](../packages/compiler/test/ifc-incremental-dependencies.test.ts) | Keep the index conservative while physical payload ownership is introduced |
| Per-document IFC extraction reuse | **Implemented** with [deterministic verified-artifact tests](../native/adapter-ifc/tests/test_document_artifact_cache.py) and [clean adapter-merge equivalence](../native/adapter-ifc/tests/test_document_artifact_integration.py) | Measure real-large artifact size, restore time, and peak memory |
| Content-addressed compiled payloads | **Pending** | Define immutable prototype/target/coarse/spatial/property ownership, then prove a one-discipline rebuild reproduces every clean-package byte |
| Import lifecycle | **Pending** | A typed progress/cancellation contract must stop child processes, clean unpublished output, and retain prior valid cache entries |
| Progressive cold-import preview | **Pending** | Publish hierarchy/search and a recognizable coarse package within 5–15 s while the full import continues |
| Shared compiled cache | **Pending** and intentionally later | Require verified local immutable payloads plus authorization, tenant isolation, provenance, quota, and observability contracts first |

ADR-0010 remains Proposed until physical compiled-payload reuse and complete
clean-package byte equivalence pass. Its logical index and document cache do not
authorize reuse of old glTF byte ranges by themselves.

### B. Bounded large-scene fidelity

| Capability | Current state | Next acceptance gate |
|---|---|---|
| Fixed target-geometry residency | **Recorded**: [sixty5 target promotion](../artifacts/ifc/sixty5-browser/README.md) remains inside separate 64 MiB decoded/GPU admission budgets while coarse fallback remains visible | Separate target-residency accounting from total browser/Worker/GPU memory and record a forced-low-memory profile |
| Spatial demand | **Recorded** on [focused Chrome/Firefox](../artifacts/spatial-demand/README.md) and [real-large Chrome](../artifacts/spatial-demand/sixty5-localized/README.md) paths under proposed [ADR-0008](adr/0008-spatial-demand-partitioning.md) | Repeat a localized real-model trace in a non-Blink engine and cross-check nested large-coordinate transforms |
| Demand ordering | **Recorded** as opt-in: [projected-area ordering](../artifacts/spatial-demand/sixty5-demand-priority/README.md) wins one pose and loses another | Define and record a view-independent screen-space-error or blended cost before changing the default |
| Shape-preserving LOD | **Pending** | Define geometric/screen error, identity and edge behavior, compiler representation, and reference-image gates |
| Persistent browser cache and cache-aware eviction | **Pending** | Define storage quota, digest verification, version invalidation, and interaction with memory residency |
| Broader selection residency | **Pending** | Multi-selection pinning must have a bounded policy and retain coarse visibility under pressure |

The fixed 64 MiB measurements apply to progressive target geometry admitted by
the runtime. They are not a claim that total process memory is bounded at every
scene size.

### C. Product and contributor platform

| Capability | Current state | Next acceptance gate |
|---|---|---|
| Public Studio | **Recorded** in the [Phase 1 exit evidence](PHASE_1_REPORT.md#exit-decision) for the deployed Digital Hub/PyGamer paths; the [Studio guide](../apps/webgpu-spike/README.md) documents the live smoke check | Keep deployment digests and Range delivery smoke-checked as package schemas move |
| Sidecar integrity | Spatial and property sidecar loaders verify declared byte lengths and SHA-256 values before decode; [property-sidecar tests](../apps/webgpu-spike/test/property-sidecar.test.ts) cover local and URL same-length mutations | Preserve the fail-closed checks while remote limits expand to geometry, coarse resources, and aggregate package work |
| Untrusted package limits | **Pending** | Bound resource bytes, object counts, hierarchy depth, redirects/origins, and accepted content types; add malformed-package/fuzz coverage |
| Workspace | **Pending** | Persist source references, views, selection sets, and source fingerprints; reopen unchanged state and report changed sources |
| Framework-neutral embedding | **Pending** | Publish and test one application outside the reference Studio |
| Installable alpha release | **Pending**; workspace packages remain private pre-release packages | Define the supported public surface, compatibility policy, release notes, and installation smoke test |

## Dependency order

| Outcome | Required predecessors | Why the order matters |
|---|---|---|
| Partial IFC package rebuild | Dependency index and per-document artifacts (**Implemented**) → compiled payload ownership (**Pending**) → conservative invalidation/reconstruction → clean-package equivalence | Logical provenance cannot prove that revision-local byte ranges are reusable |
| Preview during cold import | Import lifecycle contract → cancellable background adapter → stable hierarchy/coarse publication point → Studio progress UI | Publishing partial output without lifecycle and cleanup rules can expose incomplete or stale cache entries |
| Shape-preserving LOD | Error/identity contract → compiler representation → scheduler admission → visual and interaction evidence | An ordering heuristic is not an LOD representation and cannot establish fidelity |
| Persistent browser cache | Package integrity verification and resource limits → quota/version policy → cache-aware scheduler | Persisting unbounded or integrity-unverified remote resources enlarges the trust boundary |
| Workspace reopen | Stable source/cache identities → workspace manifest → change detection → Studio reopen evidence | A whole-package cache hit is not a saved workspace |
| Shared team cache | Immutable local payload reuse → authorization/provenance contract → remote lookup/publication → isolation evidence | Content knowledge must never imply access to proprietary source-derived data |
| Public `0.2.x` alpha | Integrity/resource hardening plus all four exit records | Package availability alone is not the evidence-gated alpha exit |

## Prioritized plan

### Now — close correctness and make the next performance claim measurable

1. Establish the Phase 2 milestone, labels, issue forms, and a small reviewed
   ready queue. This tracker owns outcomes; issues own independently assignable
   work with acceptance criteria.
2. Record sixty5 cold/warm/corrupt-cache distributions, cache footprint,
   restore-stage timing, and peak RSS on a disclosed host.
3. Specify and implement content-addressed compiled prototype/chunk/property
   payloads without accepting ADR-0010 yet.
4. Bound remote package sizes, counts, nesting, redirects/origins, and content
   types before broad external-input testing.

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
   real-large spatial demand, nested precision, total-memory accounting, and an
   engineering-scale public baseline.

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
| Real-large reopen | At least three current-toolchain cold and warm sixty5 runs on one disclosed host, with cache bytes, stage timings, peak RSS, hit/miss reason, and corruption fallback | 1–5 s unchanged real-large reopen and cache-cost claim; the historical split.1 302 s warm-OS-cache diagnostic is not this distribution |
| Real-large document-artifact reuse | Repeat cold, warm, and one-document-changed extraction with artifact bytes, restore time, peak RSS, and clean-merge equivalence on a disclosed large fixture | Cost and scalability of the already-implemented per-document reuse tier |
| Forced target-residency profile | Repeat a deliberately constrained geometry budget with coarse visibility, picking, interaction, decoded/GPU charges, and eviction outcomes | Target-residency portion of the Phase 2 low-memory exit |
| Cross-browser localized demand | Repeated Firefox or another non-Blink real-model localized trace with request order, query p50/p95, residency, and console results | ADR-0008 acceptance |
| Spatial precision cross-check | Nested-transform spatial bounds on the accepted ADR-0005 10,000 km fixture with no false negatives | ADR-0008 acceptance |
| Current-toolchain large packages | Re-record Digital Hub and sixty5 with the current split.4 explicit-edge toolchain and synchronize the deployed package digest | Current-schema real-model claims |
| Renderer reference-hardware matrix | Repeat the existing harness on more disclosed discrete/integrated profiles with explicit edges and bounded residency | Hardware/browser portion of ADR-0003 acceptance or revision |

## Capability and external blockers

These items require implementation, diagnosis, licensed input, or a supported
external environment before recording alone can close them. They are not
evidence debt.

| Blocker | Required change or external condition | Gate blocked |
|---|---|---|
| Total-process memory accounting | Instrument JavaScript heap, Worker-owned arrays, hierarchy/sidecars, runtime-owned decoded/GPU geometry, and disclose GPU allocations the backend cannot enumerate | Whole-application bounded-memory claim and the complete Phase 2 low-memory exit |
| Public engineering-scale fixture | Qualify a redistributable 100k+ occurrence / 10M+ triangle source-derived engineering input or a documented design-partner aggregate | Phase 2 scale exit and stronger ADR-0003 relevance |
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
