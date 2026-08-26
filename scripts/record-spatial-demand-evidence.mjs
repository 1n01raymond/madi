import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox } from "playwright";
import { createServer } from "vite";

import {
  compileSceneToGltf,
  writeCompiledPackage,
} from "../packages/compiler/dist/index.js";
import { hydratePhase0Evidence } from "../packages/compiler/dist/evidence-input.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const safeOutput = (value, label) => {
  const path = resolve(repositoryRoot, value);
  const fromRoot = relative(repositoryRoot, path);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new TypeError(`${label} must remain inside the repository.`);
  }
  return path;
};
const outputDirectory = safeOutput(
  argument("--output", "output/playwright/spatial-demand"),
  "Evidence output",
);
const packageDirectory = safeOutput(
  argument("--package-output", "output/playwright/spatial-demand/package"),
  "Package output",
);
const requestedBrowser = argument("--browser", undefined);
if (requestedBrowser !== undefined && !["chrome", "firefox"].includes(requestedBrowser)) {
  throw new TypeError("--browser must be chrome or firefox.");
}
const headless = process.argv.includes("--headless");
const viewport = { width: 1320, height: 1000 };
const url = "http://127.0.0.1:4174/";
const operatingSystem =
  { win32: "windows", darwin: "macos", linux: "linux" }[process.platform] ?? process.platform;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceScene = JSON.parse(
  await readFile(resolve(repositoryRoot, "artifacts/occt/repeated-fasteners.scene.json"), "utf8"),
);
const hydratedScene = hydratePhase0Evidence(sourceScene);
// Transform-only scheduler scenario: keep the project-owned geometry and
// hierarchy, but separate the three target-owning prototypes so a localized
// camera has an unambiguous one-chunk oracle. Geometry bytes must remain equal
// to the historical package and are checked below.
const scene = {
  ...hydratedScene,
  sceneId: "naru-spatial-demand-separated-prototypes",
  occurrences: hydratedScene.occurrences.map((occurrence) => {
    const shift = occurrence.prototypeId === "prototype:part:mounting-plate"
      ? -250
      : occurrence.prototypeId === "prototype:part:center-rail"
        ? 250
        : 0;
    if (shift === 0) return occurrence;
    const localTransform = [...occurrence.localTransform];
    localTransform[12] = (localTransform[12] ?? 0) + shift;
    return { ...occurrence, localTransform };
  }),
};
const compileOptions = { coarseBounds: true, spatialIndex: true, spatialLeafCapacity: 1 };
const first = compileSceneToGltf(scene, compileOptions);
const second = compileSceneToGltf(scene, compileOptions);
if (!first.spatialBinary || !first.coarseBinary || !first.spatialBinaryUri) {
  throw new Error("Spatial evidence compilation omitted a declared resource.");
}
if (
  first.json !== second.json ||
  !Buffer.from(first.binary).equals(second.binary) ||
  !Buffer.from(first.coarseBinary).equals(second.coarseBinary) ||
  !Buffer.from(first.spatialBinary).equals(second.spatialBinary ?? new Uint8Array())
) {
  throw new Error("Two spatial evidence compilations were not byte-identical.");
}
const historicalDirectory = resolve(
  repositoryRoot,
  "artifacts/phase1/repeated-fasteners-ap242",
);
const [historicalTarget, historicalCoarse] = await Promise.all([
  readFile(resolve(historicalDirectory, "scene.bin")),
  readFile(resolve(historicalDirectory, "coarse.bin")),
]);
if (!historicalTarget.equals(first.binary) || !historicalCoarse.equals(first.coarseBinary)) {
  throw new Error("Adding the spatial index changed historical target or coarse geometry bytes.");
}
await mkdir(outputDirectory, { recursive: true });
await writeCompiledPackage(first, packageDirectory);
const targetBytes = Buffer.from(first.binary);
const chunks = first.document.extras.madi.progressive.targetChunks;
const rangeToChunk = new Map(
  chunks.map((chunk, index) => [
    `bytes=${chunk.byteOffset}-${chunk.byteOffset + chunk.byteLength - 1}`,
    { index, id: chunk.id, byteLength: chunk.byteLength },
  ]),
);

