// Records a localized camera trace against a package that carries the
// optional spatial demand index (ADR-0008). The fitted view that opens the
// Studio intersects the whole hierarchy, so it measures the recorded totals;
// the trace then zooms and pans the camera into one part of the model and
// measures the same counters again. The record publishes both windows, the
// per-query timing distribution of each, and the target Range traffic the
// two views cause, for the compatibility and leaf-anchor payload orders.
//
//   node scripts/record-spatial-localized-trace-evidence.mjs \
//     [--scene-dir output/ifc/digital-hub-spatial-analysis/compatibility] \
//     [--label compatibility] [--output output/spatial-localized/compatibility] \
//     [--port 4176] [--residency-mib 64] [--headless]
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const argValue = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${flag} requires a value.`);
  return value;
};
const insideRepository = (value, label) => {
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

const label = argValue("--label", "compatibility");
const sceneDirectory = insideRepository(
  argValue("--scene-dir", `output/ifc/digital-hub-spatial-analysis/${label}`),
  "Scene directory",
);
const reportPath = insideRepository(
  argValue("--report", relative(repositoryRoot, resolve(sceneDirectory, "build-report.json"))),
  "Build report",
);
const outputDirectory = insideRepository(
  argValue("--output", `output/spatial-localized/${label}`),
  "Trace output",
);
const port = Number(argValue("--port", "4176"));
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new TypeError("--port must be a valid TCP port.");
}
const residencyMiBArgument = argValue("--residency-mib", null);
const residencyMiB = residencyMiBArgument === null ? null : Number(residencyMiBArgument);
if (
  residencyMiB !== null &&
  (!Number.isFinite(residencyMiB) || residencyMiB < 4 || residencyMiB > 1024)
) {
  throw new TypeError("--residency-mib must be between 4 and 1024.");
}
const headless = process.argv.includes("--headless");

const sha256File = async (path) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
};
const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
};
const distribution = (values) =>
  values.length === 0
    ? null
    : {
        sampleCount: values.length,
        minimum: Math.min(...values),
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        maximum: Math.max(...values),
      };

const buildReport = JSON.parse(await readFile(reportPath, "utf8"));
for (const resource of buildReport.output.resources) {
  const digest = await sha256File(resolve(sceneDirectory, resource.path));
  if (digest !== resource.sha256) {
    throw new Error(
      `${resource.path} digest ${digest} does not match the build report ${resource.sha256}.`,
    );
  }
}
if (!buildReport.output.resources.some(({ path }) => path === "spatial.bin")) {
  throw new Error("The package has no spatial.bin; recompile it with --spatial-index.");
}
console.log(
  `[spatial-trace] ${label}: package ${buildReport.output.packageDigest.slice(0, 12)} verified`,
);

// A view demands chunks, but a user pays for their bytes. The progressive
// metadata prices every chunk so each window can report what a cold client
// would have had to fetch, whether or not this run still had to fetch it.
const gltfResource = buildReport.output.resources.find(({ path }) => path === "scene.gltf");
if (gltfResource.bytes > 512 * 1024 * 1024) {
  throw new Error("scene.gltf is too large to price chunks by parsing; extend the recorder.");
}
const progressive = JSON.parse(
  await readFile(resolve(sceneDirectory, "scene.gltf"), "utf8"),
).extras.madi.progressive;
const chunkBytes = new Map(
  progressive.targetChunks.map(({ id, byteLength }) => [id, byteLength]),
);
const totalTargetBytes = [...chunkBytes.values()].reduce((total, value) => total + value, 0);
const chunkIdList = (demand) => (demand ?? "").split(",").filter((id) => id !== "");

const demandedBytes = (demand) =>
  chunkIdList(demand)
    .reduce((total, id) => {
      const bytes = chunkBytes.get(id);
      if (bytes === undefined) throw new Error(`Demanded chunk ${id} has no payload length.`);
      return total + bytes;
    }, 0);

await mkdir(outputDirectory, { recursive: true });
process.env.NARU_SCENE_DIR = relative(repositoryRoot, sceneDirectory);
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "127.0.0.1", port, strictPort: true },
});
const browser = await chromium.launch({
  channel: "chrome",
  headless,
  args: ["--enable-precise-memory-info"],
});
try {
  await vite.listen();
  const viewerUrl = new URL(`http://127.0.0.1:${port}/`);
  viewerUrl.searchParams.set("scene", new URL("scene.gltf", viewerUrl).href);
  if (residencyMiB !== null) viewerUrl.searchParams.set("residencyMiB", String(residencyMiB));

  const context = await browser.newContext({ viewport: { width: 1320, height: 1000 } });
  // Every scheduler reprioritization rewrites the spatial datasets together, so
  // one observer on the query timing attribute yields a paired sample series.
  await context.addInitScript(() => {
    window.__naruSpatialSamples = [];
    const read = (key) => {
      const value = document.documentElement.dataset[key];
      return value === undefined ? null : Number(value);
    };
    // The root element does not exist yet at document start, so the observer
    // watches the document and keeps the mutations the root reports.
    new MutationObserver((mutations) => {
      if (window.__naruSpatialSamples.length >= 5000) return;
      if (!mutations.some(({ target }) => target === document.documentElement)) return;
      window.__naruSpatialSamples.push({
        milliseconds: Math.round(performance.now()),
        queryMilliseconds: read("spatialQueryMilliseconds"),
        visitedNodes: read("spatialNodesVisited"),
        visibleLeaves: read("spatialLeavesVisible"),
        testedOccurrences: read("spatialOccurrencesTested"),
        candidateChunks: read("spatialCandidateChunks"),
      });
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-spatial-query-milliseconds"],
    });
  });
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
  let crashed = false;
  page.on("crash", () => {
    crashed = true;
  });
  const binaryRequests = [];
  page.on("response", (response) => {
    const requestUrl = response.url();
    if (!/\.(bin|gltf)(\?|$)/u.test(requestUrl)) return;
    if (binaryRequests.length >= 2000) return;
    binaryRequests.push({
      resource: requestUrl.slice(requestUrl.lastIndexOf("/") + 1),
      status: response.status(),
      range: response.request().headers().range ?? null,
    });
  });
  const targetRangeCount = () =>
    binaryRequests.filter(
      ({ resource, status, range }) => resource === "scene.bin" && status === 206 && range,
    ).length;

  const startedAt = Date.now();
  const milestones = {};
  const waitMilestone = async (name, predicate, timeout) => {
    await page.waitForFunction(predicate, undefined, { timeout });
    milestones[name] = Date.now() - startedAt;
    console.log(`[spatial-trace] ${name}: ${(milestones[name] / 1000).toFixed(1)}s`);
  };
  const screenshot = async (name) => {
    const bytes = await page.screenshot({ type: "png", timeout: 120_000 });
    await writeFile(resolve(outputDirectory, name), bytes);
    return {
      path: name,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  // The scheduler answers a camera change asynchronously; a window is only
  // comparable once the demand it produced has stopped moving.
  const settle = async (quietChecks, intervalMs, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let previous = "";
    let quiet = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(intervalMs);
      const current = await page.evaluate(() => {
        const root = document.documentElement.dataset;
        return [
          document.querySelector("#status")?.getAttribute("data-state") ?? "",
          root.targetSchedulerRequests ?? "",
          root.targetSchedulerSkips ?? "",
          root.targetChunksReady ?? "",
          root.spatialCandidateChunks ?? "",
        ].join("|");
      });
      quiet = current === previous ? quiet + 1 : 0;
      previous = current;
      if (quiet >= quietChecks && current.startsWith("ready|")) return;
    }
    throw new Error("The spatial demand never settled within the trace timeout.");
  };
  const resetSamples = () => page.evaluate(() => {
    window.__naruSpatialSamples.length = 0;
  });
  const readWindow = async (name, rangesBefore) => {
    const samples = await page.evaluate(() => window.__naruSpatialSamples);
    if (samples.length === 0) throw new Error(`The ${name} window recorded no spatial query.`);
    const last = samples.at(-1);
    const dataset = await page.evaluate(() => ({ ...document.documentElement.dataset }));
    return {
      visitedNodeCount: last.visitedNodes,
      visibleLeafCount: last.visibleLeaves,
      testedOccurrenceCount: last.testedOccurrences,
      candidateChunkCount: last.candidateChunks,
      queryMilliseconds: distribution(samples.map(({ queryMilliseconds }) => queryMilliseconds)),
      visibleLeafCounts: distribution(samples.map(({ visibleLeaves }) => visibleLeaves)),
      candidateChunkCounts: distribution(samples.map(({ candidateChunks }) => candidateChunks)),
      schedulerRequests: Number(dataset.targetSchedulerRequests),
      schedulerSkips: Number(dataset.targetSchedulerSkips ?? 0),
      schedulerCancellations: Number(dataset.targetSchedulerCancellations ?? 0),
      targetChunksReady: Number(dataset.targetChunksReady),
      residentDecodedBytes: Number(dataset.residentDecodedBytes),
      residentGpuBytes: Number(dataset.residentGpuBytes),
      targetRangeResponses: targetRangeCount() - rangesBefore,
      demandedBytes: demandedBytes(dataset.targetSchedulerDemand ?? ""),
      samples,
    };
  };

  await page.goto(viewerUrl.href, { waitUntil: "domcontentloaded" });
  await waitMilestone(
    "hierarchyReadyMs",
    () => document.documentElement.dataset.hierarchyReady === "true",
    600_000,
  );
  await waitMilestone(
    "coarseFrameMs",
    () =>
      document.documentElement.dataset.coarseReady === "true" ||
      document.querySelector("#status")?.getAttribute("data-state") === "error",
    1_200_000,
  );
  await waitMilestone(
    "readyMs",
    () => {
      const state = document.querySelector("#status")?.getAttribute("data-state");
      return state === "ready" || state === "error";
    },
    1_800_000,
  );
  const schedulerMode = await page.evaluate(
    () => document.documentElement.dataset.targetSchedulerMode ?? null,
  );
  if (schedulerMode !== "spatial-bvh-v1") {
    throw new Error(`The Studio used ${schedulerMode ?? "no"} scheduler, not the spatial index.`);
  }
  const totals = await page.evaluate(() => {
    const root = document.documentElement.dataset;
    return {
      spatialNodeCount: Number(root.spatialNodesTotal),
      spatialLeafCount: Number(root.spatialLeavesTotal),
      spatialOccurrenceCount: Number(root.spatialOccurrencesTotal),
      targetChunkCount: Number(root.targetChunksTotal),
    };
  });
  await settle(3, 1_000, 600_000);

  const fitted = await readWindow("fitted", 0);
  const fittedScreenshot = await screenshot("fitted-view.png");
  console.log(
    `[spatial-trace] fitted: ${fitted.visibleLeafCount}/${totals.spatialLeafCount} leaves, ` +
      `${fitted.candidateChunkCount}/${totals.targetChunkCount} candidate chunks, ` +
      `${fitted.targetRangeResponses} Ranges`,
  );

  const rangesAfterFit = targetRangeCount();
  await resetSamples();
  const canvas = page.locator("#viewport");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The viewport canvas has no visible bounds.");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const camera = {
    wheelDelta: Number(argValue("--wheel-delta", "-1200")),
    panX: Number(argValue("--pan-x", "220")),
    panY: Number(argValue("--pan-y", "-140")),
  };
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, camera.wheelDelta);
  await page.waitForTimeout(500);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(centerX + camera.panX / 2, centerY + camera.panY / 2, { steps: 8 });
  await page.mouse.move(centerX + camera.panX, centerY + camera.panY, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(3, 1_000, 600_000);
  const localized = await readWindow("localized", rangesAfterFit);
  const localizedScreenshot = await screenshot("localized-view.png");
  console.log(
    `[spatial-trace] localized: ${localized.visibleLeafCount}/${totals.spatialLeafCount} leaves, ` +
      `${localized.candidateChunkCount}/${totals.targetChunkCount} candidate chunks, ` +
      `${localized.demandedBytes}/${totalTargetBytes} demanded bytes`,
  );

  const rangesAfterLocalize = targetRangeCount();
  await resetSamples();
  // A single camera pose yields too few queries to describe the navigation
  // path, so the trace orbits within the localized view and keeps every query.
  const navigationSteps = Number(argValue("--navigation-steps", "12"));
  if (!Number.isSafeInteger(navigationSteps) || navigationSteps < 1) {
    throw new TypeError("--navigation-steps must be a positive integer.");
  }
  for (let step = 0; step < navigationSteps; step += 1) {
    const dragX = centerX + camera.panX;
    const dragY = centerY + camera.panY;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 24, dragY + 12, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  await settle(3, 1_000, 600_000);
  const navigation = await readWindow("navigation", rangesAfterLocalize);
  console.log(
    `[spatial-trace] navigation: ${navigation.queryMilliseconds.sampleCount} queries, ` +
      `p50 ${navigation.queryMilliseconds.p50.toFixed(3)} ms, ` +
      `p95 ${navigation.queryMilliseconds.p95.toFixed(3)} ms`,
  );
  const exhaustive = navigation.samples.filter(
    ({ testedOccurrences }) => testedOccurrences >= totals.spatialOccurrenceCount,
  ).length;
  if (exhaustive > 0) {
    throw new Error(
      `${exhaustive} navigation queries traversed every occurrence in the model.`,
    );
  }

  const reductions = {
    demandedBytes: fitted.demandedBytes - localized.demandedBytes,
    visitedNodes: fitted.visitedNodeCount - localized.visitedNodeCount,
    visibleLeaves: fitted.visibleLeafCount - localized.visibleLeafCount,
    testedOccurrences: fitted.testedOccurrenceCount - localized.testedOccurrenceCount,
    candidateChunks: fitted.candidateChunkCount - localized.candidateChunkCount,
  };
  for (const [key, delta] of Object.entries(reductions)) {
    if (delta <= 0) {
      throw new Error(`The localized view did not reduce ${key} (delta ${delta}).`);
    }
  }
  if (localized.candidateChunkCount <= 0) {
    throw new Error("The localized view demanded no chunk at all; choose a milder camera move.");
  }
  const snapshot = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent ?? null;
    const memory = performance.memory;
    return {
      status: text("#status"),
      statusState: document.querySelector("#status")?.getAttribute("data-state"),
      statusStage: document.querySelector("#status")?.getAttribute("data-stage"),
      triangleCount: text("#triangle-count"),
      edgeCount: text("#edge-count"),
      decodeTime: text("#decode-time"),
      geometryResult: text("#geometry-result"),
      gpuAdapter: text("#gpu-adapter"),
      dataset: { ...document.documentElement.dataset },
      usedJsHeapBytes: memory ? memory.usedJSHeapSize : null,
    };
  });
  // Both scheduler lists name every chunk they cover; the record keeps their
  // lengths, because the byte totals above are what a reader can act on.
  const { targetSchedulerOrder, targetSchedulerDemand, ...datasetSnapshot } = snapshot.dataset;
  snapshot.dataset = {
    ...datasetSnapshot,
    targetSchedulerOrderChunks: String(chunkIdList(targetSchedulerOrder).length),
    targetSchedulerDemandChunks: String(chunkIdList(targetSchedulerDemand).length),
  };
  if (crashed) throw new Error("The page crashed during the trace.");
  if (consoleIssues.length > 0) {
    throw new Error(`The browser emitted issues: ${JSON.stringify(consoleIssues)}.`);
  }

  const evidence = {
    schemaVersion: "naru.spatial-localized-trace.1",
    capturedAt: new Date(startedAt).toISOString(),
    payloadOrder: label,
    mode: "headed-localized-camera-trace",
    browser: {
      id: "chrome",
      engine: "Blink",
      version: browser.version(),
      headless,
      viewport: { width: 1320, height: 1000 },
    },
    host: { platform: process.platform, architecture: process.arch },
    capture: { residencyMiB, cameraMove: camera },
    source: {
      buildReport: relative(repositoryRoot, reportPath).replaceAll(sep, "/"),
      packageDigest: buildReport.output.packageDigest,
      resources: buildReport.output.resources,
      servedFrom: "Vite dev static hosting with HTTP Range support",
    },
    milestones,
    schedulerMode,
    totals: { ...totals, totalTargetBytes },
    fitted,
    localized,
    navigation,
    reductions,
    snapshot,
    consoleIssues,
    screenshots: { fitted: fittedScreenshot, localized: localizedScreenshot },
  };
  await writeFile(
    resolve(outputDirectory, "localized-trace.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`[spatial-trace] evidence: ${relative(repositoryRoot, outputDirectory)}`);
} finally {
  await browser.close();
  await vite.close();
}
