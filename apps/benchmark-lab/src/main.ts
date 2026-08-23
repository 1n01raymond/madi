import "./style.css";

import { createBenchmarkBackend } from "./backend.js";
import type { BenchmarkBackendId, BenchmarkCullingMode } from "./backend.js";
import { createBenchmarkCamera } from "./camera.js";
import type { BenchmarkCameraTrace } from "./camera.js";
import {
  createIndustrialWorkload,
  industrialScaleTiers,
} from "./workload.js";
import type { IndustrialScaleTier, IndustrialWorkloadProfile } from "./workload.js";

interface Distribution {
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly worstMs: number;
}

interface BenchmarkResult {
  readonly schemaVersion: "madi.industrial-browser-benchmark.2";
  readonly backend: BenchmarkBackendId;
  readonly scale: IndustrialScaleTier;
  readonly profile: IndustrialWorkloadProfile;
  readonly features: {
    readonly surfaces: true;
    readonly explicitEdges: false;
    readonly picking: "on-demand-not-sampled";
    readonly frustumCulling: BenchmarkCullingMode;
    readonly lod: false;
    readonly cameraTrace: BenchmarkCameraTrace;
  };
  readonly workload: ReturnType<typeof createIndustrialWorkload>["stats"] & {
    readonly id: string;
  };
  readonly config: { readonly warmupFrames: number; readonly sampleFrames: number };
  readonly milestones: {
    readonly workloadReadyMs: number;
    readonly backendReadyMs: number;
    readonly firstFrameMs: number;
  };
  readonly frameIntervals: Distribution;
  readonly cpuSubmit: Distribution;
  readonly renderer: ReturnType<Awaited<ReturnType<typeof createBenchmarkBackend>>["stats"]>;
  readonly memory: {
    readonly usedJsHeapBytes: number | null;
    readonly userAgentSpecificBytes: number | null;
    readonly measurementScope: "diagnostic-not-retained-scene-memory";
  };
}

declare global {
  interface Window {
    __MADI_BENCHMARK_RESULT__?: BenchmarkResult;
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new TypeError(`Missing required element ${selector}.`);
  return element;
}

function summarize(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number) => {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  };
  return {
    samples: sorted.length,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    worstMs: sorted.at(-1) ?? 0,
  };
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1_000) {
    throw new RangeError("Frame counts must be integers between 1 and 1000.");
  }
  return parsed;
}

function getHeapBytes(): number | null {
  const memory = (
    performance as Performance & { memory?: { readonly usedJSHeapSize?: number } }
  ).memory;
  return Number.isFinite(memory?.usedJSHeapSize) ? (memory?.usedJSHeapSize ?? null) : null;
}

async function getUserAgentSpecificMemory(): Promise<number | null> {
  const measurement = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ readonly bytes: number }>;
  };
  if (!measurement.measureUserAgentSpecificMemory) return null;
  try {
    const result = await measurement.measureUserAgentSpecificMemory();
    return Number.isFinite(result.bytes) ? result.bytes : null;
  } catch {
    return null;
  }
}

const parameters = new URLSearchParams(location.search);
const backend = (parameters.get("backend") ?? "madi") as BenchmarkBackendId;
const scale = (parameters.get("scale") ?? "smoke") as IndustrialScaleTier;
const profile = (parameters.get("profile") ?? "repeated") as IndustrialWorkloadProfile;
const culling = (
  parameters.get("culling") ?? (profile === "heterogeneous" ? "frustum" : "disabled")
) as BenchmarkCullingMode;
if (backend !== "madi" && backend !== "three") throw new TypeError("Unknown backend.");
if (!(scale in industrialScaleTiers)) throw new TypeError("Unknown scale tier.");
if (profile !== "repeated" && profile !== "heterogeneous") {
  throw new TypeError("Unknown workload profile.");
}
if (culling !== "disabled" && culling !== "frustum") throw new TypeError("Unknown culling mode.");
const cameraTrace: BenchmarkCameraTrace = culling === "frustum" ? "local-review" : "overview-orbit";
const warmupFrames = parsePositiveInteger(parameters.get("warmup"), 30);
const sampleFrames = parsePositiveInteger(parameters.get("frames"), 120);

