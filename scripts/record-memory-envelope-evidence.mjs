// Records a whole-process memory envelope for the sixty5 IFC federation.
//
// The residency budget bounds one category of memory -- decoded target geometry
// and its GPU buffers. It says nothing about the document, the sidecars, the
// renderer's own allocations, the JavaScript heap, or the browser process tree.
// This record measures all of them at six phases of a session, states who owns
// each byte, how long it lives, and how it was collected, and repeats the whole
// pass under a forced-low residency budget.
//
// Timing here is NOT comparable to artifacts/ifc/sixty5-first-frame: sampling
// performance.measureUserAgentSpecificMemory() forces a garbage collection and
// blocks for seconds at every phase. Milestones are recorded so a reader can
// see the order of events, and are marked as perturbed.
//
//   pnpm memory:envelope:evidence
//   node scripts/record-memory-envelope-evidence.mjs \
//     [--scene-dir output/ifc/sixty5-prb] \
//     [--report artifacts/ifc/sixty5/build-report.json] \
//     [--output artifacts/memory/sixty5-envelope] \
//     [--runs 3] [--low-residency-mib 8] [--headless]
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";
import { createServer } from "vite";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const sceneDirectory = resolve(repositoryRoot, argValue("--scene-dir", "output/ifc/sixty5-prb"));
const reportPath = resolve(
  repositoryRoot,
  argValue("--report", "artifacts/ifc/sixty5/build-report.json"),
);
const outputDirectory = resolve(
  repositoryRoot,
  argValue("--output", "artifacts/memory/sixty5-envelope"),
);
const outputFromRoot = relative(repositoryRoot, outputDirectory);
if (
  outputFromRoot === "" ||
  outputFromRoot === ".." ||
  outputFromRoot.startsWith(`..${sep}`) ||
  isAbsolute(outputFromRoot)
) {
  throw new TypeError("Memory envelope output must remain inside the repository.");
}
const headless = process.argv.includes("--headless");
const runsPerProfile = Number(argValue("--runs", "3"));
if (!Number.isInteger(runsPerProfile) || runsPerProfile < 1 || runsPerProfile > 10) {
  throw new TypeError("--runs must be a whole number between 1 and 10.");
}
const lowResidencyMiB = Number(argValue("--low-residency-mib", "8"));
if (!Number.isInteger(lowResidencyMiB) || lowResidencyMiB < 4 || lowResidencyMiB > 1024) {
  throw new TypeError("--low-residency-mib must be a whole number between 4 and 1024.");
}
if (process.platform !== "win32") {
  throw new Error(
    "Process-tree sampling in this recorder is implemented for Windows only; " +
      "extend sampleProcessTree before recording on another host.",
  );
}

const viewport = { width: 1320, height: 1000 };
const defaultBudgetBytes = 64 * 1024 * 1024;
const lowBudgetBytes = lowResidencyMiB * 1024 * 1024;
const phases = ["hierarchy", "coarse-frame", "budget-limited", "navigation", "selection", "eviction"];
const camera = { wheelDelta: -5000, panX: 400, panY: -300 };

// Predeclared before any run, so a recorded number cannot become its own target.
const declaredTargets = [
  {
    id: "residency-decoded-within-budget",
    statement: "Decoded target residency never exceeds the configured budget, in either profile.",
    applies: "every phase of every run",
    metric: "residency.decodedBytes <= residency.budgetBytes",
  },
  {
    id: "residency-gpu-within-budget",
    statement: "GPU target residency never exceeds the configured budget, in either profile.",
    applies: "every phase of every run",
    metric: "residency.gpuBytes <= residency.budgetBytes",
  },
  {
    id: "process-working-set-ceiling",
    statement: "The browser process tree stays below 4 GiB while a 657 MB package is open.",
    applies: "every phase of every run",
    metric: "process.workingSetBytes <= 4294967296",
    ceilingBytes: 4 * 1024 * 1024 * 1024,
  },
  {
    id: "js-heap-ceiling",
    statement: "The main-thread JavaScript heap stays below 2 GiB.",
    applies: "every phase of every run",
    metric: "page.usedJsHeapBytes <= 2147483648",
    ceilingBytes: 2 * 1024 * 1024 * 1024,
  },
  {
    id: "forced-low-remains-usable",
    statement:
      "Under the forced-low budget the hierarchy and a coarse frame still appear, and a " +
      "source-aware selection still resolves; full target residency is not required.",
    applies: `the forced-low profile (${lowResidencyMiB} MiB)`,
    metric: "phases hierarchy and coarse-frame reached, selection resolves property entries",
  },
];

