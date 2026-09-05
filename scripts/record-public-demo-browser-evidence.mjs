#!/usr/bin/env node
/**
 * Records the deployed public Studio opening the Digital Hub package from the
 * configured delivery origin (ADR-0023 gate 3).
 *
 * The record is self-contained: before the browser starts, every resource the
 * committed build report declares is downloaded from the origin in Node and
 * hashed, so the record proves which bytes the browser was offered; then a
 * headed browser opens the deployed Studio, either with NO query so the
 * bundle's own default scene URL is what gets exercised (`--open-via default`)
 * or through the Studio's `?scene=` query naming the origin document
 * (`--open-via scene-query`, for a package that is not the deployed default),
 * and the recorder captures every
 * response the page received from the origin (status, Content-Type,
 * Content-Range, CORS headers), the hierarchy / first-frame / ready
 * milestones, a pick with resolved property entries, and two screenshots.
 *
 * Nothing here is served locally: the site and the origin are the public
 * ones, so wall-clock figures depend on the network between this host and
 * two CDNs and the record says so.
 *
 * Usage:
 *   node scripts/record-public-demo-browser-evidence.mjs \
 *     [--url https://1n01raymond.github.io/naru/] \
 *     [--package-origin https://packages.blacktanlabs.com/naru/digital-hub/v1/] \
 *     [--build-report artifacts/ifc/digital-hub/build-report.json] \
 *     [--output artifacts/public-demo/digital-hub-origin] \
 *     [--open-via default|scene-query] \
 *     [--browser chrome|firefox] [--headless] [--timeout-ms 120000]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaVersion = "naru.public-demo-browser-evidence.1";
const mode = "headed-deployed-studio-delivery-origin-load";
const defaultSiteUrl = "https://1n01raymond.github.io/naru/";
const defaultPackageOrigin = "https://packages.blacktanlabs.com/naru/digital-hub/v1/";
const defaultBuildReport = "artifacts/ifc/digital-hub/build-report.json";
const defaultOutput = "artifacts/public-demo/digital-hub-origin";
const viewport = { width: 1320, height: 1000 };

const browserEngines = {
  chrome: {
    id: "chrome",
    engine: "Blink",
    launch: (headless) => chromium.launch({ channel: "chrome", headless }),
  },
  firefox: {
    id: "firefox",
    engine: "Gecko",
    launch: (headless) => firefox.launch({ headless }),
  },
};

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return value;
}

function normalizeHttpsPrefix(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL, got ${value}.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http(s), got ${url.protocol}.`);
  }
  if (url.username || url.password) throw new Error(`${label} must not carry credentials.`);
  if (url.search || url.hash) throw new Error(`${label} must not carry a query or fragment.`);
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.href;
}

function resolveOutputDirectory(value) {
  const directory = isAbsolute(value) ? value : resolve(repoRoot, value);
  const inside = relative(repoRoot, directory);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`--output must stay inside the repository, got ${value}.`);
  }
  return directory;
}

const options = {
  siteUrl: normalizeHttpsPrefix(argValue("--url", defaultSiteUrl), "--url"),
  packageOrigin: normalizeHttpsPrefix(
    argValue("--package-origin", defaultPackageOrigin),
    "--package-origin",
  ),
  buildReport: resolve(repoRoot, argValue("--build-report", defaultBuildReport)),
  output: resolveOutputDirectory(argValue("--output", defaultOutput)),
  openVia: argValue("--open-via", "default"),
  browser: argValue("--browser", "chrome"),
  headless: process.argv.includes("--headless"),
  timeoutMs: Number.parseInt(argValue("--timeout-ms", "120000"), 10),
};

const engine = browserEngines[options.browser];
if (!engine) {
  throw new Error(`--browser must be one of ${Object.keys(browserEngines).join(", ")}.`);
}
if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive integer.");
}
if (options.openVia !== "default" && options.openVia !== "scene-query") {
  throw new Error("--open-via must be default or scene-query.");
}

const studioUrl = new URL("studio/", options.siteUrl).href;
const siteOrigin = new URL(options.siteUrl).origin;
const packageOriginOrigin = new URL(options.packageOrigin).origin;
if (siteOrigin === packageOriginOrigin) {
  throw new Error(
    `The site (${siteOrigin}) and the package origin (${packageOriginOrigin}) share an origin; ` +
      "this record exists to prove a cross-origin load.",
  );
}

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchChecked(url, init = {}, timeoutMs = 120_000) {
  const response = await fetch(url, {
    redirect: "error",
    ...init,
    headers: {
      "accept-encoding": "identity",
      "cache-control": "no-cache",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error) => {
    const cause = error?.cause?.message ? ` (${error.cause.message})` : "";
    throw new Error(`${init.method ?? "GET"} ${url} failed: ${error.message}${cause}`);
  });
  assert(response.ok, `${init.method ?? "GET"} ${url} answered ${response.status}.`);
  return response;
}

function assetPaths(html) {
  const matches = new Set();
  const pattern = /(?:src|href)="([^"]*\/assets\/[^"/]+\.(?:js|css))"/gu;
  for (const match of html.matchAll(pattern)) matches.add(match[1]);
  return [...matches];
}

/**
 * Records how the origin document is reached. With `--open-via default` the
 * deployed bundle must name the origin document as its default scene; with
 * `--open-via scene-query` the Studio is opened at `studio/?scene=<document>`
 * and the bundle is only required to exist.
 */
