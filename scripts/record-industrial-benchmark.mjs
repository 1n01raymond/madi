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
const repeats = Number(argument("--repeats", "1"));
const memory = argument("--memory", repeats > 1 ? "scene-delta" : "final");
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
if (!Number.isInteger(repeats) || repeats <= 0 || repeats > 10) {
  throw new TypeError("--repeats must be an integer between 1 and 10.");
}
if (!new Set(["final", "scene-delta"]).has(memory)) {
  throw new TypeError("--memory must be final or scene-delta.");
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

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      samples: 0,
      median: null,
      min: null,
      max: null,
      mean: null,
      standardDeviation: null,
    };
  }
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance = sorted.reduce((total, value) => total + (value - mean) ** 2, 0) /
    Math.max(1, sorted.length - 1);
  return {
    samples: sorted.length,
    median: percentile(0.5),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    mean,
    standardDeviation: Math.sqrt(variance),
  };
}

function aggregateResults(results) {
  const byPath = [];
  for (const browser of ["chrome", "firefox"]) {
    for (const backend of ["madi", "three"]) {
      const entries = results.filter(
        (entry) => entry.browser === browser && entry.result.backend === backend,
      );
      const gpuTiming = entries.filter(
        (entry) => entry.result.gpuFrameTiming?.supported === true,
      );
      byPath.push({
        browser,
        backend,
        runs: entries.length,
        cpuSubmitP95Ms: summarize(entries.map((entry) => entry.result.cpuSubmit.p95Ms)),
        frameIntervalP95Ms: summarize(
          entries.map((entry) => entry.result.frameIntervals.p95Ms),
        ),
        sceneActivationDeltaBytes: summarize(
          entries
            .map((entry) => entry.result.memory.sceneActivationDeltaBytes)
            .filter((value) => Number.isFinite(value)),
        ),
        gpuFrameP95Ms: summarize(
          gpuTiming.map((entry) => entry.result.gpuFrameTiming.frameMs.p95Ms),
        ),
        retainedResourceBytes: {
          cpuBytes: summarize(entries.map((entry) => entry.result.retainedResources.cpuBytes)),
          gpuBytes: summarize(entries.map((entry) => entry.result.retainedResources.gpuBytes)),
        },
      });
    }
  }

  const pairedComparisons = [];
  for (const browser of ["chrome", "firefox"]) {
    const cpuP95ReductionPercent = [];
    const frameP95RegressionPercent = [];
    const sceneDeltaReductionPercent = [];
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const madi = results.find(
        (entry) => entry.browser === browser && entry.result.backend === "madi" && entry.repeat === repeat,
      );
      const three = results.find(
        (entry) => entry.browser === browser && entry.result.backend === "three" && entry.repeat === repeat,
      );
      if (!madi || !three) continue;
      cpuP95ReductionPercent.push(
        ((three.result.cpuSubmit.p95Ms - madi.result.cpuSubmit.p95Ms) /
          three.result.cpuSubmit.p95Ms) * 100,
      );
      frameP95RegressionPercent.push(
        ((madi.result.frameIntervals.p95Ms - three.result.frameIntervals.p95Ms) /
          three.result.frameIntervals.p95Ms) * 100,
      );
      const madiMemory = madi.result.memory.sceneActivationDeltaBytes;
      const threeMemory = three.result.memory.sceneActivationDeltaBytes;
      if (Number.isFinite(madiMemory) && Number.isFinite(threeMemory) && threeMemory > 0) {
        sceneDeltaReductionPercent.push(((threeMemory - madiMemory) / threeMemory) * 100);
      }
    }
    pairedComparisons.push({
      browser,
      pairs: cpuP95ReductionPercent.length,
      cpuP95ReductionPercent: summarize(cpuP95ReductionPercent),
      frameP95RegressionPercent: summarize(frameP95RegressionPercent),
      sceneDeltaReductionPercent: summarize(sceneDeltaReductionPercent),
      continueThresholdCounts: {
        cpuP95AtLeast25Percent: cpuP95ReductionPercent.filter((value) => value >= 25).length,
        frameP95NoMoreThan10PercentWorse: frameP95RegressionPercent.filter(
          (value) => value <= 10,
        ).length,
        sceneDeltaAtLeast30Percent: sceneDeltaReductionPercent.filter(
          (value) => value >= 30,
        ).length,
      },
    });
  }
  return { byPath, pairedComparisons };
}

