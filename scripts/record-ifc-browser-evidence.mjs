// Records the first browser/residency result for a compiled real-large IFC
// federation package. It verifies the local package against the committed
// build report, serves it through the Studio dev server, loads it in headed
// Chrome, and records the loading milestone timeline, bounded-residency
// datasets, Range promotion, picking, and the lazily resolved property
// sidecar entries for the picked occurrence.
//
//   pnpm ifc:browser:evidence
//   node scripts/record-ifc-browser-evidence.mjs \
//     [--scene-dir output/ifc/sixty5] \
//     [--report artifacts/ifc/sixty5/build-report.json] \
//     [--output artifacts/ifc/sixty5-browser] [--browser chrome|firefox] [--headless] \
//     [--skip-coarse-screenshot] [--residency-mib 64]
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { chromium, firefox } from "playwright";
import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}
const sceneDirectory = resolve(repositoryRoot, argValue("--scene-dir", "output/ifc/sixty5"));
const reportPath = resolve(
  repositoryRoot,
  argValue("--report", "artifacts/ifc/sixty5/build-report.json"),
);
const outputDirectory = resolve(
  repositoryRoot,
  argValue("--output", "artifacts/ifc/sixty5-browser"),
);
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
// The record is engine-parameterised so the same protocol can be repeated on
// a second engine; every launch difference lives in this table and nowhere
// else. Chrome reports performance.memory only with the precise-memory switch.
const browserEngines = {
  chrome: {
    id: "chrome",
    engine: "Blink",
    launch: () =>
      chromium.launch({ channel: "chrome", headless, args: ["--enable-precise-memory-info"] }),
  },
  firefox: {
    id: "firefox",
    engine: "Gecko",
    launch: () => firefox.launch({ headless }),
  },
};
const browserId = argValue("--browser", "chrome");
const browserEngine = Object.hasOwn(browserEngines, browserId)
  ? browserEngines[browserId]
  : undefined;