// Every byte this record reports belongs to exactly one of these categories.
const ledgerCategories = [
  {
    id: "package.documentBytes",
    owner: "compiled glTF document, held by the main thread and the geometry Worker",
    lifetime: "whole session; the Worker keeps the parsed document until the scene closes",
    method: "exact-declared",
    partOf: null,
    note: "Transferred byte length. What the parsed form costs in the heap is a different, engine-owned number; see page.uaMemoryBytes.",
  },
  {
    id: "package.propertyIndexBytes",
    owner: "property sidecar index document (properties.json), fetched on the first selection",
    lifetime: "from the first selection to the end of the session",
    method: "exact-declared",
    partOf: null,
    note: "The index only. Property values live in properties.bin, which is read by range per selection and not retained; those bytes appear in page.uaMemoryBytes while a selection holds them, never here.",
  },
  {
    id: "package.spatialIndexBytes",
    owner: "spatial demand index, when the package carries one",
    lifetime: "whole session",
    method: "exact-declared",
    partOf: null,
    note: "Zero means the package has no spatial index, not that the index is free.",
  },
  {
    id: "package.declaredGeometryBytes",
    owner: "target geometry declared by the document",
    lifetime: "never resident as a whole",
    method: "exact-declared",
    partOf: null,
    note: "Bounds the Range requests, not the memory: only admitted chunks are ever decoded.",
  },
  {
    id: "residency.budgetBytes",
    owner: "ProgressiveResidency, configured by ?residencyMiB",
    lifetime: "whole session",
    method: "exact-declared",
    partOf: null,
    note: "The only memory figure in the Studio that is a policy rather than a measurement.",
  },
  {
    id: "residency.decodedBytes",
    owner: "decoded target geometry arrays held by ProgressiveResidency",
    lifetime: "until eviction",
    method: "exact-counted",
    partOf: "page.uaMemoryBytes",
    note: "Counts each shared vertex pool once, as the admission cost formula does.",
  },
  {
    id: "residency.gpuBytes",
    owner: "GPU buffers charged to admitted target chunks",
    lifetime: "until eviction",
    method: "exact-counted",
    partOf: "renderer.gpuBufferBytes",
    note: "Target detail only. Coarse batches and the camera uniform are outside this charge, which is why the renderer total is larger.",
  },
  {
    id: "renderer.gpuVertexPoolBytes",
    owner: "one GPUBuffer per shared prototype vertex pool",
    lifetime: "until the last batch referencing the pool is released",
    method: "exact-counted",
    partOf: "renderer.gpuBufferBytes",
    note: "Counted once per pool. Summing per batch would report allocations that were never made.",
  },
  {
    id: "renderer.gpuBatchBufferBytes",
    owner: "per-batch index, edge, and instance GPUBuffers",
    lifetime: "until the batch is released",
    method: "exact-counted",
    partOf: "renderer.gpuBufferBytes",
  },
  {
    id: "renderer.gpuUniformBytes",
    owner: "the camera uniform buffer",
    lifetime: "whole session",
    method: "exact-counted",
    partOf: "renderer.gpuBufferBytes",
  },
  {
    id: "renderer.gpuBufferBytes",
    owner: "the renderer's GPUBuffer allocations",
    lifetime: "mixed; see the three categories it contains",
    method: "exact-counted",
    partOf: null,
    includes: [
      "renderer.gpuVertexPoolBytes",
      "renderer.gpuBatchBufferBytes",
      "renderer.gpuUniformBytes",
    ],
  },
  {
    id: "renderer.gpuAttachmentBytes",
    owner: "the depth and object-id render attachments",
    lifetime: "until the canvas is resized",
    method: "upper-bound",
    partOf: null,
    note: "depth24plus storage is implementation-defined, so the wider 4-byte layout is charged. Deliberately outside renderer.gpuBufferBytes: a texture is not a buffer allocation.",
  },
  {
    id: "renderer.cpuStagingBytes",
    owner: "per-batch instance staging arrays on the JavaScript heap",
    lifetime: "until the batch is released",
    method: "exact-counted",
    partOf: "page.usedJsHeapBytes",
  },
  {
    id: "page.usedJsHeapBytes",
    owner: "the main-thread V8 isolate",
    lifetime: "sampled",
    method: "browser-estimated",
    partOf: null,
    note: "performance.memory with --enable-precise-memory-info. Excludes the geometry Worker's isolate entirely.",
  },
  {
    id: "page.uaMemoryBytes",
    owner: "the whole agent cluster, including dedicated workers",
    lifetime: "sampled",
    method: "browser-estimated",
    partOf: "process.workingSetBytes",
    note: "performance.measureUserAgentSpecificMemory(). Requires cross-origin isolation, forces a collection, and blocks for seconds -- which is why this record's timings are marked perturbed.",
  },
  {
    id: "process.workingSetBytes",
    owner: "the headed browser process tree (browser, renderer, GPU, utility)",
    lifetime: "sampled",
    method: "os-sampled",
    partOf: null,
    note: "Win32_Process WorkingSetSize summed over the tree rooted at the launched browser. Includes pages shared with other processes, so it is not additive across trees.",
  },
  {
    id: "process.privateBytes",
    owner: "the same process tree",
    lifetime: "sampled",
    method: "os-sampled",
    partOf: null,
    note:
      "Win32_Process PrivatePageCount, which this API reports in bytes: private committed "
      + "pages, excluding pages shared with other processes. A committed page need not be "
      + "resident, so this figure runs well above process.workingSetBytes and is not a "
      + "claim about how much RAM the browser holds.",
  },
  {
    id: "gpu.driverAllocationBytes",
    owner: "the graphics driver's device-side allocations",
    lifetime: "unknown",
    method: "unsupported",
    partOf: null,
    value: null,
    note: "No browser or operating-system interface available to page or host script reports what the WebGPU driver allocated on the device. Recorded as unavailable, never as zero; renderer.gpu* are the requested sizes, not the driver's.",
  },
];

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

