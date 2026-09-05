/**
 * Validates the browser gate ADR-0023 left open after the first delivery-origin
 * deploy (gate 3): the DEPLOYED Studio, opened with no query, reads its default
 * package cross-origin from the delivery origin and reaches the hierarchy, a
 * first coarse frame, the ready state, and a pick with resolved properties.
 *
 * What is pinned and why:
 *
 *   - The site and the origin are pinned as URLs, and the record must prove
 *     they are different origins - that is the whole claim.
 *   - Every resource the browser was offered is pinned to the COMMITTED
 *     `artifacts/ifc/digital-hub/build-report.json` (package `9b988666...`),
 *     loaded here rather than copied, so this record cannot drift from the
 *     federation record it depends on. Retarget only with a deliberate
 *     re-record of both, never to make a failing run pass.
 *   - The settled resident set (45/45 chunks, decoded and GPU bytes, status
 *     line, triangle count) was identical over three recorded runs and is
 *     pinned. Wall-clock milestones cross two public CDNs and are bounded,
 *     not pinned; the picked object and the screenshots vary run to run
 *     (chunk arrival at first frame is a race), so the pick is checked for
 *     shape and the PNGs are re-hashed against the record but carry no literal.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repositoryRoot = resolve(import.meta.dirname, "..");
const recordDirectory = resolve(repositoryRoot, "artifacts/public-demo/digital-hub-origin");
const recordPath = resolve(recordDirectory, "public-demo-browser.json");
const buildReportPath = resolve(repositoryRoot, "artifacts/ifc/digital-hub/build-report.json");

function assert(condition, message) {
  if (!condition) throw new TypeError(`[public-demo-browser] ${message}`);
}

const recordText = await readFile(recordPath, "utf8");
const record = JSON.parse(recordText);
const buildReport = JSON.parse(await readFile(buildReportPath, "utf8"));

assert(record.schemaVersion === "naru.public-demo-browser-evidence.1", "Unknown evidence envelope.");
assert(record.mode === "headed-deployed-studio-delivery-origin-load", "Evidence mode changed.");
/**
 * The record legitimately contains `https://` URLs. The guard looks for a
 * drive letter standing alone, which a URL scheme never does.
 */
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
const PACKAGE_ORIGIN = "https://packages.blacktanlabs.com/naru/digital-hub/v1/";
const PACKAGE_ORIGIN_ORIGIN = "https://packages.blacktanlabs.com";
const DEFAULT_SCENE_HREF = `${PACKAGE_ORIGIN}scene.gltf`;
const PACKAGE_DIGEST = "9b98866671eb080fd1a34646b6225d27d1ee55bddecbaad58790d35a344c5f1c";

assert(record.site.url === SITE_URL, `Site changed to ${record.site.url}.`);
assert(record.site.origin === SITE_ORIGIN, "Site origin changed.");
assert(record.packageOrigin.url === PACKAGE_ORIGIN, `Package origin changed to ${record.packageOrigin.url}.`);
assert(record.packageOrigin.origin === PACKAGE_ORIGIN_ORIGIN, "Package origin's origin changed.");
assert(record.packageOrigin.crossOrigin === true, "The record does not claim a cross-origin load.");
assert(
  new URL(record.site.url).origin !== new URL(record.packageOrigin.url).origin,
  "Site and package origin share an origin; the record proves nothing about delivery.",
);

// The deployed bundle names the origin document as its default scene.
assert(record.deployment.studioUrl === STUDIO_URL, "Studio URL changed.");
assert(record.deployment.defaultSceneHref === DEFAULT_SCENE_HREF, "Default scene href changed.");
assert(
  typeof record.deployment.targetingAsset === "string" &&
    /^\/naru\/studio\/assets\/[^/]+\.js$/u.test(record.deployment.targetingAsset),
  "The bundle asset that names the default scene must be a deployed Studio script.",
);
assert(record.deployment.scriptAssetCount >= 1, "No deployed script asset was inspected.");

// The browser was offered exactly the committed package bytes.
assert(record.buildReport.path === "artifacts/ifc/digital-hub/build-report.json", "Build report path changed.");
assert(record.buildReport.packageDigest === PACKAGE_DIGEST, "Package digest changed.");
assert(buildReport.output.packageDigest === PACKAGE_DIGEST, "Committed build report digest changed.");
const declared = buildReport.output.resources;
assert(declared.length === 5, `Build report declares ${declared.length} resources, expected 5.`);
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