function readSpatialStats(snapshot) {
  return {
    nodesVisited: Number(snapshot.spatialNodesVisited),
    nodesTotal: Number(snapshot.spatialNodesTotal),
    leavesVisible: Number(snapshot.spatialLeavesVisible),
    leavesTotal: Number(snapshot.spatialLeavesTotal),
    occurrencesTested: Number(snapshot.spatialOccurrencesTested),
    occurrencesTotal: Number(snapshot.spatialOccurrencesTotal),
    candidateChunks: Number(snapshot.spatialCandidateChunks),
    targetChunksTotal: Number(snapshot.targetChunksTotal),
    queryMilliseconds: Number(snapshot.spatialQueryMilliseconds),
  };
}

async function dataset(page) {
  return page.evaluate(() => ({ ...document.documentElement.dataset }));
}

async function localizeView(page) {
  const canvas = page.locator("#viewport");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Spatial evidence canvas has no bounds.");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const localized = (stats) =>
    stats.candidateChunks > 0 &&
    stats.candidateChunks < stats.targetChunksTotal &&
    stats.nodesVisited < stats.nodesTotal &&
    stats.occurrencesTested < stats.occurrencesTotal;
  for (const [deltaX, deltaY] of [[-520, 160], [520, -160]]) {
    await page.locator("#fit-view").click();
    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(centerX + deltaX, centerY + deltaY, { steps: 1 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(100);
    for (const zoomDelta of [-200, -200, -200, -200, -200, -200]) {
      await canvas.hover();
      await page.mouse.wheel(0, zoomDelta);
      await page.waitForTimeout(100);
      const snapshot = await dataset(page);
      const stats = readSpatialStats(snapshot);
      if (localized(stats)) return { stats, snapshot };
    }
  }
  throw new Error(`Could not reproduce a localized spatial query: ${JSON.stringify(await dataset(page))}`);
}

async function recordBrowser(definition) {
  const browser = await definition.launch();
  try {
    const browserVersion = browser.version();
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleIssues = [];
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    let spatialRequests = 0;
    await page.route("**/spatial.bin", async (route) => {
      spatialRequests += 1;
      await route.continue();
    });
    let releaseNavigation;
    const navigationGate = new Promise((resolveGate) => {
      releaseNavigation = resolveGate;
    });
    let firstRequestedResolve;
    const firstRequested = new Promise((resolveRequest) => {
      firstRequestedResolve = resolveRequest;
    });
    const targetRanges = [];
    const fulfilledRanges = [];
    const abortedRanges = [];
    let finalDemand = new Set();
    await page.route("**/scene.bin", async (route) => {
      const range = route.request().headers().range;
      const match = range ? /^bytes=(\d+)-(\d+)$/u.exec(range) : undefined;
      if (!match || !rangeToChunk.has(range)) {
        throw new Error(`${definition.id} emitted an undeclared target Range ${String(range)}.`);
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      targetRanges.push(range);
      if (targetRanges.length === 1) firstRequestedResolve();
      await navigationGate;
      const chunk = rangeToChunk.get(range);
      if (!chunk || !finalDemand.has(chunk.id)) {
        abortedRanges.push(range);
        await route.abort("aborted").catch(() => undefined);
        return;
      }
      fulfilledRanges.push(range);
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${targetBytes.byteLength}`,
        },
        body: targetBytes.subarray(start, end + 1),
      });
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    try {
      await Promise.all([
        page.waitForFunction(
          () =>
            document.documentElement.dataset.coarseReady === "true" &&
            document.documentElement.dataset.targetSchedulerMode === "spatial-bvh-v1" &&
            document.documentElement.dataset.spatialCandidateChunks !== undefined,
        ),
        firstRequested,
      ]);
    } catch (error) {
      throw new Error(
        `${definition.id} did not reach initial spatial demand: ` +
          JSON.stringify({
            dataset: await dataset(page),
            status: await page.locator("#status").textContent().catch(() => undefined),
            consoleIssues,
            cause: error instanceof Error ? error.message : String(error),
          }),
        { cause: error },
      );
    }
    const initialSnapshot = await dataset(page);
    const initial = readSpatialStats(initialSnapshot);
    const localized = await localizeView(page);
    finalDemand = new Set(
      (localized.snapshot.targetSchedulerDemand ?? "").split(",").filter(Boolean),
    );
    releaseNavigation();
    await page.locator("#status[data-state='ready']").waitFor({ timeout: 15_000 });
    const finalSnapshot = await dataset(page);
    const requestedChunks = targetRanges.map((range) => rangeToChunk.get(range));
    const screenshotName =
      `${definition.id}-${browserVersion.split(".")[0]}-${operatingSystem}-spatial-demand.png`;
    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    await writeFile(resolve(outputDirectory, screenshotName), screenshot);
    const adapter = await page.evaluate(async () => {
      const value = await navigator.gpu?.requestAdapter();
      return value
        ? {
            vendor: value.info.vendor,
            architecture: value.info.architecture,
            device: value.info.device,
            description: value.info.description,
            isFallbackAdapter: value.isFallbackAdapter ?? value.info.isFallbackAdapter ?? null,
          }
        : null;
    });
    if (!adapter) throw new Error(`${definition.id} did not expose a WebGPU adapter.`);
    if (spatialRequests !== 1) {
      throw new Error(`${definition.id} requested spatial.bin ${spatialRequests} times.`);
    }
    if (
      localized.stats.candidateChunks >= localized.stats.targetChunksTotal ||
      localized.stats.nodesVisited >= localized.stats.nodesTotal ||
      localized.stats.occurrencesTested >= localized.stats.occurrencesTotal
    ) {
      throw new Error(`${definition.id} did not reduce localized spatial work.`);
    }
    if (consoleIssues.length > 0) {
      throw new Error(`${definition.id} emitted browser issues: ${JSON.stringify(consoleIssues)}.`);
    }
    if (
      finalSnapshot.targetReady !== "spatial-idle" ||
      fulfilledRanges.length !== finalDemand.size ||
      fulfilledRanges.some((range) => !finalDemand.has(rangeToChunk.get(range)?.id))
    ) {
      throw new Error(
        `${definition.id} fetched cold target chunks after localized demand: ` +
          JSON.stringify({
            targetReady: finalSnapshot.targetReady,
            demand: finalSnapshot.targetSchedulerDemand,
            candidates: finalSnapshot.spatialCandidateChunks,
            targetRanges,
            fulfilledRanges,
            abortedRanges,
          }),
      );
    }
    return {
      browser: definition.id,
      browserEngine: definition.engine,
      browserVersion,
      headless,
      viewport,
      adapter,
      spatialRequests,
      initial,
      localized: localized.stats,
      cancellationCount: Number(finalSnapshot.targetSchedulerCancellations ?? 0),
      requestedRanges: targetRanges,
      fulfilledRanges,
      abortedRanges,
      requestedChunks,
      targetReady: finalSnapshot.targetReady,
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

process.env.NARU_SCENE_DIR = packageDirectory;
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});

try {
  await vite.listen();
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
  ].filter(({ id }) => requestedBrowser === undefined || requestedBrowser === id);
  const results = [];
  for (const definition of definitions) results.push(await recordBrowser(definition));
  const spatialPointer = first.document.extras.madi.progressive.spatialIndex;
  const evidence = {
    schemaVersion: "naru.spatial-demand-evidence.1",
    capturedAt: new Date().toISOString(),
    source: {
      sceneIr: "artifacts/occt/repeated-fasteners.scene.json",
      scenario: "transform-only separation of the three target-owning prototypes",
      historicalPackage: "artifacts/phase1/repeated-fasteners-ap242",
      sourceDigest: first.report.source.sourceDigest,
    },
    host: { platform: process.platform, architecture: process.arch },
    compile: {
      leafCapacity: 1,
      deterministic: true,
      historicalTargetUnchanged: true,
      historicalCoarseUnchanged: true,
      packageDigest: first.report.output.packageDigest,
      spatialIndex: spatialPointer,
      targetChunkCount: chunks.length,
      renderableOccurrenceCount: first.report.counts.renderableOccurrenceCount,
    },
    results,
  };
  await writeFile(
    resolve(outputDirectory, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`[spatial-demand] ${results.length} browser records passed`);
  for (const result of results) {
    console.log(
      `[spatial-demand] ${result.browser} ${result.browserVersion}: ` +
        `${result.localized.nodesVisited}/${result.localized.nodesTotal} nodes, ` +
        `${result.localized.candidateChunks}/${result.localized.targetChunksTotal} chunks`,
    );
  }
  console.log(`[spatial-demand] evidence: ${outputDirectory}`);
} finally {
  await vite.close();
}
