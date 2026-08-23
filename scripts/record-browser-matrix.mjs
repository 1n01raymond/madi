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
    let hierarchyFirst = false;
    let hierarchySearchBeforeGeometry = false;
    await page.route("**/scene.bin", async (route) => {
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
      brandMarkLoaded: await page.locator("#madi-brand-mark").evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
      faviconLoaded: await page.evaluate(async () => {
        const favicon = document.querySelector("#madi-favicon");
        if (!(favicon instanceof HTMLLinkElement) || !favicon.href) return false;
        const response = await fetch(favicon.href);
        const source = await response.text();
        return response.ok && source.includes("<svg") && source.includes("MADI");
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
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.6),
        y: Math.round(canvasBounds.height * 0.35),
      },
    });
    await page.locator("#selection").filter({ hasText: expected.selection }).waitFor({
      timeout: 5_000,
    });
    observed.selection = await page.locator("#selection").innerText();
    assertEqual(observed.selection, expected.selection, `${definition.id} selection`);

    await page.locator("#toggle-section").click();
    assertEqual(
      await page.locator("html").getAttribute("data-section-enabled"),
      "true",
      `${definition.id} section enabled`,
    );
    const sectionPosition = page.locator("#section-position");
    await sectionPosition.fill("0");
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.6),
        y: Math.round(canvasBounds.height * 0.35),
      },
    });
    await page.locator("#selection").filter({ hasText: "No occurrence at that pixel." }).waitFor({
      timeout: 5_000,
    });
    await sectionPosition.fill("100");
    await canvas.click({
      position: {
        x: Math.round(canvasBounds.width * 0.6),
        y: Math.round(canvasBounds.height * 0.35),
      },
    });
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
    schemaVersion: "phase-1-browser-matrix.1",
    capturedAt: new Date().toISOString(),
    source: {
      fixture: "fixtures/step/adafruit-pygamer.step",
      sceneIr: "generated locally; not committed (80.6 MB JSON evidence)",
      occtReport: "artifacts/occt/adafruit-pygamer.report.json",
      gltf: "artifacts/phase1/adafruit-pygamer/scene.gltf",
      binary: "artifacts/phase1/adafruit-pygamer/scene.bin",
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