async function inspectDeployment() {
  const html = await (await fetchChecked(studioUrl)).text();
  const assets = assetPaths(html);
  assert(assets.length > 0, `${studioUrl} references no built assets.`);
  const documentHref = new URL("scene.gltf", options.packageOrigin).href;
  const scriptAssets = assets.filter((path) => path.endsWith(".js"));
  let targetingAsset = null;
  if (options.openVia === "default") {
    for (const path of scriptAssets) {
      const text = await (await fetchChecked(new URL(path, studioUrl).href)).text();
      if (text.includes(documentHref)) {
        targetingAsset = path;
        break;
      }
    }
    assert(
      targetingAsset !== null,
      `No deployed script asset under ${studioUrl} names ${documentHref} as the default scene.`,
    );
  }
  const openedUrl = new URL(studioUrl);
  if (options.openVia === "scene-query") openedUrl.searchParams.set("scene", documentHref);
  return {
    studioUrl,
    siteOrigin,
    assetCount: assets.length,
    scriptAssetCount: scriptAssets.length,
    openedVia: options.openVia,
    openedHref: openedUrl.href,
    targetingAsset,
    defaultSceneHref: options.openVia === "default" ? documentHref : null,
    documentHref,
  };
}

/** Downloads every declared resource from the origin and verifies its bytes. */
async function verifyOriginResources(declared) {
  const resources = [];
  for (const resource of declared) {
    const url = new URL(resource.path, options.packageOrigin).href;
    // One minute of floor plus one second per megabyte declared: an 854 MB
    // package must not be failed by the fixed two-minute budget a 63 MB one fits.
    const timeoutMs = 60_000 + Math.ceil(resource.bytes / 1_000_000) * 1_000;
    const response = await fetchChecked(url, { headers: { origin: siteOrigin } }, timeoutMs);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      hash.update(chunk);
      bytes += chunk.byteLength;
    }
    const sha256 = hash.digest("hex");
    assert(
      bytes === resource.bytes,
      `${url}: ${bytes} bytes delivered, build report declares ${resource.bytes}.`,
    );
    assert(
      sha256 === resource.sha256,
      `${url}: sha256 ${sha256} delivered, build report declares ${resource.sha256}.`,
    );
    const contentLength = response.headers.get("content-length");
    assert(
      contentLength === String(resource.bytes),
      `${url}: Content-Length ${contentLength} does not equal ${resource.bytes}.`,
    );
    resources.push({
      path: resource.path,
      url,
      bytes,
      sha256,
      declaredMediaType: resource.mediaType,
      contentType: response.headers.get("content-type"),
      contentLength: Number.parseInt(contentLength, 10),
      acceptRanges: response.headers.get("accept-ranges"),
      accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
      accessControlExposeHeaders: response.headers.get("access-control-expose-headers"),
      matchesBuildReport: true,
    });
  }
  return resources;
}

