import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox } from "playwright";
import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new TypeError(`${name} requires a value.`);
  return value;
}

const outputArgument = argument("--output", "output/playwright/industrial-benchmark");
const scale = argument("--scale", "gate");
const profile = argument("--profile", "repeated");
const culling = argument("--culling", profile === "heterogeneous" ? "frustum" : "disabled");
const frames = Number(argument("--frames", "90"));
const warmup = Number(argument("--warmup", "30"));
if (!new Set(["smoke", "gate", "target"]).has(scale)) {
  throw new TypeError("--scale must be smoke, gate, or target.");
}
if (!new Set(["repeated", "heterogeneous"]).has(profile)) {
  throw new TypeError("--profile must be repeated or heterogeneous.");
}
if (!new Set(["disabled", "frustum"]).has(culling)) {
  throw new TypeError("--culling must be disabled or frustum.");
}
if (!Number.isInteger(frames) || frames <= 0 || !Number.isInteger(warmup) || warmup <= 0) {
  throw new TypeError("--frames and --warmup must be positive integers.");
}

const outputDirectory = resolve(repositoryRoot, outputArgument);
const outputFromRoot = relative(repositoryRoot, outputDirectory);
if (
  outputFromRoot === "" ||
  outputFromRoot === ".." ||
  outputFromRoot.startsWith(`..${sep}`) ||
  isAbsolute(outputFromRoot)
) {
  throw new TypeError("Benchmark output must remain inside the repository.");
}

const headless = process.argv.includes("--headless");
const operatingSystem =
  { win32: "windows", darwin: "macos", linux: "linux" }[process.platform] ??
  process.platform;
const viewport = { width: 1440, height: 960 };
const url = "http://127.0.0.1:4174/";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function record(definition, backend) {
  const browser = await definition.launch();
  try {
    const browserVersion = browser.version();
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleIssues = [];
    const outboundRequests = [];
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (
        (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
        requestUrl.hostname !== "127.0.0.1"
      ) {
        outboundRequests.push(request.url());
      }
    });
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      consoleIssues.push({ level: "pageerror", message: error.message });
    });
    const query = new URLSearchParams({
      backend,
      scale,
      frames: String(frames),
      warmup: String(warmup),
      profile,
      culling,
    });
    await page.goto(`${url}?${query}`, { waitUntil: "domcontentloaded" });
    await page.locator("#status[data-state='ready']").waitFor({ timeout: 120_000 });
    const result = await page.evaluate(() => window.__MADI_BENCHMARK_RESULT__);
    if (!result) throw new Error(`${definition.id}/${backend} did not publish a result.`);
    if (
      result.backend !== backend ||
      result.scale !== scale ||
      result.profile !== profile ||
      result.features.frustumCulling !== culling
    ) {
      throw new Error(`${definition.id}/${backend} published mismatched metadata.`);
    }
    if (consoleIssues.length > 0) {
      throw new Error(
        `${definition.id}/${backend} emitted browser issues: ${JSON.stringify(consoleIssues)}.`,
      );
    }
    if (outboundRequests.length > 0) {
      throw new Error(
        `${definition.id}/${backend} made outbound requests: ${JSON.stringify(outboundRequests)}.`,
      );
    }

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
      throw new Error(`${definition.id}/${backend} did not expose a WebGPU adapter.`);
    }

    const browserMajor = browserVersion.split(".")[0];
    const screenshotName = `${definition.id}-${browserMajor}-${backend}-${scale}-${profile}-${culling}-${operatingSystem}.png`;
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
      consoleIssues,
      outboundRequests,
      result,
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
  configFile: resolve(repositoryRoot, "apps/benchmark-lab/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/benchmark-lab"),
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
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
    for (const backend of ["madi", "three"]) {
      const recorded = await record(definition, backend);
      results.push(recorded);
      console.log(
        `[industrial-benchmark] ${definition.id}/${backend}: ` +
          `${recorded.result.cpuSubmit.p95Ms.toFixed(3)} ms CPU submit p95, ` +
          `${recorded.result.frameIntervals.p95Ms.toFixed(3)} ms frame p95`,
      );
    }
  }

  const evidence = {
    schemaVersion: "madi.industrial-browser-matrix.2",
    status: "exploratory-not-adr-decision",
    capturedAt: new Date().toISOString(),
    host: { platform: process.platform, architecture: process.arch },
    config: { scale, profile, culling, frames, warmup },
    comparisonContract: {
      sameWorkload: true,
      sameCameraTrace: true,
      sameResolution: true,
      surfaces: true,
      explicitEdges: false,
      picking: "on-demand-not-sampled",
      frustumCulling: culling,
      cameraTrace: culling === "frustum" ? "local-review" : "overview-orbit",
      lod: false,
      selfHostedStaticOrigin: true,
      outboundRequestCount: 0,
    },
    results,
    notes: [
      "This run validates parity and measurement plumbing; it does not accept or reject ADR-0003.",
      "Absolute performance varies by host load. Decision runs require reference hardware and repeated clean sessions.",
      culling === "frustum"
        ? "MADI uses dense CPU sphere culling and instance compaction; Three.js uses BatchedMesh per-object culling with its default opaque sorting."
        : "Both paths disable frustum culling.",
    ],
  };
  await writeFile(
    resolve(outputDirectory, "industrial-benchmark.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(`[industrial-benchmark] evidence: ${outputDirectory}`);
} finally {
  await vite.close();
}