async function record(definition, backend, repeat, captureScreenshot) {
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
      memory,
    });
    await page.goto(`${url}?${query}`, { waitUntil: "domcontentloaded" });
    await page.locator("#status[data-state='ready']").waitFor({ timeout: 120_000 });
    const result = await page.evaluate(() => window.__MADI_BENCHMARK_RESULT__);
    if (!result) throw new Error(`${definition.id}/${backend} did not publish a result.`);
    if (
      result.backend !== backend ||
      result.scale !== scale ||
      result.profile !== profile ||
      result.features.frustumCulling !== culling ||
      result.config.memoryMode !== memory
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
    let screenshotRecord = null;
    if (captureScreenshot) {
      const screenshotName = `${definition.id}-${browserMajor}-${backend}-${scale}-${profile}-${culling}-${operatingSystem}.png`;
      const screenshot = await page.screenshot({ fullPage: true, type: "png" });
      await writeFile(resolve(outputDirectory, screenshotName), screenshot);
      screenshotRecord = {
        path: screenshotName,
        bytes: screenshot.byteLength,
        sha256: sha256(screenshot),
      };
    }

    return {
      repeat,
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
      screenshot: screenshotRecord,
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
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const backendOrder = repeat % 2 === 1 ? ["madi", "three"] : ["three", "madi"];
      for (const backend of backendOrder) {
        const recorded = await record(definition, backend, repeat, repeat === 1);
        results.push(recorded);
        const gpuP95 = recorded.result.gpuFrameTiming?.supported
          ? recorded.result.gpuFrameTiming.frameMs.p95Ms
          : null;
        console.log(
          `[industrial-benchmark] ${definition.id}/${backend} repeat ${repeat}/${repeats}: ` +
            `${recorded.result.cpuSubmit.p95Ms.toFixed(3)} ms CPU submit p95, ` +
            `${recorded.result.frameIntervals.p95Ms.toFixed(3)} ms frame p95` +
            (gpuP95 === null ? "" : `, ${gpuP95.toFixed(3)} ms GPU pass p95`),
        );
      }
    }
  }

  const evidence = {
    schemaVersion: "madi.industrial-browser-matrix.4",
    status: "exploratory-not-adr-decision",
    capturedAt: new Date().toISOString(),
    host: { platform: process.platform, architecture: process.arch },
    config: { scale, profile, culling, frames, warmup, repeats, memory },
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
      freshBrowserProcessPerRun: true,
      alternatingBackendOrder: repeats > 1,
      sceneMemoryDelta: memory === "scene-delta",
      gpuTimestamps: "madi-surface-pass-only",
      retainedResourceCensus: true,
    },
    results,
    aggregates: aggregateResults(results),
    notes: [
      "This run validates parity and measurement plumbing; it does not accept or reject ADR-0003.",
      "Absolute performance varies by host load. Decision runs require reference hardware and repeated clean sessions.",
      culling === "frustum"
        ? "MADI uses dense CPU sphere culling and instance compaction; Three.js uses BatchedMesh per-object culling with its default opaque sorting."
        : "Both paths disable frustum culling.",
      repeats > 1
        ? "Each repeat launches a fresh browser process and alternates backend order."
        : "This matrix contains one run per browser/backend path.",
      memory === "scene-delta"
        ? "Scene activation delta is measured from a backend-ready shell with the shared workload retained to the first rendered frame; it remains browser-wide diagnostic memory, not an allocator census."
        : "Only final whole-page memory is sampled.",
      "GPU pass timestamps instrument only the MADI surface pass through WebGPU timestamp-query; the Three.js WebGPURenderer path reports them as unsupported because its command encoding is not caller-instrumentable.",
      "The retained-resource census counts backend-owned scene upload memory. MADI reports exact GPUBuffer allocations; the Three.js figure is a constructed floor because its internal buffers, sort structures, uniforms, and render targets are not enumerable.",
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