function loadBuildReport() {
  const report = JSON.parse(readFileSync(options.buildReport, "utf8"));
  assert(Array.isArray(report.output?.resources), `${options.buildReport} has no output resources.`);
  assert(typeof report.output.packageDigest === "string", "build report has no packageDigest.");
  return {
    path: relative(repoRoot, options.buildReport).replaceAll("\\", "/"),
    schemaVersion: report.schemaVersion,
    packageDigest: report.output.packageDigest,
    resources: report.output.resources.map((resource) => ({
      path: resource.path,
      mediaType: resource.mediaType,
      bytes: resource.bytes,
      sha256: resource.sha256,
    })),
  };
}

async function screenshot(page, name) {
  const path = join(options.output, name);
  await page.screenshot({ path });
  const bytes = readFileSync(path);
  return { file: name, bytes: bytes.byteLength, sha256: sha256Hex(bytes) };
}

function summarizeOriginResponses(entries, declared) {
  const perResource = {};
  for (const resource of declared) {
    perResource[resource.path] = {
      responses: 0,
      statuses: {},
      rangeRequests: 0,
      contentRangeResponses: 0,
      contentType: null,
      accessControlAllowOrigin: null,
      accessControlExposeHeaders: null,
    };
  }
  const unexpected = [];
  for (const entry of entries) {
    const summary = perResource[entry.path];
    if (!summary) {
      unexpected.push(entry);
      continue;
    }
    summary.responses += 1;
    summary.statuses[entry.status] = (summary.statuses[entry.status] ?? 0) + 1;
    if (entry.requestRange !== null) summary.rangeRequests += 1;
    if (entry.contentRange !== null) summary.contentRangeResponses += 1;
    summary.contentType ??= entry.contentType;
    summary.accessControlAllowOrigin ??= entry.accessControlAllowOrigin;
    summary.accessControlExposeHeaders ??= entry.accessControlExposeHeaders;
  }
  assert(
    unexpected.length === 0,
    `The page fetched ${unexpected.length} undeclared origin path(s): ${unexpected
      .map((entry) => entry.path)
      .join(", ")}.`,
  );
  return {
    total: entries.length,
    perResource,
  };
}

async function readStudioState(page) {
  return page.evaluate(() => {
    const dataset = document.documentElement.dataset;
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const number = (key) => (dataset[key] === undefined ? null : Number(dataset[key]));
    return {
      location: { href: location.href, origin: location.origin },
      sceneSource: dataset.sceneSource ?? null,
      sceneSourceKind: text("#scene-source-kind"),
      sceneSourceLabel: text("#scene-source-label"),
      status: text("#status"),
      panel: {
        prototypes: text("#prototype-count"),
        occurrences: text("#occurrence-count"),
        triangles: text("#triangle-count"),
        edges: text("#edge-count"),
        binarySize: text("#binary-size"),
        decodeTime: text("#decode-time"),
        sourceFormat: text("#source-format"),
        gpuAdapter: text("#gpu-adapter"),
      },
      hierarchyReady: dataset.hierarchyReady === "true",
      coarseReady: dataset.coarseReady === "true",
      targetReady: dataset.targetReady === "true",
      targetChunksTotal: number("targetChunksTotal"),
      targetChunksReady: number("targetChunksReady"),
      targetSchedulerMode: dataset.targetSchedulerMode ?? null,
      targetSchedulerDemandPriority: dataset.targetSchedulerDemandPriority ?? null,
      targetSchedulerRequests: number("targetSchedulerRequests"),
      targetSchedulerSkips: number("targetSchedulerSkips"),
      residentDecodedBytes: number("residentDecodedBytes"),
      residentGpuBytes: number("residentGpuBytes"),
      residencyBudgetBytes: number("residencyBudgetBytes"),
      residencyBudgetReached: dataset.residencyBudgetReached ?? null,
      visibleOccurrences: number("visibleOccurrences"),
    };
  });
}

