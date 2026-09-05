/**
 * Validates ADR-0023 gate 4, the last open piece of Phase 2 exit criterion 1:
 * the DEPLOYED Studio opens the engineering baseline package from the delivery
 * origin, cross-origin, and reaches the hierarchy, a first coarse frame, the
 * budget-limited ready state, and a pick with resolved properties.
 *
 * How this record differs from the Digital Hub one (`demo:browser:check`):
 *
 *   - The Studio is opened THROUGH THE SCENE QUERY (`?scene=<document>`),
 *     not through the bundle's default scene, which stays Digital Hub. The
 *     record must say so (`deployment.openedVia`), and the page's own
 *     location must carry that query at ready.
 *   - The package is THIS HOST's compile of the qualified 31-document
 *     federation, digest `04472c9a...`, whose build report is committed next
 *     to the record. The committed qualification record
 *     `artifacts/ifc/engineering-baseline/` is a macOS compile
 *     (`6d23bffd...`); the two differ in `scene.gltf` (same byte length,
 *     different bytes) and `scene.bin` (280 bytes longer here), and share the
 *     other four resources byte for byte. Both digests are pinned below, and
 *     neither may be retargeted to make a run pass - a re-record that produces
 *     other bytes must re-upload the package and re-commit its build report.
 *   - The 64 MiB residency budget is REACHED: the settled resident set is a
 *     budget-limited subset of the 626 target chunks, identical over three
 *     recorded runs, and is pinned, as are the picked occurrence and its
 *     property count, which were identical too. Wall-clock milestones cross
 *     two public CDNs and are bounded, not pinned; the PNGs are re-hashed
 *     against the record but carry no literal (a browser update changes
 *     rasterization without changing the claim).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repositoryRoot = resolve(import.meta.dirname, "..");
const recordDirectory = resolve(repositoryRoot, "artifacts/public-demo/engineering-baseline-origin");
const recordPath = resolve(recordDirectory, "public-demo-browser.json");
const buildReportRelative = "artifacts/public-demo/engineering-baseline-origin/build-report.json";
const buildReportPath = resolve(repositoryRoot, buildReportRelative);
const qualificationReportPath = resolve(repositoryRoot, "artifacts/ifc/engineering-baseline/build-report.json");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[engineering-baseline-origin] ${message}`);
}

const recordText = await readFile(recordPath, "utf8");
const record = JSON.parse(recordText);
const buildReport = JSON.parse(await readFile(buildReportPath, "utf8"));
const qualification = JSON.parse(await readFile(qualificationReportPath, "utf8"));

assert(record.schemaVersion === "naru.public-demo-browser-evidence.1", "Unknown evidence envelope.");
assert(record.mode === "headed-deployed-studio-delivery-origin-load", "Evidence mode changed.");
assert(
  !/(?:^|[^A-Za-z])[A-Za-z]:[\\/]/u.test(recordText),
  "Evidence leaks a machine-local path.",
);
assert(record.host.platform === "win32", "Record was taken on another platform.");
assert(record.browser.engine === "Blink", "Record was taken on another engine.");
assert(record.browser.headless === false, "A headed browser is what this record claims.");
assert(
  record.browser.viewport.width === 1320 && record.browser.viewport.height === 1000,
  "Viewport changed, so the pick point and the screenshots are not comparable.",
);
assert(record.consoleIssues.length === 0, "The browser logged console issues.");

const SITE_URL = "https://1n01raymond.github.io/naru/";
const SITE_ORIGIN = "https://1n01raymond.github.io";
const STUDIO_URL = "https://1n01raymond.github.io/naru/studio/";
const PACKAGE_ORIGIN = "https://packages.blacktanlabs.com/naru/engineering-baseline/v1/";
const PACKAGE_ORIGIN_ORIGIN = "https://packages.blacktanlabs.com";
const DOCUMENT_HREF = `${PACKAGE_ORIGIN}scene.gltf`;
const OPENED_HREF = `${STUDIO_URL}?scene=${encodeURIComponent(DOCUMENT_HREF)}`;
/** This host's compile of the qualified federation; the bytes at the origin. */
const PACKAGE_DIGEST = "04472c9ad2929ba271d2c2c5bbcf16b6f6f7607582966ff9d86817c51f4e04d7";
/** The committed macOS qualification record; NOT the bytes at the origin. */
const QUALIFICATION_DIGEST = "6d23bffd6632345f8b2714684abbbb3b68ef59158beee4474b87b381f4df9acf";
const PACKAGE_BYTES = 854_447_023;
const QUALIFICATION_PACKAGE_BYTES = 854_446_743;
// Endpoint pins, identical over the three recorded runs (2026-09-05). The
// resident set is what the view-priority scheduler admits under the 64 MiB
// budget from the initial camera; a different set is a different record.
const TARGET_CHUNKS_TOTAL = 626;
const TARGET_CHUNKS_READY = 82;
const TARGET_CHUNKS_SKIPPED = 544;
const RESIDENT_DECODED_BYTES = 67_091_796;
const RESIDENT_GPU_BYTES = 67_095_764;
const VISIBLE_OCCURRENCES = 104_337;
const STATUS = "Residency budget reached · 11215 surface batches retained · 104337 renderable occurrences";
const PANEL_PROTOTYPES = "66396";
const PANEL_OCCURRENCES = "104337";
const PANEL_TRIANGLES = "1,217,463";
const PANEL_EDGES = "951,739";
const PANEL_SOURCE_FORMAT = "IFC2X3";
const ORIGIN_RESPONSES = 87;
const SCENE_BIN_RANGES = 82;
// The pick landed on the same occurrence with the same entries in all three runs.
const PICKED_OBJECT_ID = "4926";
const PICKED_ENTRY_COUNT = 9;
// Ready is bounded, not pinned: three runs measured 21.8, 29.0, and 33.5 s
// across two public CDNs, and a perturbed exploratory run took 188 s.
const READY_BOUND_MS = 120_000;

