// Records what the demand-ordering policy changes once the residency budget
// binds. The Studio asks the ADR-0008 spatial index for the chunks a view
// needs; the budget then admits them in the order the query returned, so the
// order decides which part of a visible model a user actually sees. This
// record drives one camera pose three times over the same package: an
// unbudgeted reference that admits every demanded chunk, then the two
// policies under the shipped 64 MiB budget, and scores each policy's render
// against the reference pixel by pixel.
//
//   node scripts/record-demand-priority-evidence.mjs \
//     [--scene-dir output/ifc/sixty5-spatial/spatial-leaf-anchor] \
//     [--output output/demand-priority] [--port 4177] \
//     [--residency-mib 64] [--reference-residency-mib 192] \
//     [--wheel-delta -5000] [--pan-x 400] [--pan-y -300] [--headless]
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
  if (value === undefined || value.startsWith("--")) throw new TypeError(`${flag} requires a value.`);
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
const positive = (flag, fallback, low, high) => {
  const value = Number(argValue(flag, fallback));
  if (!Number.isFinite(value) || value < low || value > high) {
    throw new TypeError(`${flag} must be between ${low} and ${high}.`);
  }
  return value;
};

const sceneDirectory = insideRepository(
  argValue("--scene-dir", "output/ifc/sixty5-spatial/spatial-leaf-anchor"),
  "Scene directory",
);
const reportPath = insideRepository(
  argValue("--report", relative(repositoryRoot, resolve(sceneDirectory, "build-report.json"))),
  "Build report",
);
const outputDirectory = insideRepository(argValue("--output", "output/demand-priority"), "Output");
const port = positive("--port", "4177", 1024, 65_535);
const residencyMiB = positive("--residency-mib", "64", 4, 1024);
const referenceResidencyMiB = positive("--reference-residency-mib", "192", 4, 1024);
const camera = {
  wheelDelta: Number(argValue("--wheel-delta", "-5000")),
  panX: Number(argValue("--pan-x", "400")),
  panY: Number(argValue("--pan-y", "-300")),
};
const headless = process.argv.includes("--headless");
const viewport = { width: 1320, height: 1000 };

const sha256File = async (path) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
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
  `[demand-priority] package ${buildReport.output.packageDigest.slice(0, 12)} verified`,
);

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

/**
 * Drives one camera pose under one ordering policy and one budget, and
 * returns what the view ended up holding plus a capture of what it drew.
 */
