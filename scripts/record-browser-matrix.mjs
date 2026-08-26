import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox } from "playwright";
import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputFlag = process.argv.indexOf("--output");
const outputArgument =
  outputFlag === -1 ? "output/playwright/browser-matrix" : process.argv[outputFlag + 1];
if (!outputArgument) throw new TypeError("--output requires a repository-relative path.");

const outputDirectory = resolve(repositoryRoot, outputArgument);
const outputFromRoot = relative(repositoryRoot, outputDirectory);
if (
  outputFromRoot === "" ||
  outputFromRoot === ".." ||
  outputFromRoot.startsWith(`..${sep}`) ||
  isAbsolute(outputFromRoot)
) {
  throw new TypeError("Browser evidence output must remain inside the repository.");
}

const headless = process.argv.includes("--headless");
const browserFlag = process.argv.indexOf("--browser");
const browserFilter = browserFlag === -1 ? undefined : process.argv[browserFlag + 1];
if (browserFlag !== -1 && browserFilter !== "chrome" && browserFilter !== "firefox") {
  throw new TypeError("--browser must be chrome or firefox.");
}
const operatingSystem =
  { win32: "windows", darwin: "macos", linux: "linux" }[process.platform] ??
  process.platform;
const viewport = { width: 1320, height: 1000 };
const url = "http://127.0.0.1:4173/";
const expected = {
  status: "Compiled glTF ready · 34 shared meshes · 85 renderable occurrences",
  selection:
    "Selected JOYSTICK_ANALOG_MINITHM:JOY1 · node 56 · ID 57 · 524 CAD edge refs",
  prototypeCount: "34",
  occurrenceCount: "85",
  triangleCount: "162,838",
  edgeCount: "13,897",
  binarySize: "14,479.3 KiB",
  sourceFormat: "AP214",
  hierarchyFirst: true,
  brandMarkLoaded: true,
  faviconLoaded: true,
  fixtureCreditLinked: true,
};
const compilerReport = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "artifacts/phase1/adafruit-pygamer/build-report.json"),
    "utf8",
  ),
);
const progressiveDirectory = resolve(
  repositoryRoot,
  "artifacts/phase1/repeated-fasteners-ap242",
);
const progressiveCompilerReport = JSON.parse(
  await readFile(resolve(progressiveDirectory, "build-report.json"), "utf8"),
);
const progressiveGltf = JSON.parse(
  await readFile(resolve(progressiveDirectory, "scene.gltf"), "utf8"),
);
const progressiveTargetBytes = await readFile(resolve(progressiveDirectory, "scene.bin"));
const expectedTargetRanges = [0, 2, 1].map((chunkIndex) => {
  const chunk = progressiveGltf.extras.madi.progressive.targetChunks[chunkIndex];
  if (!chunk) throw new Error(`Missing progressive target chunk ${chunkIndex}.`);
  return `bytes=${chunk.byteOffset}-${chunk.byteOffset + chunk.byteLength - 1}`;
});
const targetChunkIdByRange = new Map(
  progressiveGltf.extras.madi.progressive.targetChunks.map((chunk) => [
    `bytes=${chunk.byteOffset}-${chunk.byteOffset + chunk.byteLength - 1}`,
    chunk.id,
  ]),
);

function assertEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) {
    throw new Error(`${label}: expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actual)}.`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function selectObjectAtNearbyPoint(page, canvas, canvasBounds, objectId) {
  const offsets = [0, 0.02, -0.02, 0.04, -0.04, 0.06, -0.06, 0.08, -0.08, 0.1, -0.1];
  for (const offsetY of offsets) {
    for (const offsetX of offsets) {
      const normalized = { x: 0.6 + offsetX, y: 0.35 + offsetY };
      const position = {
        x: Math.round(canvasBounds.width * normalized.x),
        y: Math.round(canvasBounds.height * normalized.y),
      };
      await canvas.click({ position });
      const selected = await page
        .waitForFunction(
          (expectedId) => document.documentElement.dataset.selectedObjectId === String(expectedId),
          objectId,
          { timeout: offsetX === 0 && offsetY === 0 ? 2_000 : 300 },
        )
        .then(() => true)
        .catch(() => false);
      if (selected) return { normalized, position };
    }
  }
  throw new Error(`Could not pick object ${objectId} near the canonical review point.`);
}

async function recordBrowser(definition) {
  const browser = await definition.launch();
  try {
    const browserVersion = browser.version();
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleIssues = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    let hierarchyFirst = false;
    let hierarchySearchBeforeGeometry = false;
    let binaryNetworkRequests = 0;
    await page.route("**/scene.bin", async (route) => {
      binaryNetworkRequests += 1;
      hierarchyFirst = await page
        .evaluate(() => document.documentElement.dataset.hierarchyReady === "true")
        .catch(() => false);
      hierarchySearchBeforeGeometry = await page
        .evaluate(() => {
          const input = document.querySelector("#hierarchy-search");
          if (!(input instanceof HTMLInputElement)) return false;
          input.value = "MICROSD";
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          const matched = document.documentElement.dataset.hierarchyMatches === "1";
          input.value = "";
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          return matched;
        })
        .catch(() => false);
      await route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("#status[data-state='ready']").waitFor({ timeout: 15_000 });

    const observed = {
      status: await page.locator("#status").innerText(),
      prototypeCount: await page.locator("#prototype-count").innerText(),
      occurrenceCount: await page.locator("#occurrence-count").innerText(),
      triangleCount: await page.locator("#triangle-count").innerText(),
      edgeCount: await page.locator("#edge-count").innerText(),
      binarySize: await page.locator("#binary-size").innerText(),
      sourceFormat: await page.locator("#source-format").innerText(),
      hierarchyFirst,
      hierarchySearchBeforeGeometry,
      brandMarkLoaded: await page.locator("#naru-brand-mark").evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
      faviconLoaded: await page.evaluate(async () => {
        const favicon = document.querySelector("#naru-favicon");
        if (!(favicon instanceof HTMLLinkElement) || !favicon.href) return false;
        const response = await fetch(favicon.href);
        const source = await response.text();
        return response.ok && source.includes("<svg") && source.includes("NARU");
      }),
      fixtureCreditLinked: await page.locator(".fixture-credit a").evaluate(
        (element) =>
          element instanceof HTMLAnchorElement &&
          element.href ===
            "https://github.com/adafruit/Adafruit_CAD_Parts/blob/a94289fc02e7312f11647eb5e68f5c5ec06cabb6/LICENSE",
      ),
    };
    for (const [label, expectedValue] of Object.entries(expected)) {
      if (label === "selection") continue;
      assertEqual(observed[label], expectedValue, `${definition.id} ${label}`);
    }
    if (!hierarchySearchBeforeGeometry) {
      throw new Error(`${definition.id} hierarchy search was unavailable before geometry.`);
    }

    const canvas = page.locator("#viewport");
    const canvasBounds = await canvas.boundingBox();
    if (!canvasBounds) throw new Error(`${definition.id} canvas has no visible bounds.`);
    const pickPoint = await selectObjectAtNearbyPoint(page, canvas, canvasBounds, 57);
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });
    observed.selection = await page.locator("#selection").innerText();
    observed.pickPoint = pickPoint.normalized;
    assertEqual(observed.selection, expected.selection, `${definition.id} selection`);

    await page.locator("#toggle-section").click();
    assertEqual(
      await page.locator("html").getAttribute("data-section-enabled"),
      "true",
      `${definition.id} section enabled`,
    );
    const sectionPosition = page.locator("#section-position");
    await sectionPosition.fill("0");
    await canvas.click({ position: pickPoint.position });
    await page.locator("#selection").filter({ hasText: "No occurrence at that pixel." }).waitFor({
      timeout: 5_000,
    });
    await sectionPosition.fill("100");
    await canvas.click({ position: pickPoint.position });
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });
    await page.locator("[data-section-axis='x']").click();
    await page.locator("#flip-section").click();
    assertEqual(
      await page.locator("#section-direction").innerText(),
      "Keep +X side",
      `${definition.id} section flip`,
    );
    await page.locator("#toggle-section").click();
    observed.sectionInteraction = true;

    const hierarchySearch = page.locator("#hierarchy-search");
    await hierarchySearch.fill("MICROSD");
    assertEqual(
      await page.locator("#hierarchy-search-result").textContent(),
      "1 match",
      `${definition.id} hierarchy search`,
    );
    assertEqual(
      await page.locator("#hierarchy li:visible").count(),
      3,
      `${definition.id} visible hierarchy search path`,
    );
    await hierarchySearch.press("Enter");
    assertEqual(
      await page.locator("#property-name").innerText(),
      "MICROSD:X5",
      `${definition.id} searched property name`,
    );
    assertEqual(
      await page.locator("#property-node").innerText(),
      "67",
      `${definition.id} searched property node`,
    );
    await hierarchySearch.fill("");
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.6),
        y: Math.round(canvasBounds.height * 0.35),
      },
    });
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });
    assertEqual(
      await page.locator("#property-edge-count").innerText(),
      "524",
      `${definition.id} picked edge properties`,
    );
    observed.hierarchySearchAndProperties = true;

    const remoteSceneUrl = new URL("scene.gltf?source=browser-matrix", url);
    await page.locator("#scene-url").fill(remoteSceneUrl.href);
    await page.locator("#open-scene-url").click();
    await page.waitForFunction(
      (sceneHref) =>
        document.documentElement.dataset.sceneSource === "url" &&
        document.querySelector("#scene-source-kind")?.textContent === "URL" &&
        document.querySelector("#scene-source-label")?.textContent === sceneHref &&
        document.querySelector("#status")?.getAttribute("data-state") === "ready",
      remoteSceneUrl.href,
    );
    assertEqual(
      new URL(page.url()).searchParams.get("scene"),
      remoteSceneUrl.href,
      `${definition.id} URL scene query`,
    );
    assertEqual(binaryNetworkRequests, 2, `${definition.id} URL binary request`);
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.6),
        y: Math.round(canvasBounds.height * 0.35),
      },
    });
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });

    await page.locator("#local-scene-files").setInputFiles([
      resolve(repositoryRoot, "artifacts/phase1/adafruit-pygamer/scene.gltf"),
      resolve(repositoryRoot, "artifacts/phase1/adafruit-pygamer/scene.bin"),
    ]);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.sceneSource === "local" &&
        document.querySelector("#scene-source-kind")?.textContent === "LOCAL" &&
        document.querySelector("#scene-source-label")?.textContent ===
          "scene.gltf + scene.bin" &&
        document.querySelector("#status")?.getAttribute("data-state") === "ready",
    );
    assertEqual(new URL(page.url()).searchParams.get("scene"), null, `${definition.id} local URL`);
    assertEqual(binaryNetworkRequests, 2, `${definition.id} local Worker binary decode`);
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.6),
        y: Math.round(canvasBounds.height * 0.35),
      },
    });
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });
    observed.sceneSources = {
      url: true,
      local: true,
      localBinaryDecodedWithoutNetworkFetch: true,
    };

    const progressivePage = await context.newPage();
    progressivePage.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    progressivePage.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    await progressivePage.route("**/progressive/scene.gltf", (route) =>
      route.fulfill({
        path: resolve(progressiveDirectory, "scene.gltf"),
        contentType: "model/gltf+json",
      }),
    );
    await progressivePage.route("**/progressive/coarse.bin", (route) =>
      route.fulfill({
        path: resolve(progressiveDirectory, "coarse.bin"),
        contentType: "application/octet-stream",
      }),
    );
    let releaseFirstTargetChunk;
    const firstTargetGate = new Promise((resolveGate) => {
      releaseFirstTargetChunk = resolveGate;
    });
    let releaseSecondTargetChunk;
    const secondTargetGate = new Promise((resolveGate) => {
      releaseSecondTargetChunk = resolveGate;
    });
    let firstTargetRequestedResolve;
    const firstTargetRequested = new Promise((resolveRequest) => {
      firstTargetRequestedResolve = resolveRequest;
    });
    let secondTargetRequestedResolve;
    const secondTargetRequested = new Promise((resolveRequest) => {
      secondTargetRequestedResolve = resolveRequest;
    });
    let targetRequestSawCoarseReady = false;
    const targetRangeRequests = [];
    await progressivePage.route("**/progressive/scene.bin", async (route) => {
      const range = route.request().headers().range;
      if (!range) throw new Error(`${definition.id} target request omitted the Range header.`);
      const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
      if (!match) throw new Error(`${definition.id} emitted invalid target range ${range}.`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      const requestIndex = targetRangeRequests.length;
      targetRangeRequests.push(range);
      if (requestIndex === 0) {
        targetRequestSawCoarseReady = await progressivePage.evaluate(
          () => document.documentElement.dataset.coarseReady === "true",
        );
        firstTargetRequestedResolve();
        await firstTargetGate;
      } else if (requestIndex === 1) {
        secondTargetRequestedResolve();
        await secondTargetGate;
      }
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${progressiveTargetBytes.byteLength}`,
        },
        body: progressiveTargetBytes.subarray(start, end + 1),
      });
    });
    const progressiveSceneUrl = new URL("progressive/scene.gltf", url);
    const progressiveViewerUrl = new URL(url);
    progressiveViewerUrl.searchParams.set("scene", progressiveSceneUrl.href);
    await progressivePage.goto(progressiveViewerUrl.href, { waitUntil: "domcontentloaded" });
    await Promise.all([
      progressivePage.waitForFunction(
        () =>
          document.documentElement.dataset.coarseReady === "true" &&
          document.documentElement.dataset.geometryRepresentation === "coarse" &&
          document.querySelector("#status")?.getAttribute("data-stage") === "coarse",
      ),
      firstTargetRequested,
    ]);
    const progressiveScreenshotName =
      `${definition.id}-${browserVersion.split(".")[0]}-${operatingSystem}-coarse.png`;
    const progressiveScreenshot = await progressivePage.screenshot({
      fullPage: true,
      type: "png",
    });
    await writeFile(resolve(outputDirectory, progressiveScreenshotName), progressiveScreenshot);
    observed.progressive = {
      coarseVisibleBeforeTarget: true,
      targetRequestSawCoarseReady,
      coarseStatus: await progressivePage.locator("#status").innerText(),
      coarseTriangles: await progressivePage.locator("#triangle-count").innerText(),
      coarseEdges: await progressivePage.locator("#edge-count").innerText(),
      coarseScreenshot: {
        path: progressiveScreenshotName,
        bytes: progressiveScreenshot.byteLength,
        sha256: sha256(progressiveScreenshot),
      },
    };
    if (!targetRequestSawCoarseReady) {
      throw new Error(`${definition.id} requested target geometry before the coarse frame.`);
    }
    releaseFirstTargetChunk();
    await Promise.all([
      progressivePage.waitForFunction(
        () =>
          document.documentElement.dataset.targetChunksReady === "1" &&
          document.documentElement.dataset.targetChunksTotal === "3" &&
          document.documentElement.dataset.geometryRepresentation === "mixed" &&
          document.querySelector("#status")?.getAttribute("data-stage") === "target-chunks",
      ),
      secondTargetRequested,
    ]);
    const partialScreenshotName =
      `${definition.id}-${browserVersion.split(".")[0]}-${operatingSystem}-partial.png`;
    const partialScreenshot = await progressivePage.screenshot({
      fullPage: true,
      type: "png",
    });
    await writeFile(resolve(outputDirectory, partialScreenshotName), partialScreenshot);
    Object.assign(observed.progressive, {
      firstTargetChunkPromoted: true,
      partialStatus: await progressivePage.locator("#status").innerText(),
      partialTriangles: await progressivePage.locator("#triangle-count").innerText(),
      partialEdges: await progressivePage.locator("#edge-count").innerText(),
      partialScreenshot: {
        path: partialScreenshotName,
        bytes: partialScreenshot.byteLength,
        sha256: sha256(partialScreenshot),
      },
    });
    releaseSecondTargetChunk();
    await progressivePage.locator("#status[data-state='ready']").waitFor({ timeout: 15_000 });
    Object.assign(observed.progressive, {
      targetPromoted: await progressivePage.evaluate(
        () =>
          document.documentElement.dataset.targetReady === "true" &&
          document.documentElement.dataset.geometryRepresentation === "target",
      ),
      targetStatus: await progressivePage.locator("#status").innerText(),
      targetTriangles: await progressivePage.locator("#triangle-count").innerText(),
      targetEdges: await progressivePage.locator("#edge-count").innerText(),
      targetRangeRequests,
      targetResponsesPartial: targetRangeRequests.length === expectedTargetRanges.length,
    });
    if (!observed.progressive.targetPromoted) {
      throw new Error(`${definition.id} did not promote coarse bounds to target geometry.`);
    }
    assertEqual(
      JSON.stringify(targetRangeRequests),
      JSON.stringify(expectedTargetRanges),
      `${definition.id} target range sequence`,
    );
    await progressivePage.close();

    const viewPriorityPage = await context.newPage();
    viewPriorityPage.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    viewPriorityPage.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    await viewPriorityPage.route("**/progressive/scene.gltf", (route) =>
      route.fulfill({
        path: resolve(progressiveDirectory, "scene.gltf"),
        contentType: "model/gltf+json",
      }),
    );
    await viewPriorityPage.route("**/progressive/coarse.bin", (route) =>
      route.fulfill({
        path: resolve(progressiveDirectory, "coarse.bin"),
        contentType: "application/octet-stream",
      }),
    );
    let releaseObsoleteRange;
    const obsoleteRangeGate = new Promise((resolveGate) => {
      releaseObsoleteRange = resolveGate;
    });
    let releaseTailRanges;
    const tailRangeGate = new Promise((resolveGate) => {
      releaseTailRanges = resolveGate;
    });
    let firstViewRangeResolve;
    const firstViewRange = new Promise((resolveRequest) => {
      firstViewRangeResolve = resolveRequest;
    });
    let replacementViewRangeResolve;
    const replacementViewRange = new Promise((resolveRequest) => {
      replacementViewRangeResolve = resolveRequest;
    });
    let obsoleteRangeReleased = false;
    let replacementRequestedBeforeRelease = false;
    const viewPriorityRangeRequests = [];
    await viewPriorityPage.route("**/progressive/scene.bin", async (route) => {
      const range = route.request().headers().range;
      const match = range ? /^bytes=(\d+)-(\d+)$/u.exec(range) : undefined;
      if (!match) throw new Error(`${definition.id} view-priority request omitted its range.`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      const requestIndex = viewPriorityRangeRequests.length;
      viewPriorityRangeRequests.push(range);
      if (requestIndex === 0) {
        firstViewRangeResolve();
        await obsoleteRangeGate;
        await route.abort("aborted").catch(() => undefined);
        return;
      }
      if (requestIndex === 1) {
        replacementRequestedBeforeRelease = !obsoleteRangeReleased;
        replacementViewRangeResolve();
      } else {
        await tailRangeGate;
      }
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${progressiveTargetBytes.byteLength}`,
        },
        body: progressiveTargetBytes.subarray(start, end + 1),
      });
    });
    await viewPriorityPage.goto(progressiveViewerUrl.href, { waitUntil: "domcontentloaded" });
    await Promise.all([
      viewPriorityPage.waitForFunction(
        () => document.documentElement.dataset.coarseReady === "true",
      ),
      firstViewRange,
    ]);
    const priorityCanvas = viewPriorityPage.locator("#viewport");
    const priorityCanvasBounds = await priorityCanvas.boundingBox();
    if (!priorityCanvasBounds) throw new Error(`${definition.id} priority canvas has no bounds.`);
    await viewPriorityPage.mouse.move(
      priorityCanvasBounds.x + priorityCanvasBounds.width / 2,
      priorityCanvasBounds.y + priorityCanvasBounds.height / 2,
    );
    await viewPriorityPage.mouse.down({ button: "middle" });
    await viewPriorityPage.mouse.move(
      priorityCanvasBounds.x + priorityCanvasBounds.width / 2 + 100,
      priorityCanvasBounds.y + priorityCanvasBounds.height / 2 - 50,
      { steps: 1 },
    );
    await viewPriorityPage.mouse.up({ button: "middle" });
    try {
      await viewPriorityPage.waitForFunction(
        () => document.documentElement.dataset.targetSchedulerCancellations === "1",
        undefined,
        { timeout: 5_000 },
      );
      await Promise.race([
        replacementViewRange,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("replacement Range timed out")), 5_000),
        ),
      ]);
    } catch (error) {
      const diagnostics = await viewPriorityPage.evaluate(() => ({
        order: document.documentElement.dataset.targetSchedulerOrder,
        cancellations: document.documentElement.dataset.targetSchedulerCancellations,
        cameraOrigin: document.documentElement.dataset.cameraOrigin,
        status: document.querySelector("#status")?.textContent,
        canvas: (() => {
          const bounds = document.querySelector("#viewport")?.getBoundingClientRect();
          return bounds ? { width: bounds.width, height: bounds.height } : undefined;
        })(),
      }));
      releaseObsoleteRange();
      releaseTailRanges();
      throw new Error(
        `${definition.id} view-priority navigation failed: ${JSON.stringify({
          diagnostics,
          viewPriorityRangeRequests,
          cause: error instanceof Error ? error.message : String(error),
        })}`,
        { cause: error },
      );
    }
    obsoleteRangeReleased = true;
    releaseObsoleteRange();
    await viewPriorityPage.waitForFunction(
      () => document.documentElement.dataset.targetChunksReady === "1",
    );
    const viewPriorityScreenshotName =
      `${definition.id}-${browserVersion.split(".")[0]}-${operatingSystem}-view-priority.png`;
    const viewPriorityScreenshot = await viewPriorityPage.screenshot({
      fullPage: true,
      type: "png",
    });
    await writeFile(resolve(outputDirectory, viewPriorityScreenshotName), viewPriorityScreenshot);
    observed.progressive.viewPriority = {
      initialSchedulerChunk: targetChunkIdByRange.get(viewPriorityRangeRequests[0]),
      replacementSchedulerChunk: targetChunkIdByRange.get(viewPriorityRangeRequests[1]),
      initialRange: viewPriorityRangeRequests[0],
      replacementRange: viewPriorityRangeRequests[1],
      obsoleteRangeCancelled: await viewPriorityPage.evaluate(
        () => document.documentElement.dataset.targetSchedulerCancellations === "1",
      ),
      replacementRequestedBeforeRelease,
      screenshot: {
        path: viewPriorityScreenshotName,
        bytes: viewPriorityScreenshot.byteLength,
        sha256: sha256(viewPriorityScreenshot),
      },
    };
    if (
      !observed.progressive.viewPriority.obsoleteRangeCancelled ||
      !replacementRequestedBeforeRelease ||
      viewPriorityRangeRequests[0] === viewPriorityRangeRequests[1]
    ) {
      throw new Error(`${definition.id} did not replace obsolete camera work.`);
    }
    releaseTailRanges();
    await viewPriorityPage.close();

    const cancellationPage = await context.newPage();
    cancellationPage.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    cancellationPage.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    await cancellationPage.route("**/progressive/scene.gltf", (route) =>
      route.fulfill({
        path: resolve(progressiveDirectory, "scene.gltf"),
        contentType: "model/gltf+json",
      }),
    );
    await cancellationPage.route("**/progressive/coarse.bin", (route) =>
      route.fulfill({
        path: resolve(progressiveDirectory, "coarse.bin"),
        contentType: "application/octet-stream",
      }),
    );
    let abortSecondChunk;
    const abortSecondChunkGate = new Promise((resolveAbort) => {
      abortSecondChunk = resolveAbort;
    });
    let cancellableChunkRequestedResolve;
    const cancellableChunkRequested = new Promise((resolveRequest) => {
      cancellableChunkRequestedResolve = resolveRequest;
    });
    let cancellationRangeRequests = 0;
    await cancellationPage.route("**/progressive/scene.bin", async (route) => {
      const range = route.request().headers().range;
      const match = range ? /^bytes=(\d+)-(\d+)$/u.exec(range) : undefined;
      if (!match) throw new Error(`${definition.id} cancellation request omitted its range.`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      cancellationRangeRequests += 1;
      if (cancellationRangeRequests === 2) {
        cancellableChunkRequestedResolve();
        await abortSecondChunkGate;
        await route.abort("aborted").catch(() => undefined);
        return;
      }
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${progressiveTargetBytes.byteLength}`,
        },
        body: progressiveTargetBytes.subarray(start, end + 1),
      });
    });
    await cancellationPage.goto(progressiveViewerUrl.href, { waitUntil: "domcontentloaded" });
    await Promise.all([
      cancellationPage.waitForFunction(
        () => document.documentElement.dataset.targetChunksReady === "1",
      ),
      cancellableChunkRequested,
    ]);
    await cancellationPage.locator("#cancel-scene-load").click();
    abortSecondChunk();
    await cancellationPage.waitForFunction(
      () =>
        document.documentElement.dataset.sceneLoading === "false" &&
        document.querySelector("#status")?.getAttribute("data-state") === "error" &&
        document.querySelector("#status")?.textContent === "Scene load cancelled.",
    );
    await cancellationPage.waitForTimeout(250);
    observed.progressive.cancellation = {
      activeRangeAborted: true,
      requestsBeforeCancel: cancellationRangeRequests,
      noFurtherRequests: cancellationRangeRequests === 2,
      status: await cancellationPage.locator("#status").innerText(),
    };
    if (!observed.progressive.cancellation.noFurtherRequests) {
      throw new Error(`${definition.id} continued target requests after cancellation.`);
    }
    await cancellationPage.close();

    const webGpu = await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      return {
        available: Boolean(navigator.gpu),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        adapter: adapter
          ? {
              vendor: adapter.info.vendor,
              architecture: adapter.info.architecture,
              device: adapter.info.device,
              description: adapter.info.description,
              isFallbackAdapter:
                adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter ?? null,
            }
          : null,
      };
    });
    if (!webGpu.available || !webGpu.adapter) {
      throw new Error(`${definition.id} did not expose a WebGPU adapter.`);
    }
    if (consoleIssues.length > 0) {
      throw new Error(`${definition.id} emitted browser issues: ${JSON.stringify(consoleIssues)}.`);
    }

    const browserMajor = browserVersion.split(".")[0];
    const screenshotName = `${definition.id}-${browserMajor}-${operatingSystem}-selected.png`;
    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    await writeFile(resolve(outputDirectory, screenshotName), screenshot);

    return {
      browser: definition.id,
      browserEngine: definition.engine,
      browserVersion,
      headless,
      viewport,
      userAgent: webGpu.userAgent,
      platform: webGpu.platform,
      adapter: webGpu.adapter,
      observed,
      consoleIssues,
      screenshot: {
        path: screenshotName,
        bytes: screenshot.byteLength,
        sha256: sha256(screenshot),
      },
    };
  } finally {
    await browser.close();
  }
}

await mkdir(outputDirectory, { recursive: true });
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});

try {
  await vite.listen();
  const results = [];
  const definitions = [
    {
      id: "chrome",
      engine: "Blink",
      launch: () => chromium.launch({ channel: "chrome", headless }),
    },
    {
      id: "firefox",
      engine: "Gecko",
      launch: () => firefox.launch({ headless }),
    },
  ].filter(({ id }) => browserFilter === undefined || id === browserFilter);
  for (const definition of definitions) {
    results.push(await recordBrowser(definition));
  }

  const evidence = {
    schemaVersion: "phase-1-browser-matrix.2",
    capturedAt: new Date().toISOString(),
    source: {
      fixture: "fixtures/step/adafruit-pygamer.step",
      sceneIr: "generated locally; not committed (80.6 MB JSON evidence)",
      occtReport: "artifacts/occt/adafruit-pygamer.report.json",
      gltf: "artifacts/phase1/adafruit-pygamer/scene.gltf",
      binary: "artifacts/phase1/adafruit-pygamer/scene.bin",
      progressiveGltf: "artifacts/phase1/repeated-fasteners-ap242/scene.gltf",
      progressiveCoarse: "artifacts/phase1/repeated-fasteners-ap242/coarse.bin",
      progressiveTarget: "artifacts/phase1/repeated-fasteners-ap242/scene.bin",
      progressivePackageDigest: progressiveCompilerReport.output.packageDigest,
      progressiveSourceDigest: progressiveCompilerReport.source.sourceDigest,
      packageDigest: compilerReport.output.packageDigest,
      sourceDigest: compilerReport.source.sourceDigest,
    },
    host: { platform: process.platform, architecture: process.arch },
    expected,
    results,
  };
  await writeFile(
    resolve(outputDirectory, "browser-matrix.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`[browser-matrix] ${results.length} engines passed`);
  for (const result of results) {
    console.log(
      `[browser-matrix] ${result.browser} ${result.browserVersion}: ${result.observed.selection}`,
    );
  }
  console.log(`[browser-matrix] evidence: ${outputDirectory}`);
} finally {
  await vite.close();
}