// Milestones: ordered and bounded, never pinned (two public CDNs sit in the path).
const { hierarchyMs, firstCoarseFrameMs, readyMs } = record.milestones;
for (const [name, value] of Object.entries(record.milestones)) {
  assert(Number.isInteger(value) && value > 0, `${name} is not a positive integer.`);
}
assert(hierarchyMs <= firstCoarseFrameMs && firstCoarseFrameMs <= readyMs, "Milestones are out of order.");
assert(readyMs <= 60_000, `Ready took ${readyMs} ms, above the 60 s bound.`);
assert(typeof record.timingNote === "string" && record.timingNote.includes("public network"), "Timing caveat missing.");

// The Studio ran at the site, read the package by URL, and settled on the recorded resident set.
const ready = record.stateAtReady;
assert(ready.location.href === STUDIO_URL, `The page ran at ${ready.location.href}.`);
assert(ready.location.origin === SITE_ORIGIN, "The page did not run at the site origin.");
assert(ready.sceneSource === "url", `Scene source was ${ready.sceneSource}.`);
assert(ready.hierarchyReady && ready.coarseReady && ready.targetReady, "The Studio did not reach every milestone.");
const TARGET_CHUNKS = 45;
const RESIDENT_DECODED_BYTES = 23_476_872;
const RESIDENT_GPU_BYTES = 23_491_408;
const VISIBLE_OCCURRENCES = 5152;
const STATUS = "Compiled glTF ready · 3635 surface batches · 5152 renderable occurrences";
assert(ready.targetChunksTotal === TARGET_CHUNKS, `${ready.targetChunksTotal} target chunks, expected ${TARGET_CHUNKS}.`);
assert(ready.targetChunksReady === TARGET_CHUNKS, `${ready.targetChunksReady}/${TARGET_CHUNKS} chunks resident.`);
assert(ready.targetSchedulerRequests === TARGET_CHUNKS, `${ready.targetSchedulerRequests} chunk requests, expected ${TARGET_CHUNKS}.`);
assert(ready.residentDecodedBytes === RESIDENT_DECODED_BYTES, `Decoded bytes ${ready.residentDecodedBytes}.`);
assert(ready.residentGpuBytes === RESIDENT_GPU_BYTES, `GPU bytes ${ready.residentGpuBytes}.`);
assert(ready.visibleOccurrences === VISIBLE_OCCURRENCES, `${ready.visibleOccurrences} visible occurrences.`);
assert(ready.status === STATUS, `Status line changed: ${ready.status}`);
assert(ready.panel.prototypes === "3383", `Prototype count ${ready.panel.prototypes}.`);
assert(ready.panel.occurrences === "5152", `Occurrence count ${ready.panel.occurrences}.`);
assert(ready.panel.triangles === "913,532", `Triangle count ${ready.panel.triangles}.`);
assert(ready.panel.edges === "12", `Edge count ${ready.panel.edges}.`);
assert(ready.panel.sourceFormat === "IFC4", `Source format ${ready.panel.sourceFormat}.`);
const after = record.stateAfterPick;
assert(after.targetChunksReady === TARGET_CHUNKS && after.residentGpuBytes === RESIDENT_GPU_BYTES, "The pick disturbed the resident set.");

// Every origin response the page received: one full read per document, only Range reads of scene.bin.
const network = record.network;
assert(network.total === 49, `${network.total} origin responses, expected 49.`);
const expectedResponses = {
  "scene.gltf": { responses: 1, status: "200" },
  "coarse.bin": { responses: 1, status: "200" },
  "properties.json": { responses: 1, status: "200" },
  "properties.bin": { responses: 1, status: "200" },
  "scene.bin": { responses: TARGET_CHUNKS, status: "206" },
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
assert(pick.selection.selectionResidency === "retained", `Picked object residency ${pick.selection.selectionResidency}.`);
assert(/node [0-9]+/u.test(pick.selection.text ?? ""), "Selection text names no node.");
assert(
  typeof pick.selection.sourceRef === "string" && pick.selection.sourceRef.startsWith("source:ifc:"),
  "The picked occurrence carries no IFC source reference.",
);
assert(pick.properties.entryCount > 0, "The pick resolved no property entries.");
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
  `[public-demo-browser] deployed Studio at ${SITE_ORIGIN} opened ${PACKAGE_ORIGIN} cross-origin: ` +
    `${TARGET_CHUNKS}/${TARGET_CHUNKS} chunks, ${network.total} origin responses, ` +
    `hierarchy ${hierarchyMs} ms / first coarse frame ${firstCoarseFrameMs} ms / ready ${readyMs} ms, ` +
    `pick ${pick.selection.selectedObjectId} with ${pick.properties.entryCount} property entries, 0 console issues`,
);