async function pickAtViewportCenter(page) {
  const box = await page.locator("#viewport").boundingBox();
  assert(box, "The Studio viewport has no bounding box.");
  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  const before = (await page.locator("#selection").textContent()) ?? "";
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    (previous) => {
      const current = document.querySelector("#selection")?.textContent ?? "";
      return current !== previous && /node [0-9]+/u.test(current);
    },
    before,
    { timeout: options.timeoutMs },
  );
  await page.waitForFunction(
    () => {
      const entries = document.querySelector("#semantic-property-entries");
      const status = document.querySelector("#semantic-property-status");
      const state = status?.dataset.state ?? "";
      return (entries && !entries.hidden) || state === "absent" || state === "error";
    },
    null,
    { timeout: options.timeoutMs },
  );
  const properties = await page.evaluate(() => {
    const status = document.querySelector("#semantic-property-status");
    const entries = document.querySelector("#semantic-property-entries");
    const rows = entries && !entries.hidden ? [...entries.children] : [];
    return {
      state: status?.dataset.state ?? null,
      statusText: status?.textContent?.trim() ?? null,
      countLabel: document.querySelector("#semantic-property-count")?.textContent?.trim() ?? null,
      entryCount: rows.length,
      sampleEntries: rows.slice(0, 8).map((row) => ({
        key: row.querySelector("dt")?.textContent?.trim() ?? null,
        value: (row.querySelector("dd")?.textContent?.trim() ?? "").slice(0, 120),
      })),
    };
  });
  assert(
    properties.entryCount > 0,
    `The pick resolved no property entries (state ${properties.state}: ${properties.statusText}).`,
  );
  const selection = await page.evaluate(() => {
    const dataset = document.documentElement.dataset;
    return {
      text: document.querySelector("#selection")?.textContent?.trim() ?? null,
      selectedObjectId: dataset.selectedObjectId ?? null,
      selectionResidency: dataset.selectionResidency ?? null,
      name: document.querySelector("#property-name")?.textContent?.trim() ?? null,
      sourceRef: document.querySelector("#property-source-ref")?.textContent?.trim() ?? null,
    };
  });
  return { point, selection, properties };
}

