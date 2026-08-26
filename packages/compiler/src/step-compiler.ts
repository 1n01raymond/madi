import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hydratePhase0Evidence } from "./evidence-input.js";
import { compileSceneToGltf } from "./gltf.js";
import { writeCompiledPackage } from "./package-output.js";
import { inspectStepFile } from "./step-source.js";
import type { StepSourceInspection } from "./step-source.js";
import type { CompilerBuildReport } from "./types.js";
import { validateCompiledGltf } from "./validate.js";

const defaultAdapterScript = fileURLToPath(
  new URL("../../../native/adapter-occt/tools/extract_scene_ir.py", import.meta.url),
);

export interface StepCompileOptions {
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly pythonExecutable?: string;
  readonly adapterScriptPath?: string;
  readonly linearTolerance?: number;
  readonly angularTolerance?: number;
  readonly spatialIndex?: boolean;
  readonly spatialLeafCapacity?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface StepCompilationResult {
  readonly source: StepSourceInspection;
  readonly outputDirectory: string;
  readonly report: CompilerBuildReport;
  readonly adapterReport: unknown;
}

function positiveTolerance(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }
  return result;
}

async function runAdapter(
  executable: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-16_384);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    child.once("error", (error) => {
      reject(
        new TypeError(
          `Could not start the OCCT adapter with ${executable}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const details = stderr.trim() || stdout.trim() || `exit code ${String(code)}`;
      if (/ModuleNotFoundError.*(?:cadquery|OCP)/su.test(details)) {
        reject(
          new TypeError(
            "The selected Python environment does not provide CadQuery/OCP. " +
              "Install native/adapter-occt/tools/requirements-evidence.txt in that environment.",
          ),
        );
        return;
      }
      reject(new TypeError(`OCCT STEP adapter failed: ${details}.`));
    });
  });
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON.`, { cause: error });
  }
}

function assertAdapterIdentity(
  adapterReport: unknown,
  inspection: StepSourceInspection,
): void {
  if (typeof adapterReport !== "object" || adapterReport === null) {
    throw new TypeError("OCCT adapter report must be an object.");
  }
  const source = (adapterReport as { readonly source?: unknown }).source;
  if (typeof source !== "object" || source === null) {
    throw new TypeError("OCCT adapter report is missing source identity.");
  }
  const record = source as { readonly sha256?: unknown; readonly format?: unknown };
  if (record.sha256 !== inspection.sha256) {
    throw new TypeError("OCCT adapter report source digest does not match the STEP input.");
  }
  if (record.format !== `STEP ${inspection.schema}`) {
    throw new TypeError("OCCT adapter report schema does not match the STEP header.");
  }
}

export async function compileStepFile(
  options: StepCompileOptions,
): Promise<StepCompilationResult> {
  const inspection = await inspectStepFile(options.sourcePath);
  const sourcePath = inspection.sourcePath;
  const outputDirectory = resolve(options.outputDirectory);
  const linearTolerance = positiveTolerance(
    options.linearTolerance,
    0.15,
    "Linear tolerance",
  );
  const angularTolerance = positiveTolerance(
    options.angularTolerance,
    0.15,
    "Angular tolerance",
  );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-step-"));
  const scenePath = join(temporaryDirectory, "scene-ir.json");
  const adapterReportPath = join(temporaryDirectory, "adapter-report.json");
  try {
    await runAdapter(
      options.pythonExecutable ??
        process.env.NARU_PYTHON ??
        (process.platform === "win32" ? "python" : "python3"),
      [
        resolve(options.adapterScriptPath ?? defaultAdapterScript),
        sourcePath,
        "--scene",
        scenePath,
        "--report",
        adapterReportPath,
        "--linear-tolerance",
        String(linearTolerance),
        "--angular-tolerance",
        String(angularTolerance),
        "--uri-hint",
        basename(sourcePath),
      ],
      options.environment ?? process.env,
    );
    const [serializedScene, serializedAdapterReport] = await Promise.all([
      readFile(scenePath, "utf8"),
      readFile(adapterReportPath, "utf8"),
    ]);
    const adapterReport = parseJson(serializedAdapterReport, "OCCT adapter report");
    assertAdapterIdentity(adapterReport, inspection);
    const scene = hydratePhase0Evidence(parseJson(serializedScene, "OCCT Scene IR"));
    if (scene.revision.sourceDigest !== `sha256:${inspection.sha256}`) {
      throw new TypeError("OCCT Scene IR source digest does not match the STEP input.");
    }
    const compiled = compileSceneToGltf(scene, {
      coarseBounds: true,
      ...(options.spatialIndex === true ? { spatialIndex: true } : {}),
      ...(options.spatialLeafCapacity === undefined
        ? {}
        : { spatialLeafCapacity: options.spatialLeafCapacity }),
    });
    const validation = validateCompiledGltf(
      compiled.document,
      compiled.coarseBinary
        ? [compiled.binary, compiled.coarseBinary]
        : compiled.binary,
    );
    if (!validation.ok) {
      throw new TypeError(
        `Compiled glTF validation failed: ${validation.issues
          .slice(0, 5)
          .map(({ code, path }) => `${code} at ${path}`)
          .join(", ")}`,
      );
    }
    await writeCompiledPackage(compiled, outputDirectory, adapterReport);
    return { source: inspection, outputDirectory, report: compiled.report, adapterReport };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