// Bind the record to a verified package: the served bytes must be the ones the
// build report describes.
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
  `[memory] package ${buildReport.output.packageDigest.slice(0, 12)} verified against ` +
    relative(repositoryRoot, reportPath),
);

/** Sums Win32_Process figures over the tree rooted at a launched browser. */
async function sampleProcessTree(rootPid) {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
      "Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount | " +
      "ConvertTo-Json -Compress",
  ], { maxBuffer: 8 * 1024 * 1024 });
  const listed = JSON.parse(stdout);
  const all = Array.isArray(listed) ? listed : [listed];
  const childrenByParent = new Map();
  for (const entry of all) {
    const siblings = childrenByParent.get(entry.ParentProcessId);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(entry.ParentProcessId, [entry]);
  }
  const tree = [];
  const root = all.find((entry) => entry.ProcessId === rootPid);
  if (root) tree.push(root);
  const queue = [rootPid];
  const visited = new Set();
  while (queue.length > 0) {
    const pid = queue.pop();
    if (visited.has(pid)) continue;
    visited.add(pid);
    for (const child of childrenByParent.get(pid) ?? []) {
      tree.push(child);
      queue.push(child.ProcessId);
    }
  }
  if (tree.length === 0) {
    return { rootPid, processCount: 0, workingSetBytes: null, privateBytes: null,
      unavailableReason: "The launched browser process was no longer listed when sampled." };
  }
  return {
    rootPid,
    processCount: tree.length,
    // Other Chrome instances on the host are excluded by walking from the root
    // pid; this figure covers the launched tree only.
    chromeProcessesOnHost: all.length,
    workingSetBytes: tree.reduce((total, entry) => total + entry.WorkingSetSize, 0),
    privateBytes: tree.reduce((total, entry) => total + entry.PrivatePageCount, 0),
  };
}