const runPolicy = async (name, priority, budgetMiB) => {
  const startedAt = Date.now();
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
  let crashed = false;
  page.on("crash", () => {
    crashed = true;
  });
  let targetRangeResponses = 0;
  page.on("response", (response) => {
    const requestUrl = response.url();
    if (!requestUrl.endsWith("scene.bin") || response.status() !== 206) return;
    if (response.request().headers().range) targetRangeResponses += 1;
  });

  const milestones = {};
  const waitMilestone = async (key, predicate, timeout) => {
    await page.waitForFunction(predicate, undefined, { timeout });
    milestones[key] = Date.now() - startedAt;
  };
  // The scheduler answers a camera change asynchronously, so a policy is only
  // comparable once the residency it produced has stopped moving.
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
          root.residentGpuBytes ?? "",
        ].join("|");
      });
      quiet = current === previous ? quiet + 1 : 0;
      previous = current;
      if (quiet >= quietChecks && current.startsWith("ready|")) return;
    }
    throw new Error(`The ${name} run never settled within the timeout.`);
  };

  const viewerUrl = new URL(`http://127.0.0.1:${port}/`);
  viewerUrl.searchParams.set("scene", new URL("scene.gltf", viewerUrl).href);
  viewerUrl.searchParams.set("residencyMiB", String(budgetMiB));
  viewerUrl.searchParams.set("demandPriority", priority);
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
  const mode = await page.evaluate(() => ({
    scheduler: document.documentElement.dataset.targetSchedulerMode ?? null,
    priority: document.documentElement.dataset.targetSchedulerDemandPriority ?? null,
  }));
  if (mode.scheduler !== "spatial-bvh-v1") {
    throw new Error(`The Studio used ${mode.scheduler ?? "no"} scheduler, not the spatial index.`);
  }
  if (mode.priority !== priority) {
    throw new Error(`The Studio ordered demand by ${mode.priority}, not ${priority}.`);
  }
  await settle(3, 1_000, 600_000);

  const canvas = page.locator("#viewport");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The viewport canvas has no visible bounds.");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
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

  // The canvas alone is captured: a page screenshot also carries the panels,
  // whose text differs between runs and would dilute the pixel score.
  const capture = await canvas.screenshot({ type: "png", timeout: 120_000 });
  const screenshotName = `${name}.png`;
  await writeFile(resolve(outputDirectory, screenshotName), capture);
  const snapshot = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent ?? null;
    const memory = performance.memory;
    return {
      status: text("#status"),
      statusState: document.querySelector("#status")?.getAttribute("data-state"),
      triangleCount: text("#triangle-count"),
      edgeCount: text("#edge-count"),
      dataset: { ...document.documentElement.dataset },
      usedJsHeapBytes: memory ? memory.usedJSHeapSize : null,
    };
  });
  if (crashed) throw new Error(`The page crashed during the ${name} run.`);
  // The two chunk-id lists are hundreds of ids long; the record keeps the
  // demand count rather than the lists themselves.
  const { targetSchedulerOrder: _order, targetSchedulerDemand, ...dataset } = snapshot.dataset;
  const demandedChunkIds = (targetSchedulerDemand ?? "").split(",").filter((id) => id !== "");
  await context.close();
  return {
    name,
    priority,
    residencyMiB: budgetMiB,
    milestones,
    schedulerMode: mode.scheduler,
    targetChunkCount: Number(dataset.targetChunksTotal),
    demandedChunkCount: demandedChunkIds.length,
    residentChunkCount: Number(dataset.targetChunksReady),
    residentDecodedBytes: Number(dataset.residentDecodedBytes),
    residentGpuBytes: Number(dataset.residentGpuBytes),
    schedulerRequests: Number(dataset.targetSchedulerRequests),
    schedulerSkips: Number(dataset.targetSchedulerSkips ?? 0),
    targetRangeResponses,
    triangleCount: Number((snapshot.triangleCount ?? "").replaceAll(/[^0-9]/gu, "")),
    status: snapshot.status,
    statusState: snapshot.statusState,
    usedJsHeapBytes: snapshot.usedJsHeapBytes,
    dataset,
    consoleIssues,
    screenshot: {
      path: screenshotName,
      bytes: capture.byteLength,
      sha256: createHash("sha256").update(capture).digest("hex"),
    },
    capture,
  };
};

/**
 * Scores a budgeted render against the unbudgeted reference. Both images come
 * from the same canvas at the same pose, so a differing pixel is geometry the
 * budget kept out of the view, not a camera or layout difference.
 */
const comparePixels = async (page, reference, candidate) =>
  page.evaluate(
    async ([left, right]) => {
      const load = async (base64) => {
        const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        return createImageBitmap(new Blob([binary], { type: "image/png" }));
      };
      const pixels = (bitmap) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [first, second] = await Promise.all([load(left), load(right)]);
      if (first.width !== second.width || first.height !== second.height) {
        throw new Error("The two captures have different sizes.");
      }
      const before = pixels(first);
      const after = pixels(second);
      let differingPixels = 0;
      let channelSum = 0;
      for (let at = 0; at < before.length; at += 4) {
        const red = Math.abs(before[at] - after[at]);
        const green = Math.abs(before[at + 1] - after[at + 1]);
        const blue = Math.abs(before[at + 2] - after[at + 2]);
        // Eight levels of tolerance ignores blend and dither noise; a chunk
        // that is present in one render and missing in the other is opaque.
        if (red > 8 || green > 8 || blue > 8) differingPixels += 1;
        channelSum += red + green + blue;
      }
      const pixelCount = before.length / 4;
      return {
        width: first.width,
        height: first.height,
        pixelCount,
        differingPixels,
        agreementRatio: (pixelCount - differingPixels) / pixelCount,
        meanChannelDifference: channelSum / (pixelCount * 3),
      };
    },
    [reference.toString("base64"), candidate.toString("base64")],
  );

