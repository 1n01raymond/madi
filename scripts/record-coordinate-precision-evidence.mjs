import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateBytes, version as gltfValidatorVersion } from "gltf-validator";
import { chromium, firefox } from "playwright";
import { createServer } from "vite";

import {
  compileSceneToGltf,
  writeCompiledPackage,
} from "../packages/compiler/dist/index.js";
import { createLargeCoordinatePrecisionScene } from "../packages/scene-ir/dist/index.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputArgumentIndex = process.argv.indexOf("--output");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const requestedOutput = outputArgument?.slice("--output=".length) ??
  (outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined);
const evidenceDirectory = resolve(
  repositoryRoot,
  requestedOutput ?? "output/coordinate-precision",
);
const farOffset = [10_000_000, -7_000_000, 3_000_000];
const expectedGapMillimeters = 0.25;
const headless = process.argv.includes("--headless");
const browserArgument = process.argv.find((argument) => argument.startsWith("--browser="));
const requestedBrowser = browserArgument?.slice("--browser=".length);
const viewport = { width: 1120, height: 820 };

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nextFloat32(value) {
  const buffer = new ArrayBuffer(4);
  const floats = new Float32Array(buffer);
  const integers = new Uint32Array(buffer);
  floats[0] = value;
  integers[0] += 1;
  return floats[0];
}

function occurrenceNodes(document) {
  return document.nodes
    .filter((node) => typeof node.extras?.madi?.occurrenceId === "string")
    .map((node) => ({
      id: node.extras.madi.occurrenceId,
      x: node.matrix?.[12],
    }))
    .filter(({ x }) => Number.isFinite(x))
    .sort((left, right) => left.x - right.x);
}

function gapMeasurement(document) {
  const nodes = occurrenceNodes(document);
  if (nodes.length !== 2) throw new TypeError("Precision package must contain two plates.");
  const centerDistanceMeters = nodes[1].x - nodes[0].x;
  const gapMillimeters = (centerDistanceMeters - 0.04) * 1_000;
  return {
    centerXMeters: nodes.map(({ x }) => x),
    gapMillimeters,
    absoluteErrorMillimeters: Math.abs(gapMillimeters - expectedGapMillimeters),
    naiveF32GapMillimeters:
      (Math.fround(nodes[1].x) - Math.fround(nodes[0].x) - 0.04) * 1_000,
  };
}

async function recordPackage(id, offset) {
  const outputDirectory = resolve(evidenceDirectory, id);
  const compiled = compileSceneToGltf(
    createLargeCoordinatePrecisionScene(offset),
    { generator: "NARU ADR-0005 coordinate precision evidence" },
  );
  await writeCompiledPackage(compiled, outputDirectory);
  const gltfBytes = new TextEncoder().encode(compiled.json);
  const official = await validateBytes(gltfBytes, {
    uri: "scene.gltf",
    format: "gltf",
    writeTimestamp: false,
    maxIssues: 100,
    externalResourceFunction: async (uri) => {
      if (uri === "scene.bin") return compiled.binary;
      throw new TypeError(`Unexpected precision resource ${uri}.`);
    },
  });
  if (official.issues.numErrors !== 0 || official.issues.numWarnings !== 0) {
    throw new Error(
      `${id} glTF validation failed: ${JSON.stringify(official.issues.messages)}`,
    );
  }
  return {
    directory: outputDirectory,
    document: compiled.document,
    record: {
      packageDigest: compiled.report.output.packageDigest,
      sceneGltf: { bytes: gltfBytes.byteLength, sha256: sha256(gltfBytes) },
      sceneBinary: {
        bytes: compiled.binary.byteLength,
        sha256: sha256(compiled.binary),
      },
      counts: compiled.report.counts,
      measurement: gapMeasurement(compiled.document),
      gltfValidation: {
        validator: gltfValidatorVersion(),
        errors: 0,
        warnings: 0,
      },
    },
  };
}