/** Reads the page's own ledger plus both browser-estimated heap figures. */
async function samplePage(page) {
  return page.evaluate(async () => {
    const dataset = document.documentElement.dataset;
    const number = (value) => (value === undefined ? null : Number(value));
    const status = document.querySelector("#status");
    const memory = performance.memory;
    const sample = {
      statusText: status?.textContent ?? null,
      statusState: status?.getAttribute("data-state") ?? null,
      statusStage: status?.getAttribute("data-stage") ?? null,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      package: {
        documentBytes: number(dataset.packageDocumentBytes),
        propertyIndexBytes: number(dataset.packagePropertyIndexBytes),
        spatialIndexBytes: number(dataset.packageSpatialIndexBytes),
        declaredGeometryBytes: number(dataset.packageDeclaredGeometryBytes),
      },
      residency: {
        budgetBytes: number(dataset.residencyBudgetBytes),
        decodedBytes: number(dataset.residentDecodedBytes),
        gpuBytes: number(dataset.residentGpuBytes),
        budgetReached: dataset.residencyBudgetReached === "true",
        chunksReady: number(dataset.targetChunksReady),
        chunksTotal: number(dataset.targetChunksTotal),
        schedulerRequests: number(dataset.targetSchedulerRequests),
        schedulerSkips: number(dataset.targetSchedulerSkips),
        evictedTargetMeshCount: number(dataset.evictedTargetMeshCount),
        selectionResidency: dataset.selectionResidency ?? null,
      },
      renderer: {
        gpuVertexPoolBytes: number(dataset.rendererGpuVertexPoolBytes),
        gpuBatchBufferBytes: number(dataset.rendererGpuBatchBufferBytes),
        gpuUniformBytes: number(dataset.rendererGpuUniformBytes),
        gpuBufferBytes: number(dataset.rendererGpuBufferBytes),
        gpuAttachmentBytes: number(dataset.rendererGpuAttachmentBytes),
        cpuStagingBytes: number(dataset.rendererCpuStagingBytes),
      },
      page: {
        usedJsHeapBytes: memory ? memory.usedJSHeapSize : null,
        totalJsHeapBytes: memory ? memory.totalJSHeapSize : null,
        jsHeapLimitBytes: memory ? memory.jsHeapSizeLimit : null,
        usedJsHeapUnavailableReason: memory
          ? null
          : "performance.memory is absent; relaunch with --enable-precise-memory-info.",
        uaMemoryBytes: null,
        uaMemoryByType: null,
        uaMemoryByScope: null,
        uaMemoryEntryCount: null,
        uaMemorySampleMilliseconds: null,
        uaMemoryUnavailableReason: null,
      },
    };
    if (typeof performance.measureUserAgentSpecificMemory !== "function") {
      sample.page.uaMemoryUnavailableReason =
        "performance.measureUserAgentSpecificMemory is not exposed in this browser.";
      return sample;
    }
    const startedAt = performance.now();
    try {
      const measured = await performance.measureUserAgentSpecificMemory();
      const byType = {};
      const byScope = {};
      for (const entry of measured.breakdown) {
        for (const type of entry.types.length > 0 ? entry.types : ["Unattributed"]) {
          byType[type] = (byType[type] ?? 0) + entry.bytes;
        }
        const scopes = entry.attribution.map((item) => item.scope);
        for (const scope of scopes.length > 0 ? scopes : ["Unattributed"]) {
          byScope[scope] = (byScope[scope] ?? 0) + entry.bytes;
        }
      }
      sample.page.uaMemoryBytes = measured.bytes;
      sample.page.uaMemoryByType = byType;
      sample.page.uaMemoryByScope = byScope;
      sample.page.uaMemoryEntryCount = measured.breakdown.length;
      sample.page.uaMemorySampleMilliseconds = Math.round(performance.now() - startedAt);
    } catch (error) {
      sample.page.uaMemoryUnavailableReason = String(error);
    }
    return sample;
  });
}