try {
  await vite.listen();
  const reference = await runPolicy("reference", "screen-distance", referenceResidencyMiB);
  console.log(
    `[demand-priority] reference: ${reference.residentChunkCount}/${reference.targetChunkCount} ` +
      `chunks, ${reference.triangleCount} triangles`,
  );
  const policies = [];
  for (const priority of ["screen-distance", "screen-coverage"]) {
    const run = await runPolicy(priority, priority, residencyMiB);
    console.log(
      `[demand-priority] ${priority}: ${run.residentChunkCount}/${run.targetChunkCount} chunks, ` +
        `${run.residentGpuBytes} GPU bytes, ${run.triangleCount} triangles`,
    );
    policies.push(run);
  }
  if (reference.residentChunkCount <= Math.max(...policies.map((run) => run.residentChunkCount))) {
    throw new Error("The reference budget did not admit more than the budgeted runs.");
  }
  if (policies.some((run) => run.residentGpuBytes > residencyMiB * 1024 * 1024)) {
    throw new Error("A budgeted run exceeded the residency budget it was given.");
  }

  const comparisonContext = await browser.newContext({ viewport });
  const comparisonPage = await comparisonContext.newPage();
  const scored = [];
  for (const run of policies) {
    const agreement = await comparePixels(comparisonPage, reference.capture, run.capture);
    console.log(
      `[demand-priority] ${run.priority}: ${agreement.differingPixels} pixels differ from the ` +
        `reference (${(agreement.agreementRatio * 100).toFixed(2)}% agreement)`,
    );
    scored.push({ ...run, agreementWithReference: agreement });
  }
  await comparisonContext.close();

  const consoleIssues = [reference, ...scored].flatMap((run) =>
    run.consoleIssues.map((issue) => ({ run: run.name, ...issue })),
  );
  if (consoleIssues.length > 0) {
    throw new Error(`The browser emitted issues: ${JSON.stringify(consoleIssues)}.`);
  }
  const [distance, coverage] = scored;
  const strip = ({ capture: _capture, consoleIssues: _issues, ...rest }) => rest;
  const evidence = {
    schemaVersion: "naru.demand-priority-evidence.1",
    capturedAt: new Date().toISOString(),
    mode: "headed-budget-bound-policy-comparison",
    browser: {
      id: "chrome",
      engine: "Blink",
      version: browser.version(),
      headless,
      viewport,
    },
    host: { platform: process.platform, architecture: process.arch },
    capture: { residencyMiB, referenceResidencyMiB, cameraMove: camera },
    source: {
      buildReport: relative(repositoryRoot, reportPath).replaceAll(sep, "/"),
      packageDigest: buildReport.output.packageDigest,
      resources: buildReport.output.resources,
      servedFrom: "Vite dev static hosting with HTTP Range support",
    },
    reference: strip(reference),
    policies: scored.map(strip),
    comparison: {
      residentChunkDelta: coverage.residentChunkCount - distance.residentChunkCount,
      triangleDelta: coverage.triangleCount - distance.triangleCount,
      differingPixelDelta:
        coverage.agreementWithReference.differingPixels -
        distance.agreementWithReference.differingPixels,
      agreementRatioDelta:
        coverage.agreementWithReference.agreementRatio -
        distance.agreementWithReference.agreementRatio,
    },
    consoleIssues,
  };
  await writeFile(
    resolve(outputDirectory, "demand-priority.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`[demand-priority] evidence: ${relative(repositoryRoot, outputDirectory)}`);
} finally {
  await browser.close();
  await vite.close();
}