async function main() {
  const startedAt = Date.now();
  mkdirSync(options.output, { recursive: true });
  const buildReport = loadBuildReport();

  console.log(`[public-demo] inspecting ${studioUrl}`);
  const deployment = await inspectDeployment();
  console.log(
    deployment.openedVia === "default"
      ? `[public-demo] default scene = ${deployment.defaultSceneHref} (${deployment.targetingAsset})`
      : `[public-demo] opening ${deployment.openedHref}`,
  );

  console.log(`[public-demo] verifying ${buildReport.resources.length} resources at ${options.packageOrigin}`);
  const originBefore = await verifyOriginResources(buildReport.resources);

  const consoleIssues = [];
  const originResponses = [];
  const browser = await engine.launch(options.headless);
  let milestones;
  let stateAtReady;
  let stateAfterPick;
  let pick;
  let screenshots;
  const browserVersion = browser.version();
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push({ type: message.type(), text: message.text() });
      }
    });
    page.on("pageerror", (error) => consoleIssues.push({ type: "pageerror", text: String(error) }));
    page.on("crash", () => consoleIssues.push({ type: "crash", text: "page crashed" }));
    page.on("response", (response) => {
      const url = response.url();
      if (!url.startsWith(options.packageOrigin)) return;
      const headers = response.headers();
      originResponses.push({
        path: url.slice(options.packageOrigin.length),
        status: response.status(),
        requestRange: response.request().headers().range ?? null,
        contentRange: headers["content-range"] ?? null,
        contentType: headers["content-type"] ?? null,
        accessControlAllowOrigin: headers["access-control-allow-origin"] ?? null,
        accessControlExposeHeaders: headers["access-control-expose-headers"] ?? null,
      });
    });

    const t0 = Date.now();
    await page.goto(deployment.openedHref, { waitUntil: "load", timeout: options.timeoutMs });
    const waitFor = (predicate) =>
      page.waitForFunction(predicate, null, { timeout: options.timeoutMs });
    await waitFor(() => document.documentElement.dataset.hierarchyReady === "true");
    const hierarchyMs = Date.now() - t0;
    await waitFor(
      () =>
        document.documentElement.dataset.coarseReady === "true" ||
        document.documentElement.dataset.targetReady === "true",
    );
    const firstCoarseFrameMs = Date.now() - t0;
    await waitFor(() => document.documentElement.dataset.targetReady === "true");
    const readyMs = Date.now() - t0;
    milestones = { hierarchyMs, firstCoarseFrameMs, readyMs };
    console.log(
      `[public-demo] hierarchy ${hierarchyMs} ms, first coarse frame ${firstCoarseFrameMs} ms, ready ${readyMs} ms`,
    );
    stateAtReady = await readStudioState(page);
    assert(stateAtReady.sceneSource === "url", `sceneSource is ${stateAtReady.sceneSource}, expected url.`);
    assert(
      stateAtReady.location.origin === siteOrigin,
      `The page runs at ${stateAtReady.location.origin}, expected ${siteOrigin}.`,
    );
    const requestedScene = new URL(stateAtReady.location.href).searchParams.get("scene");
    assert(
      requestedScene === (deployment.openedVia === "scene-query" ? deployment.documentHref : null),
      `The page's scene query is ${requestedScene}, which does not match --open-via ${deployment.openedVia}.`,
    );
    const ready = await screenshot(page, "ready.png");

    pick = await pickAtViewportCenter(page);
    console.log(
      `[public-demo] picked ${pick.selection.selectedObjectId} (${pick.selection.selectionResidency}), ${pick.properties.entryCount} property entries`,
    );
    stateAfterPick = await readStudioState(page);
    const picked = await screenshot(page, "picked.png");
    screenshots = { ready, picked };
  } finally {
    await browser.close();
  }

  const originAfter = await verifyOriginResources(buildReport.resources);
  for (const [index, resource] of originAfter.entries()) {
    assert(
      resource.sha256 === originBefore[index].sha256,
      `${resource.path} changed at the origin during the run.`,
    );
  }

  const network = summarizeOriginResponses(originResponses, buildReport.resources);
  const evidence = {
    schemaVersion,
    capturedAt: new Date(startedAt).toISOString(),
    mode,
    browser: {
      id: engine.id,
      engine: engine.engine,
      version: browserVersion,
      headless: options.headless,
      viewport,
    },
    host: { platform: process.platform, architecture: process.arch },
    site: { url: options.siteUrl, origin: siteOrigin },
    packageOrigin: { url: options.packageOrigin, origin: packageOriginOrigin, crossOrigin: true },
    buildReport,
    deployment,
    origin: {
      verifiedBeforeBrowser: originBefore,
      verifiedAfterBrowser: originAfter.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      note:
        "Every declared resource was downloaded and hashed in Node before and after the browser run; " +
        "the browser was therefore offered exactly the bytes the committed build report records.",
    },
    milestones,
    stateAtReady,
    pick,
    stateAfterPick,
    network,
    screenshots,
    consoleIssues,
    timingNote:
      "Wall-clock milestones cross the public network to two CDNs (the Pages site and the delivery origin) " +
      "and are reported as a bound on this host at capture time, not as a stable figure.",
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
  };
  assert(
    consoleIssues.length === 0,
    `The run produced ${consoleIssues.length} console issue(s): ${JSON.stringify(consoleIssues)}`,
  );
  const evidencePath = join(options.output, "public-demo-browser.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `[public-demo] wrote ${relative(repoRoot, evidencePath)} (${network.total} origin responses, ` +
      `${stateAtReady.targetChunksReady}/${stateAtReady.targetChunksTotal} chunks, 0 console issues)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