assert(record.site.url === SITE_URL, `Site changed to ${record.site.url}.`);
assert(record.site.origin === SITE_ORIGIN, "Site origin changed.");
assert(record.packageOrigin.url === PACKAGE_ORIGIN, `Package origin changed to ${record.packageOrigin.url}.`);
assert(record.packageOrigin.origin === PACKAGE_ORIGIN_ORIGIN, "Package origin's origin changed.");
assert(record.packageOrigin.crossOrigin === true, "The record does not claim a cross-origin load.");
assert(
  new URL(record.site.url).origin !== new URL(record.packageOrigin.url).origin,
  "Site and package origin share an origin; the record proves nothing about delivery.",
);

// The Studio was opened through the scene query; the bundle's default scene was not consulted.
const deployment = record.deployment;
assert(deployment.studioUrl === STUDIO_URL, "Studio URL changed.");
assert(deployment.openedVia === "scene-query", `The Studio was opened via ${deployment.openedVia}, not the scene query.`);
assert(deployment.openedHref === OPENED_HREF, `The opened URL was ${deployment.openedHref}.`);
assert(deployment.documentHref === DOCUMENT_HREF, `Document href changed to ${deployment.documentHref}.`);
assert(deployment.defaultSceneHref === null, "A scene-query record must not claim a default scene.");
assert(deployment.targetingAsset === null, "A scene-query record must not claim a bundle names this package.");
assert(deployment.scriptAssetCount >= 1, "No deployed script asset was inspected.");