async function startViewer(publicDirectory, port) {
  const server = await createServer({
    configFile: resolve(repositoryRoot, "apps/webgpu-spike/vite.config.ts"),
    root: resolve(repositoryRoot, "apps/webgpu-spike"),
    publicDir: publicDirectory,
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await server.listen();
  return server;
}

async function waitForFrames(page) {
  await page.evaluate(() => new Promise((resolveFrame) =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
  ));
}

async function saveCanvas(page, name) {
  let previous;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForFrames(page);
    await page.waitForTimeout(50);
    const bytes = await page.locator("#viewport").screenshot({ type: "png" });
    if (previous?.equals(bytes)) {
      await writeFile(resolve(evidenceDirectory, name), bytes);
      return { path: name, bytes: bytes.byteLength, sha256: sha256(bytes), raw: bytes };
    }
    previous = bytes;
  }
  throw new Error(`${name} did not settle to two byte-identical canvas captures.`);
}

async function interact(page) {
  await page.goto(page.url(), { waitUntil: "domcontentloaded" });
  await page.locator("#status[data-state='ready']").waitFor({ timeout: 30_000 });
  await waitForFrames(page);
  const canvas = page.locator("#viewport");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Precision canvas has no visible bounds.");
  const initial = await saveCanvas(page, `${page.browserId}-initial-${page.sceneId}.png`);

  let picked;
  const candidates = [
    [0.42, 0.55], [0.38, 0.5], [0.45, 0.45], [0.35, 0.55],
  ];
  for (const [xRatio, yRatio] of candidates) {
    await canvas.click({
      position: { x: bounds.width * xRatio, y: bounds.height * yRatio },
    });
    await waitForFrames(page);
    const text = await page.locator("#selection").innerText();
    const match = /Selected (.+) · node (\d+) · ID (\d+)/u.exec(text);
    if (match && Number(match[3]) === 2) {
      picked = {
        xRatio,
        yRatio,
        label: match[1],
        nodeIndex: Number(match[2]),
        objectId: Number(match[3]),
      };
      break;
    }
  }
  if (!picked) {
    const diagnostics = await page.evaluate(() => ({
      cameraOrigin: document.documentElement.dataset.cameraOrigin,
      status: document.querySelector("#status")?.textContent,
    }));
    throw new Error(
      `No deterministic precision fixture pick point was found: ${JSON.stringify(diagnostics)}`,
    );
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 42, centerY - 23, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.down("Shift");
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 24, centerY - 11, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -120);
  await waitForFrames(page);
  const navigated = await saveCanvas(
    page,
    `${page.browserId}-navigated-${page.sceneId}.png`,
  );

  await page.locator("#toggle-section").click();
  await page.locator("[data-section-axis='x']").click();
  await page.locator("#section-position").fill("50");
  await waitForFrames(page);
  const sectioned = await saveCanvas(
    page,
    `${page.browserId}-sectioned-${page.sceneId}.png`,
  );

  return {
    gpuAdapter: await page.locator("#gpu-adapter").innerText(),
    picked,
    screenshots: { initial, navigated, sectioned },
  };
}

async function recordBrowser(definition, nearDirectory, farDirectory) {
  const browser = await definition.launch();
  const issues = [];
  const servers = [];
  try {
    const nearServer = await startViewer(nearDirectory, definition.nearPort);
    servers.push(nearServer);
    const farServer = await startViewer(farDirectory, definition.farPort);
    servers.push(farServer);
    const context = await browser.newContext({ viewport });
    const run = async (sceneId, port) => {
      const page = await context.newPage();
      page.browserId = definition.id;
      page.sceneId = sceneId;
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") {
          issues.push({ sceneId, level: message.type(), message: message.text() });
        }
      });
      page.on("pageerror", (error) => {
        issues.push({ sceneId, level: "pageerror", message: error.message });
      });
      await page.goto(`http://127.0.0.1:${port}/`);
      const result = await interact(page);
      await page.close();
      return result;
    };
    const near = await run("near", definition.nearPort);
    const far = await run("far", definition.farPort);
    const comparisons = {};
    for (const key of ["initial", "navigated", "sectioned"]) {
      const matches = near.screenshots[key].raw.equals(far.screenshots[key].raw);
      comparisons[key] = {
        byteIdentical: matches,
        nearSha256: near.screenshots[key].sha256,
        farSha256: far.screenshots[key].sha256,
        maximumPixelDrift: matches ? 0 : null,
      };
      if (!matches) throw new Error(`${definition.id} ${key} near/far canvases differ.`);
      delete near.screenshots[key].raw;
      delete far.screenshots[key].raw;
    }
    if (near.picked.objectId !== far.picked.objectId || near.picked.label !== far.picked.label) {
      throw new Error(`${definition.id} near/far picking identity differs.`);
    }
    if (issues.length > 0) {
      throw new Error(`${definition.id} emitted browser issues: ${JSON.stringify(issues)}`);
    }
    return {
      browser: definition.id,
      browserEngine: definition.engine,
      version: browser.version(),
      headless,
      near,
      far,
      comparisons,
      consoleIssues: issues,
    };
  } finally {
    await browser.close();
    await Promise.all(servers.map((server) => server.close()));
  }
}

