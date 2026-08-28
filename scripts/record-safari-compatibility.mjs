import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputFlag = process.argv.indexOf("--output");
const outputArgument =
  outputFlag === -1 ? "output/safari-compatibility" : process.argv[outputFlag + 1];
if (!outputArgument) throw new TypeError("--output requires a repository-relative path.");
if (process.platform !== "darwin") {
  throw new Error("The Safari compatibility recorder requires macOS and real Safari.");
}

const outputDirectory = resolve(repositoryRoot, outputArgument);
const outputFromRoot = relative(repositoryRoot, outputDirectory);
if (
  outputFromRoot === "" ||
  outputFromRoot === ".." ||
  outputFromRoot.startsWith(`..${sep}`) ||
  isAbsolute(outputFromRoot)
) {
  throw new TypeError("Safari compatibility output must remain inside the repository.");
}

const driverPort = 4444;
const appPort = 4175;
const driverUrl = `http://127.0.0.1:${driverPort}`;
const appUrl = `http://localhost:${appPort}/`;
const viewport = { width: 1320, height: 1000 };
const webDriverElementKey = "element-6066-11e4-a52e-4f735466cecf";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function waitForDriver(processHandle) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `safaridriver exited before accepting a session (code ${processHandle.exitCode}). ` +
          "Enable Safari > Develop > Allow Remote Automation and retry.",
      );
    }
    try {
      const response = await fetch(`${driverUrl}/status`);
      if (response.ok) return;
    } catch {
      // The driver needs a short startup window before its HTTP endpoint is ready.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    "Timed out waiting for safaridriver. Enable Safari > Develop > Allow Remote Automation and retry.",
  );
}

async function command(path, options = {}) {
  const response = await fetch(`${driverUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    throw new Error(
      `Safari WebDriver ${path} failed: ${payload.value?.message ?? response.statusText}`,
    );
  }
  return payload.value;
}

async function execute(sessionId, script) {
  return command(`/session/${sessionId}/execute/sync`, {
    method: "POST",
    body: JSON.stringify({ script, args: [] }),
  });
}

async function waitForApplication(sessionId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const observed = await execute(
      sessionId,
      `return {
        hierarchyReady: document.documentElement.dataset.hierarchyReady === "true",
        state: document.querySelector("#status")?.getAttribute("data-state") ?? null
      };`,
    );
    if (observed.hierarchyReady && observed.state !== "loading") return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Safari did not reach a stable NARU application state within 20 seconds.");
}

await mkdir(outputDirectory, { recursive: true });
const vite = await createServer({
  configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
  logLevel: "error",
  root: resolve(repositoryRoot, "apps/webgpu-spike"),
  server: { host: "localhost", port: appPort, strictPort: true },
});
const safariDriver = spawn("/usr/bin/safaridriver", ["-p", String(driverPort)], {
  stdio: ["ignore", "pipe", "pipe"],
});
let sessionId;

try {
  await vite.listen();
  await waitForDriver(safariDriver);
  const session = await command("/session", {
    method: "POST",
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          browserName: "safari",
          "safari:automaticInspection": false,
          "safari:automaticProfiling": false,
        },
      },
    }),
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/window/rect`, {
    method: "POST",
    body: JSON.stringify(viewport),
  });
  await command(`/session/${sessionId}/url`, {
    method: "POST",
    body: JSON.stringify({ url: appUrl }),
  });
  await waitForApplication(sessionId);

  const observed = await execute(
    sessionId,
    `return {
      webGpuAvailable: Boolean(navigator.gpu),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      title: document.title,
      status: document.querySelector("#status")?.textContent ?? null,
      state: document.querySelector("#status")?.getAttribute("data-state") ?? null,
      hierarchyReady: document.documentElement.dataset.hierarchyReady === "true",
      hierarchyResult: document.querySelector("#hierarchy-result")?.textContent ?? null,
      virtualizedHierarchyRows: document.querySelectorAll("#hierarchy li").length,
      prototypeCount: document.querySelector("#prototype-count")?.textContent ?? null,
      occurrenceCount: document.querySelector("#occurrence-count")?.textContent ?? null,
      brandLoaded: (() => {
        const image = document.querySelector("#naru-brand-mark");
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
      })()
    };`,
  );

  if (
    !observed.hierarchyReady ||
    observed.hierarchyResult !== "87 occurrence records ready" ||
    observed.virtualizedHierarchyRows < 1 ||
    observed.virtualizedHierarchyRows > 87 ||
    !observed.brandLoaded
  ) {
    throw new Error(`Safari did not load the expected NARU shell and hierarchy: ${JSON.stringify(observed)}.`);
  }
  const outcome = observed.webGpuAvailable ? "webgpu-ready" : "webgpu-unavailable";
  if (
    outcome === "webgpu-unavailable" &&
    (observed.state !== "error" || observed.status !== "WebGPU is unavailable in this browser.")
  ) {
    throw new Error(`Safari did not expose the expected capability error: ${JSON.stringify(observed)}.`);
  }
  if (
    outcome === "webgpu-ready" &&
    (observed.state !== "ready" ||
      observed.prototypeCount !== "34" ||
      observed.occurrenceCount !== "85")
  ) {
    throw new Error(`Safari exposed WebGPU but the canonical scene did not become ready: ${JSON.stringify(observed)}.`);
  }

  const diagnosticElement = await command(`/session/${sessionId}/element`, {
    method: "POST",
    body: JSON.stringify({ using: "css selector", value: ".hud" }),
  });
  const diagnosticElementId = diagnosticElement[webDriverElementKey];
  if (!diagnosticElementId) throw new Error("Safari WebDriver did not return the diagnostic element.");
  const screenshotBase64 = await command(
    `/session/${sessionId}/element/${diagnosticElementId}/screenshot`,
  );
  const screenshot = Buffer.from(screenshotBase64, "base64");
  const browserMajor = String(session.capabilities.browserVersion).split(".")[0];
  const screenshotName = `safari-${browserMajor}-macos-${outcome}.png`;
  await writeFile(resolve(outputDirectory, screenshotName), screenshot);

  const evidence = {
    schemaVersion: "naru.safari-compatibility.2",
    capturedAt: new Date().toISOString(),
    mode: "default-browser-settings",
    host: { platform: process.platform, architecture: process.arch },
    browser: {
      name: session.capabilities.browserName,
      version: session.capabilities.browserVersion,
      platformName: session.capabilities.platformName,
      platformVersion: session.capabilities["safari:platformVersion"],
      platformBuildVersion: session.capabilities["safari:platformBuildVersion"],
      headless: false,
    },
    source: {
      fixture: "fixtures/step/adafruit-pygamer.step",
      gltf: "artifacts/phase1/adafruit-pygamer/scene.gltf",
    },
    outcome,
    observed,
    limitations: [
      "Safari WebDriver does not expose the Chromium/Firefox console event stream used by the browser matrix recorder.",
      "A webgpu-unavailable result verifies capability detection and hierarchy-first failure only; it is not rendering conformance evidence.",
    ],
    screenshot: {
      path: screenshotName,
      bytes: screenshot.byteLength,
      sha256: sha256(screenshot),
    },
  };
  await writeFile(
    resolve(outputDirectory, "safari-compatibility.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `[safari-compatibility] Safari ${evidence.browser.version}: ${outcome}; ` +
      `${observed.hierarchyResult} (${observed.virtualizedHierarchyRows} virtualized rows)`,
  );
  console.log(`[safari-compatibility] evidence: ${outputDirectory}`);
} finally {
  if (sessionId) {
    await command(`/session/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
  }
  await vite.close();
  safariDriver.kill("SIGTERM");
}