// The browser was offered exactly the bytes of the committed host-local build report.
assert(record.buildReport.path === buildReportRelative, `Build report path is ${record.buildReport.path}.`);
assert(record.buildReport.packageDigest === PACKAGE_DIGEST, "Package digest changed.");
assert(buildReport.output.packageDigest === PACKAGE_DIGEST, "Committed host-local build report digest changed.");
assert(qualification.output.packageDigest === QUALIFICATION_DIGEST, "Committed qualification digest changed.");
assert(buildReport.source.sourceDigest === qualification.source.sourceDigest, "The two build reports compile different sources.");
const declared = buildReport.output.resources;
assert(declared.length === 6, `Build report declares ${declared.length} resources, expected 6.`);
assert(
  declared.reduce((sum, resource) => sum + resource.bytes, 0) === PACKAGE_BYTES,
  "Declared resources do not sum to the recorded package size.",
);
assert(
  qualification.output.resources.reduce((sum, resource) => sum + resource.bytes, 0) === QUALIFICATION_PACKAGE_BYTES,
  "The qualification record's resources do not sum to 854,446,743 bytes.",
);
// The host-local package differs from the qualification record in exactly the two geometry resources.
const qualified = new Map(qualification.output.resources.map((resource) => [resource.path, resource]));
for (const resource of declared) {
  const reference = qualified.get(resource.path);
  assert(reference !== undefined, `${resource.path} is not a qualification-record resource.`);
  if (resource.path === "scene.gltf" || resource.path === "scene.bin") {
    assert(resource.sha256 !== reference.sha256, `${resource.path} unexpectedly matches the macOS bytes; re-check the host-local claim.`);
  } else {
    assert(resource.sha256 === reference.sha256 && resource.bytes === reference.bytes, `${resource.path} differs from the qualification record.`);
  }
}
assert(declared.find((r) => r.path === "scene.gltf").bytes === qualified.get("scene.gltf").bytes, "scene.gltf byte length differs from the qualification record.");
assert(declared.find((r) => r.path === "scene.bin").bytes === qualified.get("scene.bin").bytes + 280, "scene.bin is not 280 bytes longer than the qualification record.");
assert(
  JSON.stringify(record.buildReport.resources) ===
    JSON.stringify(declared.map(({ path, mediaType, bytes, sha256 }) => ({ path, mediaType, bytes, sha256 }))),
  "The record's declared resources differ from the committed build report.",
);
for (const phase of ["verifiedBeforeBrowser", "verifiedAfterBrowser"]) {
  const verified = record.origin[phase];
  assert(Array.isArray(verified) && verified.length === declared.length, `${phase} covers ${verified?.length} resources.`);
  for (const [index, resource] of declared.entries()) {
    const seen = verified[index];
    assert(seen.path === resource.path, `${phase}[${index}] is ${seen.path}, expected ${resource.path}.`);
    assert(seen.bytes === resource.bytes, `${phase} ${resource.path} delivered ${seen.bytes} bytes.`);
    assert(seen.sha256 === resource.sha256, `${phase} ${resource.path} sha256 differs from the build report.`);
  }
}
const CONTENT_TYPES = new Set(["model/gltf+json", "application/json", "application/octet-stream"]);
for (const resource of record.origin.verifiedBeforeBrowser) {
  assert(resource.url === `${PACKAGE_ORIGIN}${resource.path}`, `${resource.path} was fetched from ${resource.url}.`);
  assert(resource.matchesBuildReport === true, `${resource.path} did not match the build report.`);
  assert(resource.contentLength === resource.bytes, `${resource.path} Content-Length differs from its bytes.`);
  const mediaType = String(resource.contentType ?? "").split(";")[0].trim();
  assert(CONTENT_TYPES.has(mediaType), `${resource.path} served as ${resource.contentType}.`);
  assert(mediaType === resource.declaredMediaType, `${resource.path} served as ${mediaType}, declared ${resource.declaredMediaType}.`);
  assert(resource.acceptRanges === "bytes", `${resource.path} does not advertise byte ranges.`);
  assert(
    resource.accessControlAllowOrigin === SITE_ORIGIN || resource.accessControlAllowOrigin === "*",
    `${resource.path} does not allow the site origin (${resource.accessControlAllowOrigin}).`,
  );
  const exposed = String(resource.accessControlExposeHeaders ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase());
  assert(exposed.includes("content-range"), `${resource.path} does not expose Content-Range.`);
}

// Milestones: ordered and bounded, never pinned (two public CDNs and a 405 MB document sit in the path).
const { hierarchyMs, firstCoarseFrameMs, readyMs } = record.milestones;
for (const [name, value] of Object.entries(record.milestones)) {
  assert(Number.isInteger(value) && value > 0, `${name} is not a positive integer.`);
}
assert(hierarchyMs <= firstCoarseFrameMs && firstCoarseFrameMs <= readyMs, "Milestones are out of order.");
assert(readyMs <= READY_BOUND_MS, `Ready took ${readyMs} ms, above the ${READY_BOUND_MS / 1000} s bound.`);
assert(typeof record.timingNote === "string" && record.timingNote.includes("public network"), "Timing caveat missing.");