async function recordRun({ profile, budgetBytes, residencyMiB, runIndex, captureScreenshots }) {
  const label = `${profile}#${runIndex}`;
  const server = await chromium.launchServer({
    channel: "chrome",
    headless,
    args: ["--enable-precise-memory-info"],
  });
  const rootPid = server.process().pid;
  const browser = await chromium.connect(server.wsEndpoint());
  const consoleIssues = [];
  const screenshots = {};
  const samples = [];
  const startedAt = Date.now();
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleIssues.push({ level: message.type(), message: message.text() });
      }
    });
    page.on("pageerror", (error) => consoleIssues.push({ level: "pageerror", message: error.message }));

    const sample = async (phase) => {
      const atMilliseconds = Date.now() - startedAt;
      const [pageSample, processSample] = [await samplePage(page), await sampleProcessTree(rootPid)];
      samples.push({ phase, atMilliseconds, ...pageSample, process: processSample });
      console.log(
        `[memory] ${label} ${phase} +${(atMilliseconds / 1000).toFixed(1)}s ` +
          `heap ${pageSample.page.usedJsHeapBytes} ua ${pageSample.page.uaMemoryBytes} ` +
          `ws ${processSample.workingSetBytes}`,
      );
    };
    // Watches the counters the scheduler publishes and reports whether they
    // stopped moving. It returns its verdict instead of throwing, because one
    // phase (eviction, under a budget too small to hold the demanded set) can
    // legitimately keep churning; the caller decides whether that is fatal.
    const settleKeys = ["status", "requests", "skips", "chunksReady", "residentGpuBytes"];
    const settle = async (quietChecks, intervalMs, timeoutMs) => {
      const startedWaitingAt = Date.now();
      const deadline = startedWaitingAt + timeoutMs;
      let priorState = null;
      let observation = null;
      let firstObservation = null;
      let quiet = 0;
      while (Date.now() < deadline) {
        await page.waitForTimeout(intervalMs);
        observation = await page.evaluate(() => {
          const root = document.documentElement.dataset;
          return [
            document.querySelector("#status")?.getAttribute("data-state") ?? "",
            root.targetSchedulerRequests ?? "",
            root.targetSchedulerSkips ?? "",
            root.targetChunksReady ?? "",
            root.residentGpuBytes ?? "",
          ];
        });
        firstObservation ??= observation;
        const state = observation.join("|");
        quiet = priorState === state ? quiet + 1 : 0;
        priorState = state;
        if (quiet >= quietChecks && observation[0] === "ready") {
          return {
            settled: true,
            waitedMilliseconds: Date.now() - startedWaitingAt,
            state: observation.join("|"),
          };
        }
      }
      // Naming what moved over the whole wait, not only between the last two
      // reads, is what tells a reader whether the scheduler was making progress
      // or looping over chunks it keeps refusing.
      const moving = (firstObservation ?? [])
        .map((value, at) => (value === observation?.[at] ? null : settleKeys[at]))
        .filter((key) => key !== null);
      const seconds = Math.round(timeoutMs / 1000);
      const reason = observation?.[0] === "ready"
        ? `The status reached ready, but ${moving.join(", ") || "the counters"} still changed ` +
          `during the ${seconds} s wait.`
        : `The status stayed ${JSON.stringify(observation?.[0] ?? "")} for the whole ${seconds} s ` +
          `wait, with ${moving.join(", ") || "no counter"} still changing.`;
      return {
        settled: false,
        waitedMilliseconds: Date.now() - startedWaitingAt,
        state: (observation ?? []).join("|"),
        firstState: (firstObservation ?? []).join("|"),
        movingCounters: moving,
        reason,
      };
    };
    const settleOrFail = async (phase, quietChecks, intervalMs, timeoutMs) => {
      const quiescence = await settle(quietChecks, intervalMs, timeoutMs);
      if (!quiescence.settled) {
        throw new Error(`${label} never settled before ${phase}: ${quiescence.reason}`);
      }
      return quiescence;
    };
    const screenshot = async (name) => {
      if (!captureScreenshots) return;
      const bytes = await page.screenshot({ type: "png", timeout: 120_000 });
      await mkdir(resolve(outputDirectory, profile), { recursive: true });
      await writeFile(resolve(outputDirectory, profile, name), bytes);
      screenshots[name] = {
        path: `${profile}/${name}`,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    };

    const viewerUrl = new URL("http://127.0.0.1:4174/");
    viewerUrl.searchParams.set("scene", new URL("scene.gltf", viewerUrl).href);
    if (residencyMiB !== null) viewerUrl.searchParams.set("residencyMiB", String(residencyMiB));
    await page.goto(viewerUrl.href, { waitUntil: "domcontentloaded" });

    await page.waitForFunction(
      () => document.documentElement.dataset.hierarchyReady === "true",
      undefined,
      { timeout: 600_000 },
    );
    await sample("hierarchy");
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.coarseReady === "true" ||
        document.querySelector("#status")?.getAttribute("data-state") === "error",
      undefined,
      { timeout: 1_200_000 },
    );
    // Captured before the memory sample: the sample forces a collection that
    // blocks for seconds, and a capture requested behind it is serviced only
    // once the drain lets the compositor go, which would file a budget-limited
    // frame under the coarse phase.
    await screenshot("coarse-frame.png");
    await sample("coarse-frame");

    await settleOrFail("budget-limited", 3, 1_000, 1_800_000);
    await sample("budget-limited");
    await screenshot("budget-limited.png");

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
    await settleOrFail("navigation", 3, 1_000, 1_800_000);
    await sample("navigation");

    // A selection is the source-aware path: it pins the picked prototype's
    // chunk and lazily resolves the property sidecar.
    const readSelection = () =>
      page.evaluate(() => {
        const dataset = document.documentElement.dataset;
        return {
          selectedObjectId: dataset.selectedObjectId ?? "0",
          selectionResidency: dataset.selectionResidency ?? null,
          evictedTargetMeshCount: dataset.evictedTargetMeshCount ?? null,
        };
      });
    // A pick is stamped in the click handler itself, so a hit shows up within a
    // frame; an empty-space click stamps 0. Waiting for the identifier is
    // therefore bounded tightly, and only a real hit is given time to resolve
    // its residency, which may need a range fetch and a decode.
    const clickAndAwaitSelection = async (x, y) => {
      const before = await readSelection();
      await canvas.click({ position: { x, y } });
      try {
        await page.waitForFunction(
          (previous) => (document.documentElement.dataset.selectedObjectId ?? "0") !== previous,
          before.selectedObjectId,
          { timeout: 5_000 },
        );
      } catch {
        // Either nothing was under the cursor or the same occurrence was picked
        // again; neither tells us anything new about residency.
        return null;
      }
      const after = await readSelection();
      if (after.selectedObjectId === "0") return null;
      try {
        await page.waitForFunction(
          () => document.documentElement.dataset.selectionResidency !== "loading",
          undefined,
          { timeout: 120_000 },
        );
      } catch {
        return null;
      }
      return readSelection();
    };

    // The centre is where geometry is after the camera move; the two fallbacks
    // cover a view whose centre happens to fall through a gap.
    let selection = null;
    for (const offset of [0, -0.12, 0.12]) {
      selection = await clickAndAwaitSelection(
        bounds.width / 2 + bounds.width * offset,
        bounds.height / 2 + bounds.height * offset,
      );
      if (selection) break;
    }
    if (!selection) throw new Error(`${label} could not select an occurrence near the view centre.`);
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
      { timeout: 300_000 },
    );
    const semanticProperties = await page.evaluate(() => {
      const entries = document.querySelector("#semantic-property-entries");
      const status = document.querySelector("#semantic-property-status");
      const resolved = entries instanceof HTMLElement && !entries.hidden;
      return {
        state: resolved ? "resolved" : (status?.getAttribute("data-state") ?? null),
        entryCount: resolved ? entries.children.length : 0,
        countLabel: document.querySelector("#semantic-property-count")?.textContent ?? null,
      };
    });
    await sample("selection");
    await screenshot("selection.png");

    // An eviction cycle needs a pick whose chunk is not resident while the
    // budget is full. The centre selection above is usually already that pick:
    // what the camera shows after the move is not what the scheduler admitted,
    // so promoting it pins a chunk and pushes colder groups out. A promotion
    // stamps selectionResidency "target"; a chunk that was already resident
    // stamps "retained", which is how the two are told apart.
    const evictionFromPick = (source, picked) =>
      picked !== null &&
      picked.selectionResidency === "target" &&
      Number(picked.evictedTargetMeshCount) > 0
        ? {
            observed: true,
            source,
            selected: picked.selectedObjectId,
            selectionResidency: picked.selectionResidency,
            evictedTargetMeshCount: Number(picked.evictedTargetMeshCount),
          }
        : null;
    let eviction = evictionFromPick("selection", selection);
    // Only when the centre pick was already resident is the viewport scanned for
    // one that is not. Points are walked in a fixed order so a repeat run makes
    // the same attempts; the first pick that evicts ends the scan.
    const evictionAttempts = [];
    if (eviction === null) {
      const probePoints = [];
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          probePoints.push({
            x: bounds.width * (0.14 + column * 0.18),
            y: bounds.height * (0.18 + row * 0.21),
          });
        }
      }
      for (const [index, point] of probePoints.entries()) {
        const picked = await clickAndAwaitSelection(point.x, point.y);
        evictionAttempts.push({
          pointIndex: index,
          selected: picked?.selectedObjectId ?? null,
          selectionResidency: picked?.selectionResidency ?? null,
          evictedTargetMeshCount:
            picked === null ? null : Number(picked.evictedTargetMeshCount ?? 0),
        });
        eviction = evictionFromPick("probe", picked);
        if (eviction !== null) break;
      }
    }
    if (eviction === null) {
      eviction = {
        observed: false,
        source: null,
        reason:
          "Neither the centre selection nor any of the scanned viewport points needed a chunk " +
          "that was absent while the budget was full, so no colder group was evicted during " +
          "this run.",
        attempts: evictionAttempts.length,
      };
    }
    // The eviction phase is sampled after the scan whether or not the scheduler
    // goes quiet. A budget too small to hold the demanded set keeps re-admitting
    // and re-evicting around the pinned selection, and waiting that out would
    // mean never recording the phase; the record says which it was.
    const evictionQuiescence = await settle(3, 1_000, 180_000);
    await sample("eviction");

    return {
      profile,
      runIndex,
      residencyMiB,
      budgetBytes,
      startedAt: new Date(startedAt).toISOString(),
      browserVersion: browser.version(),
      rootPid,
      samples,
      selection: { ...selection, semanticProperties },
      eviction,
      evictionAttempts,
      evictionQuiescence,
      consoleIssues,
      screenshots,
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

await mkdir(outputDirectory, { recursive: true });
process.env.NARU_SCENE_DIR = relative(repositoryRoot, sceneDirectory);
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
await vite.listen();

const runs = [];
try {
  for (const profile of [
    { name: "default-budget", residencyMiB: null, budgetBytes: defaultBudgetBytes },
    { name: "forced-low-budget", residencyMiB: lowResidencyMiB, budgetBytes: lowBudgetBytes },
  ]) {
    for (let runIndex = 1; runIndex <= runsPerProfile; runIndex += 1) {
      runs.push(
        await recordRun({
          profile: profile.name,
          budgetBytes: profile.budgetBytes,
          residencyMiB: profile.residencyMiB,
          runIndex,
          captureScreenshots: runIndex === 1,
        }),
      );
    }
  }
} finally {
  await vite.close();
}

const allSamples = runs.flatMap((run) => run.samples.map((sample) => ({ run, sample })));
const maxOf = (read) =>
  allSamples.reduce(
    (worst, { run, sample }) => {
      const value = read(sample);
      if (value === null || value === undefined) return worst;
      return worst === null || value > worst.value
        ? { value, profile: run.profile, runIndex: run.runIndex, phase: sample.phase }
        : worst;
    },
    null,
  );
const withinBudget = (read) =>
  allSamples.every(({ sample }) => {
    const value = read(sample);
    const budget = sample.residency.budgetBytes;
    return value === null || budget === null || value <= budget;
  });
const lowRuns = runs.filter((run) => run.profile === "forced-low-budget");
const targetOutcomes = [
  {
    id: "residency-decoded-within-budget",
    met: withinBudget((sample) => sample.residency.decodedBytes),
    observedMaximum: maxOf((sample) => sample.residency.decodedBytes),
  },
  {
    id: "residency-gpu-within-budget",
    met: withinBudget((sample) => sample.residency.gpuBytes),
    observedMaximum: maxOf((sample) => sample.residency.gpuBytes),
  },
  {
    id: "process-working-set-ceiling",
    met: allSamples.every(
      ({ sample }) =>
        sample.process.workingSetBytes !== null &&
        sample.process.workingSetBytes <= 4 * 1024 * 1024 * 1024,
    ),
    observedMaximum: maxOf((sample) => sample.process.workingSetBytes),
  },
  {
    id: "js-heap-ceiling",
    met: allSamples.every(
      ({ sample }) =>
        sample.page.usedJsHeapBytes !== null &&
        sample.page.usedJsHeapBytes <= 2 * 1024 * 1024 * 1024,
    ),
    observedMaximum: maxOf((sample) => sample.page.usedJsHeapBytes),
  },
  {
    id: "forced-low-remains-usable",
    met:
      lowRuns.length > 0 &&
      lowRuns.every(
        (run) =>
          run.samples.some((sample) => sample.phase === "hierarchy") &&
          run.samples.some((sample) => sample.phase === "coarse-frame") &&
          run.selection.semanticProperties.state === "resolved" &&
          run.selection.semanticProperties.entryCount > 0,
      ),
    observedMaximum: null,
  },
];

const budgetLimited = (profile) =>
  runs
    .filter((run) => run.profile === profile)
    .map((run) => run.samples.find((sample) => sample.phase === "budget-limited"))
    .filter((sample) => sample !== undefined);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
};
const profileSummary = (profile) => {
  const samples = budgetLimited(profile);
  return {
    runs: samples.length,
    medianWorkingSetBytes: median(samples.map((sample) => sample.process.workingSetBytes)),
    medianPrivateBytes: median(samples.map((sample) => sample.process.privateBytes)),
    medianUsedJsHeapBytes: median(samples.map((sample) => sample.page.usedJsHeapBytes)),
    medianUaMemoryBytes: median(
      samples.map((sample) => sample.page.uaMemoryBytes).filter((value) => value !== null),
    ),
    medianResidentDecodedBytes: median(samples.map((sample) => sample.residency.decodedBytes)),
    medianResidentGpuBytes: median(samples.map((sample) => sample.residency.gpuBytes)),
    medianRendererGpuBufferBytes: median(samples.map((sample) => sample.renderer.gpuBufferBytes)),
    chunksReady: samples.map((sample) => sample.residency.chunksReady),
  };
};
const defaultSummary = profileSummary("default-budget");
const lowSummary = profileSummary("forced-low-budget");
const consoleIssues = runs.flatMap((run) =>
  run.consoleIssues.map((issue) => ({ profile: run.profile, runIndex: run.runIndex, ...issue })),
);

