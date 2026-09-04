// Records the Studio workspace round trip that ADR-0022 gate 4 and Phase 2
// exit criterion 4 name: a workspace saved against a compiled package, the
// same workspace reopened against that unchanged package, and the same
// workspace reopened after one source document was edited.
//
// The record is a browser record on purpose. The format, the reopen decision,
// and the Studio translation layer are already covered by unit tests; what a
// test cannot show is the renderer acting on a restored view and the Studio
// reporting a changed source to a person. Four arms are driven in one process
// against one served package:
//
//   A  save     - load, save a baseline manifest before touching anything,
//                 hide three occurrences, select a fourth, enable and move the
//                 section plane, orbit and zoom, then save again. The baseline
//                 exists so the customized manifest cannot be vacuously equal
//                 to it.
//   B  unchanged- reopen the customized manifest against the same package. The
//                 state before any source is checked is recorded too: a browser
//                 cannot hash a source it was not given, so `unverifiable` is
//                 the honest verdict and the record says so. Supplying the four
//                 original sources moves it to `verified`, and saving again
//                 must reproduce the customized manifest byte for byte - the
//                 manifest carries no timestamp, so byte identity is exactly
//                 the claim that the view came back.
//   C  changed  - reopen the same manifest with three original sources and one
//                 edited copy. ADR-0002 puts the native document above the
//                 package, so this must read `changed-source` with
//                 `geometryIsCurrent` false even though the package still
//                 matches.
//   D  reload   - reopen against a page booted on a different scene reference,
//                 which forces the load-then-restore branch rather than the
//                 in-place one.
//
//   pnpm workspace:reopen:evidence
//   node scripts/record-workspace-reopen-evidence.mjs \
//     [--scene-dir output/ifc/digital-hub-split4] \
//     [--sources output/external-fixtures/ifc-bench-digital-hub] \
//     [--output artifacts/workspace/reopen] [--work-dir output/workspace-reopen] \
//     [--browser chrome|firefox] [--headless] [--port 4176]
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { chromium, firefox } from "playwright";
import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}
const sceneDirectory = resolve(
  repositoryRoot,
  argValue("--scene-dir", "output/ifc/digital-hub-split4"),
);
const sourceDirectory = resolve(
  repositoryRoot,
  argValue("--sources", "output/external-fixtures/ifc-bench-digital-hub"),
);
const outputDirectory = resolve(repositoryRoot, argValue("--output", "artifacts/workspace/reopen"));
const workDirectory = resolve(repositoryRoot, argValue("--work-dir", "output/workspace-reopen"));
const outputFromRoot = relative(repositoryRoot, outputDirectory);
if (
  outputFromRoot === "" ||
  outputFromRoot === ".." ||
  outputFromRoot.startsWith(`..${sep}`) ||
  isAbsolute(outputFromRoot)
) {
  throw new TypeError("Workspace reopen evidence output must remain inside the repository.");
}
const headless = process.argv.includes("--headless");
const browserEngines = {
  chrome: { id: "chrome", engine: "Blink", launch: () => chromium.launch({ channel: "chrome", headless }) },
  firefox: { id: "firefox", engine: "Gecko", launch: () => firefox.launch({ headless }) },
};
const browserId = argValue("--browser", "chrome");
const browserEngine = Object.hasOwn(browserEngines, browserId) ? browserEngines[browserId] : undefined;
if (!browserEngine) throw new TypeError("--browser must be chrome or firefox.");
const port = Number(argValue("--port", "4176"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new TypeError("--port must be an integer between 1024 and 65535.");
}

// The same one-parameter edit the rebuild-stage records already use: an
// extrusion depth referenced by exactly one shape representation, and a
// replacement of identical byte length so the change cannot be mistaken for a
// re-export.
const sourceEdit = {
  label: "arc.ifc",
  entity: "#823= IFCEXTRUDEDAREASOLID(#817,#822,#20,7.77);",
  replacement: "#823= IFCEXTRUDEDAREASOLID(#817,#822,#20,9.77);",
  description:
    "Extrusion depth 7.77 -> 9.77 of #823, referenced only by #824 (IfcShapeRepresentation 'Body').",
};

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Bind the record to the package that is actually served: every resource the
// build report names must still hash to what it names. The digest itself is
// host-local (this host's IFC adapter does not reproduce the macOS split byte
// for byte), so the record pins what it measured rather than a foreign digest.
const buildReportPath = resolve(sceneDirectory, "build-report.json");
const buildReport = JSON.parse(await readFile(buildReportPath, "utf8"));
for (const resource of buildReport.output.resources) {
  const digest = await sha256File(resolve(sceneDirectory, resource.path));
  if (digest !== resource.sha256) {
    throw new Error(
      `${resource.path} digest ${digest} does not match the build report ${resource.sha256}; ` +
        "recompile the package before recording.",
    );
  }
}
// The manifest records the source digests the adapter report states, so a
// reopen can only read `verified` if the files on disk still hash to them.
const adapterReport = JSON.parse(await readFile(resolve(sceneDirectory, "adapter-report.json"), "utf8"));
const originalSources = [];
for (const source of adapterReport.sources) {
  const label = basename(source.path);
  const path = resolve(sourceDirectory, label);
  const digest = await sha256File(path);
  if (digest !== source.sha256) {
    throw new Error(
      `${label} digest ${digest} does not match the adapter report ${source.sha256}; ` +
        "the workspace it saves could not reopen as verified.",
    );
  }
  originalSources.push({
    discipline: source.discipline ?? null,
    label,
    path,
    byteLength: source.byteLength,
    sha256: digest,
  });
}
console.log(
  `[workspace-reopen] package ${buildReport.output.packageDigest.slice(0, 12)} and ` +
    `${originalSources.length} source(s) verified against their reports`,
);

// Build the changed-source arm's inputs: the same four documents, one of them
// edited in place. `latin1` round-trips every byte of an ISO-10303-21 file, so
// the copy differs from the original in exactly the four characters of the
// replacement.
const changedSourceDirectory = resolve(workDirectory, "changed-sources");
await rm(changedSourceDirectory, { recursive: true, force: true });
await mkdir(changedSourceDirectory, { recursive: true });
const changedSources = [];
let editedSource;
for (const source of originalSources) {
  const target = resolve(changedSourceDirectory, source.label);
  const original = await readFile(source.path);
  if (source.label !== sourceEdit.label) {
    await writeFile(target, original);
    changedSources.push({ ...source, path: target, edited: false });
    continue;
  }
  const text = original.toString("latin1");
  const occurrences = text.split(sourceEdit.entity).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${source.label} contains ${occurrences} copies of the edited entity; ` +
        "the record needs exactly one so the change is a single parameter.",
    );
  }
  const edited = Buffer.from(text.replace(sourceEdit.entity, sourceEdit.replacement), "latin1");
  if (edited.byteLength !== original.byteLength) {
    throw new Error("The replacement must keep the byte length of the source document.");
  }
  await writeFile(target, edited);
  editedSource = {
    ...source,
    path: target,
    edited: true,
    editedSha256: sha256Bytes(edited),
    editedByteLength: edited.byteLength,
  };
  changedSources.push(editedSource);
}
if (editedSource === undefined) {
  throw new Error(`This federation names no source called ${sourceEdit.label}.`);
}
if (editedSource.editedSha256 === editedSource.sha256) {
  throw new Error("The edited copy hashes to the original; the changed-source arm would prove nothing.");
}
console.log(
  `[workspace-reopen] edited ${editedSource.label}: ${editedSource.sha256.slice(0, 12)} -> ` +
    `${editedSource.editedSha256.slice(0, 12)} at an unchanged ${editedSource.editedByteLength} bytes`,
);

await mkdir(outputDirectory, { recursive: true });
process.env.NARU_SCENE_DIR = relative(repositoryRoot, sceneDirectory);
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "127.0.0.1", port, strictPort: true },
});
const browser = await browserEngine.launch();
const consoleIssues = [];
const startedAt = Date.now();
try {
  await vite.listen();
  const origin = new URL(`http://127.0.0.1:${port}/`);
  const packageHref = new URL("scene.gltf", origin).href;
  const context = await browser.newContext({
    viewport: { width: 1320, height: 1000 },
    acceptDownloads: true,
  });

  const screenshot = async (page, name) => {
    const bytes = await page.screenshot({ type: "png", timeout: 120_000 });
    await writeFile(resolve(outputDirectory, name), bytes);
    return { path: name, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
  };

  /** Opens the Studio and waits for a package to be loaded and settled. */
  const openStudio = async (sceneHref) => {
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    page.on("crash", () => {
      consoleIssues.push({ level: "crash", message: "The page crashed." });
    });
    const url = new URL(origin.href);
    if (sceneHref !== undefined) url.searchParams.set("scene", sceneHref);
    const openedAt = Date.now();
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.documentElement.dataset.hierarchyReady === "true",
      undefined,
      { timeout: 300_000 },
    );
    const hierarchyReadyMs = Date.now() - openedAt;
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.targetReady === "true" ||
        document.documentElement.dataset.coarseReady === "true",
      undefined,
      { timeout: 600_000 },
    );
    const readyMs = Date.now() - openedAt;
    return { page, milestones: { hierarchyReadyMs, readyMs } };
  };

  /** Everything the Studio publishes about a reopen, plus what the UI shows. */
  const readReopenState = (page) =>
    page.evaluate(() => {
      const root = document.documentElement.dataset;
      const sectionPosition = document.querySelector("#section-position");
      return {
        state: root.workspaceState ?? null,
        geometryIsCurrent: root.workspaceGeometryCurrent ?? null,
        package: root.workspacePackage ?? null,
        sources: root.workspaceSources ?? null,
        sourceInspection: root.workspaceSourceInspection ?? null,
        hiddenOccurrences: root.workspaceHiddenOccurrences ?? null,
        droppedOccurrences: root.workspaceDroppedOccurrences ?? null,
        droppedSelection: root.workspaceDroppedSelection ?? null,
        selectedObjectId: root.workspaceSelectedObject ?? null,
        kindLabel: document.querySelector("#workspace-kind")?.textContent ?? null,
        statusText: document.querySelector("#workspace-status")?.textContent ?? null,
        statusState: document.querySelector("#workspace-status")?.getAttribute("data-state") ?? null,
        selectionText: document.querySelector("#selection")?.textContent ?? null,
        sectionEnabled:
          document.querySelector("#toggle-section")?.getAttribute("aria-pressed") ?? null,
        sectionPosition:
          sectionPosition instanceof HTMLInputElement ? Number(sectionPosition.value) : null,
        sceneUrl:
          document.querySelector("#scene-url") instanceof HTMLInputElement
            ? document.querySelector("#scene-url").value
            : null,
      };
    });

  /** Clicks "Save workspace" and returns the bytes the browser downloaded. */
  const saveWorkspace = async (page) => {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120_000 }),
      page.click("#save-workspace"),
    ]);
    const path = await download.path();
    const bytes = await readFile(path);
    const status = await page.evaluate(
      () => document.querySelector("#workspace-status")?.textContent ?? null,
    );
    const manifest = JSON.parse(bytes.toString("utf8"));
    return {
      fileName: download.suggestedFilename(),
      byteLength: bytes.byteLength,
      sha256: sha256Bytes(bytes),
      statusText: status,
      bytes,
      manifest,
    };
  };

  /** Hands the Studio a manifest through its own file input. */
  const reopenWorkspace = async (page, saved, expected) => {
    await page.setInputFiles("#workspace-file", {
      name: saved.fileName,
      mimeType: "application/json",
      buffer: saved.bytes,
    });
    await page.waitForFunction(
      (state) => document.documentElement.dataset.workspaceState === state,
      expected,
      { timeout: 600_000 },
    );
  };

  /** Hands the Studio source documents through its own file input. */
  const checkSources = async (page, paths, expected) => {
    await page.setInputFiles("#workspace-sources", paths);
    await page.waitForFunction(
      (state) => document.documentElement.dataset.workspaceState === state,
      expected,
      { timeout: 600_000 },
    );
  };

  // ---------------------------------------------------------------- arm A
  const save = await openStudio(undefined);
  const savePage = save.page;
  const baselineScreenshot = await screenshot(savePage, "save-baseline.png");
  const baseline = await saveWorkspace(savePage);

  // Three occurrences hidden and a fourth left selected, taken from the top of
  // the virtualized hierarchy so the choice is a property of the package and
  // not of where a click landed on the canvas.
  const rows = savePage.locator('#hierarchy li[data-renderable="true"]');
  const interaction = { hiddenRows: [], selectedRow: null };
  for (let index = 0; index < 3; index += 1) {
    const row = rows.nth(index);
    await row.click();
    const label = await row.getAttribute("aria-label");
    await savePage.click("#hide-selection");
    interaction.hiddenRows.push({ position: index, label });
  }
  const selectedRow = rows.nth(3);
  await selectedRow.click();
  interaction.selectedRow = { position: 3, label: await selectedRow.getAttribute("aria-label") };

  await savePage.click("#toggle-section");
  await savePage.click("#flip-section");
  await savePage.locator("#section-position").fill("35");
  const viewport = savePage.locator("#viewport");
  const box = await viewport.boundingBox();
  if (box === null) throw new Error("The viewport canvas has no layout box.");
  const centreX = Math.round(box.x + box.width / 2);
  const centreY = Math.round(box.y + box.height / 2);
  await savePage.mouse.move(centreX, centreY);
  await savePage.mouse.down();
  await savePage.mouse.move(centreX + 140, centreY - 60, { steps: 8 });
  await savePage.mouse.up();
  await savePage.mouse.wheel(0, -240);
  await savePage.waitForTimeout(500);

  const customizedScreenshot = await screenshot(savePage, "save-customized.png");
  const customized = await saveWorkspace(savePage);
  if (customized.sha256 === baseline.sha256) {
    throw new Error(
      "The customized manifest equals the baseline, so byte identity after a reopen " +
        "would prove nothing about the view.",
    );
  }
  const saveArm = {
    label: "save",
    question: "Does the Studio save a manifest that describes the session a person set up?",
    milestones: save.milestones,
    baseline: {
      fileName: baseline.fileName,
      byteLength: baseline.byteLength,
      sha256: baseline.sha256,
      statusText: baseline.statusText,
      hiddenOccurrenceIds: baseline.manifest.view.hiddenOccurrenceIds.length,
      selectedOccurrenceId: baseline.manifest.view.selectedOccurrenceId,
      sectionEnabled: baseline.manifest.view.section.enabled,
    },
    interaction,
    customized: {
      fileName: customized.fileName,
      byteLength: customized.byteLength,
      sha256: customized.sha256,
      statusText: customized.statusText,
      label: customized.manifest.label,
      schemaVersion: customized.manifest.schemaVersion,
      packageReference: customized.manifest.package.reference,
      packageDigest: customized.manifest.package.packageDigest,
      resources: customized.manifest.package.resources.map((resource) => ({
        path: resource.path,
        byteLength: resource.byteLength,
        sha256: resource.sha256,
      })),
      sources: customized.manifest.sources.map((source) => ({
        key: source.key,
        label: source.label,
        byteLength: source.byteLength,
        sha256: source.sha256,
      })),
      view: customized.manifest.view,
    },
    savedFlag: await savePage.evaluate(
      () => document.documentElement.dataset.workspaceSaved ?? null,
    ),
    screenshots: { baseline: baselineScreenshot, customized: customizedScreenshot },
  };
  await savePage.close();

  // ---------------------------------------------------------- arm B
  const unchanged = await openStudio(undefined);
  const unchangedPage = unchanged.page;
  await reopenWorkspace(unchangedPage, customized, "unverifiable");
  const beforeInspection = await readReopenState(unchangedPage);
  await checkSources(
    unchangedPage,
    originalSources.map((source) => source.path),
    "verified",
  );
  const afterInspection = await readReopenState(unchangedPage);
  const unchangedScreenshot = await screenshot(unchangedPage, "reopen-unchanged.png");
  const resaved = await saveWorkspace(unchangedPage);
  if (resaved.sha256 !== customized.sha256) {
    throw new Error(
      `Re-saving the reopened workspace produced ${resaved.sha256} at ${resaved.byteLength} B ` +
        `instead of ${customized.sha256} at ${customized.byteLength} B; the view that came back ` +
        "is not the view that was saved.",
    );
  }
  const unchangedArm = {
    label: "unchanged",
    question: "Does the same workspace reopen against an unchanged package?",
    milestones: unchanged.milestones,
    beforeSourceInspection: beforeInspection,
    afterSourceInspection: afterInspection,
    inspectedSources: originalSources.map((source) => ({
      label: source.label,
      byteLength: source.byteLength,
      sha256: source.sha256,
    })),
    resaved: {
      fileName: resaved.fileName,
      byteLength: resaved.byteLength,
      sha256: resaved.sha256,
      statusText: resaved.statusText,
    },
    manifestIsByteIdentical: resaved.sha256 === customized.sha256,
    screenshot: unchangedScreenshot,
  };
  await unchangedPage.close();

  // ---------------------------------------------------------- arm C
  const changed = await openStudio(undefined);
  const changedPage = changed.page;
  await reopenWorkspace(changedPage, customized, "unverifiable");
  await checkSources(
    changedPage,
    changedSources.map((source) => source.path),
    "changed-source",
  );
  const changedState = await readReopenState(changedPage);
  if (changedState.geometryIsCurrent !== "false") {
    throw new Error(
      `A changed source left geometryIsCurrent ${changedState.geometryIsCurrent}; ` +
        "stale geometry must never be labelled current.",
    );
  }
  if (changedState.package !== "verified") {
    throw new Error(
      `The package read ${changedState.package} in the changed-source arm; the arm is only ` +
        "meaningful while the package itself still matches.",
    );
  }
  const changedScreenshot = await screenshot(changedPage, "reopen-changed-source.png");
  const changedArm = {
    label: "changed-source",
    question: "Does the same workspace report a source that moved under it?",
    milestones: changed.milestones,
    edit: {
      label: sourceEdit.label,
      description: sourceEdit.description,
      originalSha256: editedSource.sha256,
      editedSha256: editedSource.editedSha256,
      byteLength: editedSource.editedByteLength,
      byteLengthUnchanged: editedSource.editedByteLength === editedSource.byteLength,
    },
    inspectedSources: changedSources.map((source) => ({
      label: source.label,
      byteLength: source.byteLength,
      sha256: source.edited ? source.editedSha256 : source.sha256,
      edited: source.edited,
    })),
    state: changedState,
    screenshot: changedScreenshot,
  };
  await changedPage.close();

  // ---------------------------------------------------------- arm D
  // Booting on a different reference forces `openWorkspaceFile` down the
  // load-then-restore branch: the Studio has to fetch the package the manifest
  // names before it can restore anything.
  const reloadBootHref = new URL("scene.gltf?reopen=1", origin).href;
  const reload = await openStudio(reloadBootHref);
  const reloadPage = reload.page;
  const bootSceneUrl = await reloadPage.evaluate(() =>
    document.querySelector("#scene-url") instanceof HTMLInputElement
      ? document.querySelector("#scene-url").value
      : null,
  );
  if (bootSceneUrl === customized.manifest.package.reference.href) {
    throw new Error(
      "The reload arm booted on the reference the manifest names, so the Studio would " +
        "restore in place instead of loading the package again.",
    );
  }
  await reopenWorkspace(reloadPage, customized, "unverifiable");
  const reloadBefore = await readReopenState(reloadPage);
  await checkSources(
    reloadPage,
    originalSources.map((source) => source.path),
    "verified",
  );
  const reloadState = await readReopenState(reloadPage);
  const reloadScreenshot = await screenshot(reloadPage, "reopen-after-reload.png");
  const reloadResaved = await saveWorkspace(reloadPage);
  const reloadArm = {
    label: "reload",
    question: "Does a reopen that must load the package first restore the same view?",
    milestones: reload.milestones,
    bootSceneUrl,
    manifestReferenceHref: customized.manifest.package.reference.href,
    loadedPackageAgain: bootSceneUrl !== customized.manifest.package.reference.href,
    beforeSourceInspection: reloadBefore,
    afterSourceInspection: reloadState,
    resaved: {
      fileName: reloadResaved.fileName,
      byteLength: reloadResaved.byteLength,
      sha256: reloadResaved.sha256,
      statusText: reloadResaved.statusText,
    },
    manifestIsByteIdentical: reloadResaved.sha256 === customized.sha256,
    screenshot: reloadScreenshot,
  };
  if (!reloadArm.manifestIsByteIdentical) {
    throw new Error(
      `Re-saving after a reload produced ${reloadResaved.sha256} instead of ` +
        `${customized.sha256}; the load-then-restore path did not reproduce the view.`,
    );
  }
  await reloadPage.close();

  if (consoleIssues.length > 0) {
    throw new Error(`The browser emitted issues: ${JSON.stringify(consoleIssues)}.`);
  }

  const evidence = {
    schemaVersion: "naru.workspace-reopen-evidence.1",
    capturedAt: new Date(startedAt).toISOString(),
    mode: "headed-workspace-round-trip",
    browser: {
      id: browserEngine.id,
      engine: browserEngine.engine,
      version: browser.version(),
      headless,
      viewport: { width: 1320, height: 1000 },
    },
    host: { platform: process.platform, architecture: process.arch },
    // Manifest digests below include this origin, because the manifest names
    // the package by URL. A record made on another port is a different record.
    served: {
      origin: origin.href,
      packageHref,
      sceneDirectory: relative(repositoryRoot, sceneDirectory).replaceAll(sep, "/"),
      buildReport: relative(repositoryRoot, buildReportPath).replaceAll(sep, "/"),
      packageDigest: buildReport.output.packageDigest,
      resources: buildReport.output.resources,
      servedFrom: "Vite dev static hosting with HTTP Range support",
    },
    federation: {
      documentCount: originalSources.length,
      sources: originalSources.map((source) => ({
        discipline: source.discipline,
        label: source.label,
        byteLength: source.byteLength,
        sha256: source.sha256,
      })),
    },
    arms: {
      save: saveArm,
      unchanged: unchangedArm,
      changedSource: changedArm,
      reload: reloadArm,
    },
    consoleIssues,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
  await writeFile(
    resolve(outputDirectory, "workspace-reopen.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `[workspace-reopen] saved ${customized.byteLength} B manifest ${customized.sha256.slice(0, 12)}`,
  );
  console.log(
    `[workspace-reopen] unchanged: ${beforeInspection.state} -> ${afterInspection.state}, ` +
      `re-save byte-identical ${unchangedArm.manifestIsByteIdentical}`,
  );
  console.log(
    `[workspace-reopen] changed source: ${changedState.state}, ` +
      `geometryIsCurrent ${changedState.geometryIsCurrent}, package ${changedState.package}`,
  );
  console.log(
    `[workspace-reopen] reload: ${reloadState.state}, ` +
      `re-save byte-identical ${reloadArm.manifestIsByteIdentical}`,
  );
  console.log(`[workspace-reopen] evidence: ${relative(repositoryRoot, outputDirectory)}`);
} finally {
  await browser.close();
  await vite.close();
}
