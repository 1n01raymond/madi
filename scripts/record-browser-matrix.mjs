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
const operatingSystem =
  { win32: "windows", darwin: "macos", linux: "linux" }[process.platform] ??
  process.platform;
const viewport = { width: 1320, height: 1000 };
const url = "http://127.0.0.1:4173/";
const expected = {
  status: "OCCT Scene IR ready · 3 geometry prototypes · 10 part occurrences",
  selection: "Selected center-rail · ID 2 · 12 OCCT edge refs",
  prototypeCount: "3",
  occurrenceCount: "10",
  triangleCount: "2,076",
  edgeCount: "181",
  sourceFormat: "AP214",
};
const report = JSON.parse(
  await readFile(resolve(repositoryRoot, "artifacts/occt/repeated-fasteners.report.json"), "utf8"),
);

function assertEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) {
    throw new Error(`${label}: expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actual)}.`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("#status[data-state='ready']").waitFor({ timeout: 15_000 });

    const observed = {
      status: await page.locator("#status").innerText(),
      prototypeCount: await page.locator("#prototype-count").innerText(),
      occurrenceCount: await page.locator("#occurrence-count").innerText(),
      triangleCount: await page.locator("#triangle-count").innerText(),
      edgeCount: await page.locator("#edge-count").innerText(),
      sourceFormat: await page.locator("#source-format").innerText(),
    };
    for (const [label, expectedValue] of Object.entries(expected)) {
      if (label === "selection") continue;
      assertEqual(observed[label], expectedValue, `${definition.id} ${label}`);
    }

    const canvas = page.locator("#viewport");
    const canvasBounds = await canvas.boundingBox();
    if (!canvasBounds) throw new Error(`${definition.id} canvas has no visible bounds.`);
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.593),
        y: Math.round(canvasBounds.height * 0.49),
      },
    });
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });
    observed.selection = await page.locator("#selection").innerText();
    assertEqual(observed.selection, expected.selection, `${definition.id} selection`);

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
  for (const definition of [
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
  ]) {
    results.push(await recordBrowser(definition));
  }

  const evidence = {
    schemaVersion: "phase-0-browser-matrix.1",
    capturedAt: new Date().toISOString(),
    source: {
      fixture: report.source.path,
      sha256: report.source.sha256,
      sceneIr: "artifacts/occt/repeated-fasteners.scene.json",
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