// The Studio ran at the site with the scene query, read the package by URL, and settled on the recorded resident set.
const ready = record.stateAtReady;
assert(ready.location.href === OPENED_HREF, `The page ran at ${ready.location.href}.`);
assert(ready.location.origin === SITE_ORIGIN, "The page did not run at the site origin.");
assert(new URL(ready.location.href).searchParams.get("scene") === DOCUMENT_HREF, "The page's scene query does not name the origin document.");
assert(ready.sceneSource === "url", `Scene source was ${ready.sceneSource}.`);
assert(ready.sceneSourceLabel === DOCUMENT_HREF, `The Studio labelled its source ${ready.sceneSourceLabel}.`);
assert(ready.hierarchyReady && ready.coarseReady, "The Studio did not reach the hierarchy and a coarse frame.");
// A real-large package never reaches targetReady "true": the residency budget
// stops admission and the Studio settles in "limited", which is its `ready`.
assert(ready.targetReady === false && ready.targetReadyState === "limited", `Target readiness was ${ready.targetReadyState}, expected the budget-limited settle.`);
assert(
  ready.targetSchedulerCancellations === null || ready.targetSchedulerCancellations === 0,
  `${ready.targetSchedulerCancellations} scheduler cancellations; the record claims a settle without camera motion.`,
);
assert(ready.targetChunksTotal === TARGET_CHUNKS_TOTAL, `${ready.targetChunksTotal} target chunks, expected ${TARGET_CHUNKS_TOTAL}.`);
assert(buildReport.counts.targetChunkCount === TARGET_CHUNKS_TOTAL, "The build report's target chunk count changed.");
assert(ready.targetChunksReady === TARGET_CHUNKS_READY, `${ready.targetChunksReady}/${TARGET_CHUNKS_TOTAL} chunks resident, expected ${TARGET_CHUNKS_READY}.`);
assert(ready.targetSchedulerRequests === TARGET_CHUNKS_READY, `${ready.targetSchedulerRequests} chunk requests, expected ${TARGET_CHUNKS_READY}.`);
assert(ready.targetSchedulerSkips === TARGET_CHUNKS_SKIPPED, `${ready.targetSchedulerSkips} chunks refused before fetch, expected ${TARGET_CHUNKS_SKIPPED}.`);
assert(TARGET_CHUNKS_READY + TARGET_CHUNKS_SKIPPED === TARGET_CHUNKS_TOTAL, "Resident plus refused chunks must equal the total.");
assert(ready.residencyBudgetBytes === 67_108_864, `Residency budget ${ready.residencyBudgetBytes}.`);
assert(ready.residencyBudgetReached === "true", "The 64 MiB budget was not reached; this is not the budget-limited record it claims to be.");
assert(ready.residentDecodedBytes === RESIDENT_DECODED_BYTES, `Decoded bytes ${ready.residentDecodedBytes}.`);
assert(ready.residentGpuBytes === RESIDENT_GPU_BYTES, `GPU bytes ${ready.residentGpuBytes}.`);
assert(ready.residentGpuBytes <= ready.residencyBudgetBytes, "GPU bytes exceed the residency budget.");
assert(ready.visibleOccurrences === VISIBLE_OCCURRENCES, `${ready.visibleOccurrences} visible occurrences.`);
assert(ready.status === STATUS, `Status line changed: ${ready.status}`);
assert(ready.panel.prototypes === PANEL_PROTOTYPES, `Prototype count ${ready.panel.prototypes}.`);
assert(ready.panel.occurrences === PANEL_OCCURRENCES, `Occurrence count ${ready.panel.occurrences}.`);
assert(ready.panel.triangles === PANEL_TRIANGLES, `Triangle count ${ready.panel.triangles}.`);
assert(ready.panel.edges === PANEL_EDGES, `Edge count ${ready.panel.edges}.`);
assert(ready.panel.sourceFormat === PANEL_SOURCE_FORMAT, `Source format ${ready.panel.sourceFormat}.`);
const after = record.stateAfterPick;
assert(after.targetChunksReady === TARGET_CHUNKS_READY && after.residentGpuBytes === RESIDENT_GPU_BYTES, "The pick disturbed the resident set.");
assert(after.targetReadyState === "limited" && after.status === STATUS, "The Studio left its settled state after the pick.");