if (!browserEngine) throw new TypeError("--browser must be chrome or firefox.");
const skipCoarseScreenshot = process.argv.includes("--skip-coarse-screenshot");
const residencyMiBArgument = argValue("--residency-mib", null);
const residencyMiB = residencyMiBArgument === null ? null : Number(residencyMiBArgument);
if (
  residencyMiB !== null &&
  (!Number.isFinite(residencyMiB) || residencyMiB < 4 || residencyMiB > 1024)
) {
  throw new TypeError("--residency-mib must be between 4 and 1024.");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

// Bind the record to the committed package: the served files must be the
// bytes the compile evidence describes.
const buildReport = JSON.parse(await readFile(reportPath, "utf8"));
for (const resource of buildReport.output.resources) {
  const digest = await sha256File(resolve(sceneDirectory, resource.path));
  if (digest !== resource.sha256) {
    throw new Error(
      `${resource.path} digest ${digest} does not match the build report ` +
        `${resource.sha256}; recompile the package before recording.`,
    );
  }
}
console.log(
  `[ifc-browser] package ${buildReport.output.packageDigest.slice(0, 12)} verified against ${
    relative(repositoryRoot, reportPath)
  }`,
);

await mkdir(outputDirectory, { recursive: true });
process.env.NARU_SCENE_DIR = relative(repositoryRoot, sceneDirectory);
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
const browser = await browserEngine.launch();
try {
  await vite.listen();
  const viewerUrl = new URL("http://127.0.0.1:4174/");
  viewerUrl.searchParams.set("scene", new URL("scene.gltf", viewerUrl).href);
  if (residencyMiB !== null) viewerUrl.searchParams.set("residencyMiB", String(residencyMiB));

  const context = await browser.newContext({ viewport: { width: 1320, height: 1000 } });
  await context.addInitScript(() => {
    window.__naruTimeline = [];
    new MutationObserver((mutations) => {
      if (window.__naruTimeline.length >= 2000) return;
      for (const mutation of mutations) {
        const element = mutation.target;
        if (!(element instanceof Element)) continue;
        if (element !== document.documentElement && element.id !== "status") continue;
        window.__naruTimeline.push({
          milliseconds: Math.round(performance.now()),
          target: element.id || element.tagName.toLowerCase(),
          attribute: mutation.attributeName,
          value: element.getAttribute(mutation.attributeName),
        });
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: [
        "data-scene-loading",
        "data-hierarchy-ready",
        "data-coarse-ready",
        "data-geometry-representation",
        "data-target-chunks-ready",
        "data-target-chunks-total",
        "data-target-ready",
        "data-residency-budget-reached",
        "data-state",
        "data-stage",
      ],
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
    if (binaryRequests.length >= 400) return;
    binaryRequests.push({
      resource: requestUrl.slice(requestUrl.lastIndexOf("/") + 1),
      status: response.status(),
      range: response.request().headers().range ?? null,
    });
    if (binaryRequests.length <= 10 || binaryRequests.length % 25 === 0) {
      const current = binaryRequests.at(-1);
      console.log(
        `[ifc-browser] response ${binaryRequests.length}: ${current.resource} ` +
          `${current.status} ${current.range ?? "full"}`,
      );
    }
  });

  const startedAt = Date.now();
  const milestones = {};
  const waitMilestone = async (name, predicate, timeout) => {
    await page.waitForFunction(predicate, undefined, { timeout });
    milestones[name] = Date.now() - startedAt;
    console.log(`[ifc-browser] ${name}: ${(milestones[name] / 1000).toFixed(1)}s`);
  };
  const screenshot = async (name) => {
    const bytes = await page.screenshot({ type: "png", timeout: 120_000 });
    await writeFile(resolve(outputDirectory, name), bytes);
    return { path: name, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
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
  // On real-large packages, a Playwright screenshot can wait for font
  // readiness while target decoding monopolizes the page. Keep milestone
  // observation independent from that optional visual capture.
  const coarseScreenshot = skipCoarseScreenshot
    ? null
    : await screenshot("coarse-frame.png");
  const progressTimer = setInterval(() => {
    void page
      .evaluate(() => ({
        state: document.querySelector("#status")?.getAttribute("data-state"),
        targetReady: document.documentElement.dataset.targetReady,
        chunksReady: document.documentElement.dataset.targetChunksReady,
        chunksTotal: document.documentElement.dataset.targetChunksTotal,
        requests: document.documentElement.dataset.targetSchedulerRequests,
        cancellations: document.documentElement.dataset.targetSchedulerCancellations,
        chunk: document.documentElement.dataset.targetSchedulerChunk,
        residentDecodedBytes: document.documentElement.dataset.residentDecodedBytes,
        residentGpuBytes: document.documentElement.dataset.residentGpuBytes,
      }))
      .then((progress) => console.log(`[ifc-browser] progress ${JSON.stringify(progress)}`))
      .catch(() => {});
  }, 30_000);
  try {
    await waitMilestone(
      "readyMs",
      () => {
        const state = document.querySelector("#status")?.getAttribute("data-state");
        return state === "ready" || state === "error";
      },
      1_800_000,
    );
  } finally {
    clearInterval(progressTimer);
  }
  const finalState = await page.evaluate(
    () => document.querySelector("#status")?.getAttribute("data-state"),
  );
  if (finalState !== "ready") {
    throw new Error(`Scene load failed: ${await page.locator("#status").innerText()}`);
  }
  const finalScreenshot = await screenshot("budget-limited.png");

  const snapshot = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent ?? null;
    const memory = performance.memory;
    return {
      status: text("#status"),
      statusState: document.querySelector("#status")?.getAttribute("data-state"),
      statusStage: document.querySelector("#status")?.getAttribute("data-stage"),
      prototypeCount: text("#prototype-count"),
      occurrenceCount: text("#occurrence-count"),
      triangleCount: text("#triangle-count"),
      edgeCount: text("#edge-count"),
      binarySize: text("#binary-size"),
      decodeTime: text("#decode-time"),
      geometryResult: text("#geometry-result"),
      gpuAdapter: text("#gpu-adapter"),
      dataset: { ...document.documentElement.dataset },
      usedJsHeapBytes: memory ? memory.usedJSHeapSize : null,
      totalJsHeapBytes: memory ? memory.totalJSHeapSize : null,
      timeline: window.__naruTimeline,
    };
  });

  const canvas = page.locator("#viewport");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The viewport canvas has no visible bounds.");
  const selectionBefore = await page.locator("#selection").textContent();
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await page.waitForFunction(
    (previous) => {
      const selection = document.querySelector("#selection")?.textContent;
      return selection !== previous && /node \d+/u.test(selection ?? "");
    },
    selectionBefore,
    { timeout: 60_000 },
  );
  const picking = {
    selection: await page.locator("#selection").textContent(),
    selectedObjectId: await page.evaluate(
      () => document.documentElement.dataset.selectedObjectId ?? null,
    ),
  };
  console.log(`[ifc-browser] picking: ${picking.selection}`);

  // The first selection is what triggers the lazy property sidecar fetch;
  // wait for the panel to reach a terminal state before judging it.
  await page.waitForFunction(
    () => {
      const entries = document.querySelector("#semantic-property-entries");
      if (entries instanceof HTMLElement && !entries.hidden) return true;
      const state = document
        .querySelector("#semantic-property-status")
        ?.getAttribute("data-state");
      return state === "absent" || state === "error";
    },
    undefined,
    { timeout: 120_000 },
  );
  const semanticProperties = await page.evaluate(() => {
    const entries = document.querySelector("#semantic-property-entries");
    const status = document.querySelector("#semantic-property-status");
    const resolved = entries instanceof HTMLElement && !entries.hidden;
    const rows = resolved
      ? [...entries.children].map((row) => ({
          key: row.querySelector("dt")?.textContent ?? null,
          value: (row.querySelector("dd")?.textContent ?? "").slice(0, 120),
        }))
      : [];
    return {
      state: resolved ? "resolved" : (status?.getAttribute("data-state") ?? null),
      statusText: resolved ? null : (status?.textContent?.trim() ?? null),
      countLabel: document.querySelector("#semantic-property-count")?.textContent ?? null,
      entryCount: rows.length,
      sampleEntries: rows.slice(0, 8),
    };
  });
  if (semanticProperties.state !== "resolved" || semanticProperties.entryCount === 0) {
    throw new Error(
      `The property sidecar did not resolve for the picked occurrence: ${
        JSON.stringify(semanticProperties)
      }.`,
    );
  }
  console.log(
    `[ifc-browser] properties: ${semanticProperties.entryCount} entries` +
      `${semanticProperties.countLabel ?? ""}`,
  );
  const pickedScreenshot = await screenshot("picked.png");

  if (crashed) throw new Error("The page crashed during the record.");
  if (consoleIssues.length > 0) {
    throw new Error(`The browser emitted issues: ${JSON.stringify(consoleIssues)}.`);
  }

  const evidence = {
    schemaVersion: "madi.ifc-browser-residency.2",
    capturedAt: new Date(startedAt).toISOString(),
    browser: {
      id: browserEngine.id,
      engine: browserEngine.engine,
      version: browser.version(),
      headless,
      viewport: { width: 1320, height: 1000 },
    },
    host: { platform: process.platform, architecture: process.arch },
    capture: {
      coarseScreenshotSkipped: skipCoarseScreenshot,
      residencyMiB,
    },
    source: {
      buildReport: relative(repositoryRoot, reportPath).replaceAll(sep, "/"),
      packageDigest: buildReport.output.packageDigest,
      resources: buildReport.output.resources,
      servedFrom: "Vite dev static hosting with HTTP Range support",
    },
    milestones,
    snapshot,
    picking,
    semanticProperties,
    binaryRequests,
    consoleIssues,
    screenshots: {
      coarse: coarseScreenshot,
      budgetLimited: finalScreenshot,
      picked: pickedScreenshot,
    },
  };
  await writeFile(
    resolve(outputDirectory, "browser-residency.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`[ifc-browser] status: ${snapshot.status}`);
  console.log(`[ifc-browser] evidence: ${relative(repositoryRoot, outputDirectory)}`);
} finally {
  await browser.close();
  await vite.close();
}