const status = requiredElement<HTMLElement>("#status");
const resultNode = requiredElement<HTMLElement>("#result");
const canvas = requiredElement<HTMLCanvasElement>("#viewport");
requiredElement<HTMLElement>("#backend").textContent = backend;
requiredElement<HTMLElement>("#scale").textContent = scale;
requiredElement<HTMLElement>("#profile").textContent = profile;
requiredElement<HTMLElement>("#culling").textContent = culling;

async function run(): Promise<void> {
  const started = performance.now();
  status.textContent = "Generating deterministic plant workload…";
  const workload = createIndustrialWorkload(scale, profile);
  const workloadReadyMs = performance.now() - started;
  requiredElement<HTMLElement>("#occurrences").textContent =
    workload.stats.occurrenceCount.toLocaleString("en-US");
  requiredElement<HTMLElement>("#triangles").textContent =
    workload.stats.submittedTriangleCount.toLocaleString("en-US");

  status.textContent = `Initializing ${backend} backend…`;
  const renderer = await createBenchmarkBackend(backend, canvas, workload, culling);
  const backendReadyMs = performance.now() - started;
  try {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const initialCamera = createBenchmarkCamera(workload.bounds, aspect, 0, cameraTrace);
    await renderer.render(initialCamera);
    const firstFrameMs = performance.now() - started;
    status.textContent = `Warming ${warmupFrames} frames…`;
    for (let frame = 0; frame < warmupFrames; frame += 1) {
      await nextAnimationFrame();
      await renderer.render(
        createBenchmarkCamera(workload.bounds, aspect, frame / warmupFrames, cameraTrace),
      );
    }

    status.textContent = `Sampling ${sampleFrames} frames…`;
    const frameIntervals: number[] = [];
    const cpuSubmit: number[] = [];
    let previousTimestamp: number | undefined;
    for (let frame = 0; frame < sampleFrames; frame += 1) {
      const timestamp = await nextAnimationFrame();
      if (previousTimestamp !== undefined) frameIntervals.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
      const submitStart = performance.now();
      await renderer.render(
        createBenchmarkCamera(workload.bounds, aspect, frame / sampleFrames, cameraTrace),
      );
      cpuSubmit.push(performance.now() - submitStart);
    }
    await renderer.render(createBenchmarkCamera(workload.bounds, aspect, 0.125, cameraTrace));
    const userAgentSpecificBytes = await getUserAgentSpecificMemory();

    const result: BenchmarkResult = {
      schemaVersion: "madi.industrial-browser-benchmark.2",
      backend,
      scale,
      profile,
      features: {
        surfaces: true,
        explicitEdges: false,
        picking: "on-demand-not-sampled",
        frustumCulling: culling,
        lod: false,
        cameraTrace,
      },
      workload: { id: workload.id, ...workload.stats },
      config: { warmupFrames, sampleFrames },
      milestones: { workloadReadyMs, backendReadyMs, firstFrameMs },
      frameIntervals: summarize(frameIntervals),
      cpuSubmit: summarize(cpuSubmit),
      renderer: renderer.stats(),
      memory: {
        usedJsHeapBytes: getHeapBytes(),
        userAgentSpecificBytes,
        measurementScope: "diagnostic-not-retained-scene-memory",
      },
    };
    window.__MADI_BENCHMARK_RESULT__ = result;
    document.documentElement.dataset.benchmarkStatus = "complete";
    status.textContent = "Exploratory run complete — not an ADR decision";
    status.dataset.state = "ready";
    resultNode.textContent = JSON.stringify(result, null, 2);
  } finally {
    window.addEventListener("pagehide", () => renderer.dispose(), { once: true });
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.benchmarkStatus = "error";
  status.dataset.state = "error";
  status.textContent = message;
  console.error(error);
});