let preservedReadme;
try {
  preservedReadme = await readFile(resolve(evidenceDirectory, "README.md"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
await rm(evidenceDirectory, { recursive: true, force: true });
await mkdir(evidenceDirectory, { recursive: true });
if (preservedReadme) {
  await writeFile(resolve(evidenceDirectory, "README.md"), preservedReadme);
}
const nearPackage = await recordPackage("near", [0, 0, 0]);
const farPackage = await recordPackage("far", farOffset);
const browsers = [];
const browserDefinitions = [
  {
    id: "chrome",
    engine: "Blink",
    nearPort: 4180,
    farPort: 4181,
    launch: () => chromium.launch({ channel: "chrome", headless }),
  },
  {
    id: "firefox",
    engine: "Gecko",
    nearPort: 4182,
    farPort: 4183,
    launch: () => firefox.launch({ headless }),
  },
];
if (requestedBrowser && !browserDefinitions.some(({ id }) => id === requestedBrowser)) {
  throw new TypeError(`Unknown browser ${requestedBrowser}; expected chrome or firefox.`);
}
for (const definition of browserDefinitions.filter(
  ({ id }) => !requestedBrowser || id === requestedBrowser,
)) {
  browsers.push(
    await recordBrowser(definition, nearPackage.directory, farPackage.directory),
  );
}

const farUlpMeters = nextFloat32(Math.fround(farOffset[0])) - Math.fround(farOffset[0]);
const evidence = {
  schemaVersion: "naru.coordinate-precision.1",
  status: "adr-decision-evidence",
  host: { platform: process.platform, architecture: process.arch },
  fixture: {
    ownership: "project-owned-apache-2.0",
    plateWidthMillimeters: 40,
    plateHeightMillimeters: 60,
    gapMillimeters: expectedGapMillimeters,
    farOffsetMeters: farOffset,
    naiveF32UlpMetersAtFarX: farUlpMeters,
  },
  thresholds: {
    maximumMeasurementErrorMillimeters: 0.001,
    maximumPixelDrift: 0.25,
    pickingIdentityRequired: true,
    gltfErrors: 0,
    gltfWarnings: 0,
    consoleIssues: 0,
  },
  packages: {
    near: nearPackage.record,
    far: farPackage.record,
  },
  browsers,
};
await writeFile(
  resolve(evidenceDirectory, "evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);

console.log(
  `[coordinate-precision] ${farOffset[0].toLocaleString("en-US")} m offset · ` +
    `${farPackage.record.measurement.absoluteErrorMillimeters.toFixed(6)} mm measurement error · ` +
    `${browsers.length} browsers with byte-identical near/far canvases`,
);