const evidence = {
  schemaVersion: "naru.memory-envelope.1",
  capturedAt: new Date().toISOString(),
  mode: "headed-phase-sampled-memory-ledger",
  timingComparability:
    "Milestone offsets in this record are perturbed: every phase sample calls " +
    "performance.measureUserAgentSpecificMemory(), which forces a collection and blocks for " +
    "seconds. Use artifacts/ifc/sixty5-first-frame for timing.",
  browser: {
    id: "chrome",
    engine: "Blink",
    version: runs[0]?.browserVersion ?? null,
    headless,
    viewport,
    launchArguments: ["--enable-precise-memory-info"],
  },
  host: {
    platform: process.platform,
    architecture: process.arch,
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    node: process.version,
  },
  source: {
    buildReport: relative(repositoryRoot, reportPath).replaceAll(sep, "/"),
    sceneDirectory: relative(repositoryRoot, sceneDirectory).replaceAll(sep, "/"),
    packageDigest: buildReport.output.packageDigest,
    resources: buildReport.output.resources,
    servedFrom: "Vite dev static hosting with HTTP Range support",
  },
  method: {
    phases,
    runsPerProfile,
    profiles: [
      { name: "default-budget", residencyMiB: null, budgetBytes: defaultBudgetBytes },
      { name: "forced-low-budget", residencyMiB: lowResidencyMiB, budgetBytes: lowBudgetBytes },
    ],
    camera,
    screenshots:
    "Each capture is taken while the page is quiet: the coarse frame before its "
    + "memory sample, the others after the scheduler settles. A full-page capture "
    + "requested while the residency drain is running is serviced only when the "
    + "compositor is free again, which would date the image to a later phase.",
  processSampling:
      "Win32_Process rows for chrome.exe, summed over the tree rooted at the launched browser.",
    evictionProbe:
      "The centre selection is the first candidate: a promotion that admits an absent chunk " +
      "while the budget is full evicts colder groups and is recorded with source 'selection'. " +
      "Only if that pick was already resident are twenty viewport points scanned in a fixed " +
      "order, and the first pick that evicts ends the scan.",
    evictionQuiescence:
      "The eviction sample is taken after a bounded 180 s wait for the scheduler counters to " +
      "stop moving. Each run records whether that wait succeeded and, when it did not, what " +
      "kept changing; a budget too small to hold the demanded set re-admits around the pinned " +
      "selection indefinitely.",
  },
  ledgerCategories,
  declaredTargets,
  targetOutcomes,
  summary: {
    defaultBudget: defaultSummary,
    forcedLowBudget: lowSummary,
    // Reported as an observation, not a target: process memory is dominated by
    // the document and the sidecars, which the residency budget does not govern.
    budgetToWorkingSetDeltaBytes:
      defaultSummary.medianWorkingSetBytes !== null && lowSummary.medianWorkingSetBytes !== null
        ? defaultSummary.medianWorkingSetBytes - lowSummary.medianWorkingSetBytes
        : null,
    residencyShareOfWorkingSet:
      defaultSummary.medianWorkingSetBytes
        ? Number(
            (defaultSummary.medianResidentDecodedBytes / defaultSummary.medianWorkingSetBytes)
              .toFixed(4),
          )
        : null,
  },
  runs,
  consoleIssues,
};

await writeFile(
  resolve(outputDirectory, "memory-envelope.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);
console.log(`[memory] evidence: ${relative(repositoryRoot, outputDirectory)}`);
for (const outcome of targetOutcomes) {
  console.log(`[memory] target ${outcome.id}: ${outcome.met ? "met" : "NOT MET"}`);
}
if (consoleIssues.length > 0) {
  throw new Error(`The browser emitted issues: ${JSON.stringify(consoleIssues)}.`);
}