// Every origin response the page received: one full read per document, only Range reads of scene.bin.
const network = record.network;
assert(network.total === ORIGIN_RESPONSES, `${network.total} origin responses, expected ${ORIGIN_RESPONSES}.`);
const expectedResponses = {
  "scene.gltf": { responses: 1, status: "200" },
  "coarse.bin": { responses: 1, status: "200" },
  "spatial.bin": { responses: 1, status: "200" },
  "properties.json": { responses: 1, status: "200" },
  "properties.bin": { responses: 1, status: "200" },
  "scene.bin": { responses: SCENE_BIN_RANGES, status: "206" },
};
assert(
  JSON.stringify(Object.keys(network.perResource).sort()) === JSON.stringify(Object.keys(expectedResponses).sort()),
  "The page fetched a different set of origin paths.",
);
for (const [path, expected] of Object.entries(expectedResponses)) {
  const seen = network.perResource[path];
  assert(seen.responses === expected.responses, `${path}: ${seen.responses} responses, expected ${expected.responses}.`);
  assert(
    JSON.stringify(seen.statuses) === JSON.stringify({ [expected.status]: expected.responses }),
    `${path}: statuses ${JSON.stringify(seen.statuses)}.`,
  );
  const ranged = expected.status === "206" ? expected.responses : 0;
  assert(seen.rangeRequests === ranged, `${path}: ${seen.rangeRequests} Range requests.`);
  assert(seen.contentRangeResponses === ranged, `${path}: ${seen.contentRangeResponses} Content-Range responses.`);
  assert(
    seen.accessControlAllowOrigin === SITE_ORIGIN || seen.accessControlAllowOrigin === "*",
    `${path}: the browser saw Access-Control-Allow-Origin ${seen.accessControlAllowOrigin}.`,
  );
  assert(
    String(seen.accessControlExposeHeaders ?? "").toLowerCase().includes("content-range"),
    `${path}: the browser saw no exposed Content-Range.`,
  );
}

// The pick: a resolved occurrence with source evidence and at least one property row.
const pick = record.pick;
assert(typeof pick.selection.selectedObjectId === "string" && /^[0-9]+$/u.test(pick.selection.selectedObjectId), "No object was picked.");
assert(pick.selection.selectedObjectId === PICKED_OBJECT_ID, `Picked object ${pick.selection.selectedObjectId}, expected ${PICKED_OBJECT_ID}.`);
assert(pick.selection.selectionResidency === "retained", `Picked object residency ${pick.selection.selectionResidency}.`);
assert(/node [0-9]+/u.test(pick.selection.text ?? ""), "Selection text names no node.");
assert(
  typeof pick.selection.sourceRef === "string" && pick.selection.sourceRef.startsWith("source:ifc:"),
  "The picked occurrence carries no IFC source reference.",
);
assert(pick.properties.entryCount === PICKED_ENTRY_COUNT, `The pick resolved ${pick.properties.entryCount} property entries, expected ${PICKED_ENTRY_COUNT}.`);
assert(
  pick.properties.sampleEntries.length === Math.min(8, pick.properties.entryCount),
  "Sample entries do not match the entry count.",
);
for (const entry of pick.properties.sampleEntries) {
  assert(typeof entry.key === "string" && entry.key.length > 0, "A sampled property entry has no key.");
}

// Screenshots: present, re-hashed, and taken at distinct moments.
for (const name of ["ready", "picked"]) {
  const shot = record.screenshots[name];
  assert(shot.file === `${name}.png`, `${name} screenshot file is ${shot.file}.`);
  const bytes = await readFile(resolve(recordDirectory, shot.file));
  assert(bytes.byteLength === shot.bytes, `${shot.file} is ${bytes.byteLength} bytes, record says ${shot.bytes}.`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert(sha256 === shot.sha256, `${shot.file} sha256 differs from the record.`);
}
assert(record.screenshots.ready.sha256 !== record.screenshots.picked.sha256, "Ready and picked screenshots are identical.");

console.log(
  `[engineering-baseline-origin] deployed Studio at ${SITE_ORIGIN} opened ${PACKAGE_ORIGIN} cross-origin through the scene query: ` +
    `${TARGET_CHUNKS_READY}/${TARGET_CHUNKS_TOTAL} chunks under the 64 MiB budget (${TARGET_CHUNKS_SKIPPED} refused before fetch), ` +
    `${network.total} origin responses, hierarchy ${hierarchyMs} ms / first coarse frame ${firstCoarseFrameMs} ms / ready ${readyMs} ms, ` +
    `pick ${pick.selection.selectedObjectId} with ${pick.properties.entryCount} property entries, 0 console issues`,
);
