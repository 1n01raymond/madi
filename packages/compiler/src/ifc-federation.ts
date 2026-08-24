import { spawn } from "node:child_process";
import { availableParallelism, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileSceneToGltf } from "./gltf.js";
import { hydrateIfcSceneSplit, ifcSceneSplitEncodingVersion } from "./ifc-scene.js";
import { readIfcStructure } from "./ifc-structure-stream.js";
import type { IfcStructureRead } from "./ifc-structure-stream.js";
import { inspectIfcFile } from "./ifc-source.js";
import type { IfcSourceInspection } from "./ifc-source.js";
import { writeCompiledPackage } from "./package-output.js";
import type { CompilerBuildReport } from "./types.js";
import { validateCompiledGltf } from "./validate.js";

const defaultAdapterScript = fileURLToPath(
  new URL(
    "../../../native/adapter-ifc/tools/extract_federation_scene_ir.py",
    import.meta.url,
  ),
);
const disciplinePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const defaultIfcTargetChunkByteBudget = 512 * 1024;

export interface IfcFederationDocumentInput {
  readonly discipline: string;
  readonly sourcePath: string;
  readonly uriHint?: string;
}

export interface IfcFederationCompileOptions {
  readonly documents: readonly IfcFederationDocumentInput[];
  readonly outputDirectory: string;
  readonly pythonExecutable?: string;
  readonly adapterScriptPath?: string;
  readonly threads?: number;
  readonly retainSceneIr?: boolean;
  /** Maximum target bytes fetched and decoded in one progressive IFC request. */
  readonly targetChunkByteBudget?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface InspectedIfcFederationDocument extends IfcSourceInspection {
  readonly discipline: string;
  readonly uriHint: string;
}

export interface IfcFederationCompilationResult {
  readonly sources: readonly InspectedIfcFederationDocument[];
  readonly outputDirectory: string;
  readonly report: CompilerBuildReport;
  readonly adapterReport: unknown;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON.`, { cause: error });
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function positiveThreads(value: number | undefined): number {
  const result = value ?? Math.max(1, Math.min(8, availableParallelism()));
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new TypeError("IFC adapter threads must be a positive integer.");
  }
  return result;
}

async function inspectDocuments(
  documents: readonly IfcFederationDocumentInput[],
): Promise<readonly InspectedIfcFederationDocument[]> {
  if (documents.length === 0) {
    throw new TypeError("An IFC federation requires at least one document.");
  }
  const disciplines = new Set<string>();
  const paths = new Set<string>();
  const sources = await Promise.all(
    documents.map(async (document) => {
      if (!disciplinePattern.test(document.discipline)) {
        throw new TypeError(`Invalid IFC discipline ${document.discipline}.`);
      }
      if (disciplines.has(document.discipline)) {
        throw new TypeError(`Duplicate IFC discipline ${document.discipline}.`);
      }
      disciplines.add(document.discipline);
      const inspection = await inspectIfcFile(document.sourcePath);
      if (paths.has(inspection.sourcePath)) {
        throw new TypeError(`Duplicate IFC source path ${inspection.sourcePath}.`);
      }
      paths.add(inspection.sourcePath);
      return {
        ...inspection,
        discipline: document.discipline,
        uriHint: document.uriHint ?? basename(inspection.sourcePath),
      };
    }),
  );
  return sources.sort((left, right) => left.discipline.localeCompare(right.discipline, "en"));
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
          `Could not start the IFC adapter with ${executable}: ${error.message}`,
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
      if (/ModuleNotFoundError.*ifcopenshell/su.test(details)) {
        reject(
          new TypeError(
            "The selected Python environment does not provide IfcOpenShell. " +
              "Install native/adapter-ifc/tools/requirements-evidence.txt in that environment.",
          ),
        );
        return;
      }
      reject(new TypeError(`IFC federation adapter failed: ${details}.`));
    });
  });
}

function assertAdapterIdentity(
  adapterReport: unknown,
  sources: readonly InspectedIfcFederationDocument[],
  structure: IfcStructureRead,
  geometry: Buffer,
  properties: Buffer,
): { readonly report: Record<string, unknown>; readonly federationDigest: string } {
  const report = asRecord(adapterReport, "IFC adapter report");
  if (report.schemaVersion !== "madi.ifc-adapter-report.4") {
    throw new TypeError("IFC adapter report has an unsupported schema version.");
  }
  if (!Array.isArray(report.sources) || report.sources.length !== sources.length) {
    throw new TypeError("IFC adapter report does not cover every selected source.");
  }
  const reportSources = new Map(
    report.sources.map((value) => {
      const source = asRecord(value, "IFC adapter report source");
      return [source.discipline, source];
    }),
  );
  for (const source of sources) {
    const actual = reportSources.get(source.discipline);
    if (
      actual?.sha256 !== source.sha256 ||
      actual.byteLength !== source.byteLength ||
      actual.schema !== source.schema ||
      actual.path !== source.uriHint
    ) {
      throw new TypeError(`IFC adapter identity mismatch for ${source.discipline}.`);
    }
  }
  const federation = asRecord(report.federation, "IFC adapter federation identity");
  if (typeof federation.sourceDigest !== "string") {
    throw new TypeError("IFC adapter report is missing its federation digest.");
  }
  const scene = asRecord(report.scene, "IFC adapter scene identity");
  if (scene.encodingVersion !== ifcSceneSplitEncodingVersion) {
    throw new TypeError("IFC adapter scene transport version is unsupported.");
  }
  const structureIdentity = asRecord(scene.structure, "IFC scene structure identity");
  const geometryIdentity = asRecord(scene.geometry, "IFC scene geometry identity");
  const propertiesIdentity = asRecord(scene.properties, "IFC scene properties identity");
  for (const [identity, byteLength, sha256, label] of [
    [structureIdentity, structure.byteLength, structure.sha256, "structure"] as const,
    [
      geometryIdentity,
      geometry.byteLength,
      createHash("sha256").update(geometry).digest("hex"),
      "geometry",
    ] as const,
    [
      propertiesIdentity,
      properties.byteLength,
      createHash("sha256").update(properties).digest("hex"),
      "properties",
    ] as const,
  ]) {
    if (identity.byteLength !== byteLength || identity.sha256 !== sha256) {
      throw new TypeError(`IFC adapter ${label} digest does not match its report.`);
    }
  }
  return { report, federationDigest: federation.sourceDigest };
}

export async function compileIfcFederation(
  options: IfcFederationCompileOptions,
): Promise<IfcFederationCompilationResult> {
  const sources = await inspectDocuments(options.documents);
  const threads = positiveThreads(options.threads);
  const outputDirectory = resolve(options.outputDirectory);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "madi-ifc-"));
  const scenePath = join(temporaryDirectory, "scene-ir.json");
  const geometryPath = join(temporaryDirectory, "scene-ir-geometry.bin");
  const propertiesPath = join(temporaryDirectory, "scene-ir-properties.bin");
  const adapterReportPath = join(temporaryDirectory, "adapter-report.json");
  try {
    const sourceArguments = sources.flatMap((source) => [
      "--document",
      `${source.discipline}=${source.sourcePath}`,
      "--uri-hint",
      `${source.discipline}=${source.uriHint}`,
    ]);
    await runAdapter(
      options.pythonExecutable ??
        process.env.MADI_IFC_PYTHON ??
        process.env.MADI_PYTHON ??
        (process.platform === "win32" ? "python" : "python3"),
      [
        resolve(options.adapterScriptPath ?? defaultAdapterScript),
        ...sourceArguments,
        "--scene",
        scenePath,
        "--geometry",
        geometryPath,
        "--properties",
        propertiesPath,
        "--report",
        adapterReportPath,
        "--threads",
        String(threads),
      ],
      options.environment ?? process.env,
    );
    // The structure document is never read or parsed as one string: the
    // streaming reader parses it record by record and hashes it on the way
    // through. Before property indexing (`madi.ifc-scene-ir-split.2`) a
    // real-large federation reached 632 MB against V8's 536,870,888-code-unit
    // string limit, and the reader keeps the compiler safe if a future
    // federation crosses it again.
    const [structure, geometry, properties, serializedAdapterReport] = await Promise.all([
      readIfcStructure(scenePath),
      readFile(geometryPath),
      readFile(propertiesPath),
      readFile(adapterReportPath, "utf8"),
    ]);
    const parsedAdapterReport = parseJson(serializedAdapterReport, "IFC adapter report");
    const identity = assertAdapterIdentity(
      parsedAdapterReport,
      sources,
      structure,
      geometry,
      properties,
    );
    const scene = hydrateIfcSceneSplit(structure.value, geometry, properties);
    if (scene.revision.sourceDigest !== `sha256:${identity.federationDigest}`) {
      throw new TypeError("IFC Scene IR federation digest does not match the adapter report.");
    }
    const sceneDocumentDigests = new Set(
      scene.documents.map((document) => document.sourceDigest),
    );
    for (const source of sources) {
      if (!sceneDocumentDigests.has(`sha256:${source.sha256}`)) {
        throw new TypeError(`IFC Scene IR is missing source ${source.discipline}.`);
      }
    }

    const compiled = compileSceneToGltf(scene, {
      coarseBounds: true,
      generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
      targetChunkByteBudget:
        options.targetChunkByteBudget ?? defaultIfcTargetChunkByteBudget,
    });
    const validation = validateCompiledGltf(
      compiled.document,
      compiled.coarseBinary
        ? [compiled.binary, compiled.coarseBinary]
        : compiled.binary,
    );
    if (!validation.ok) {
      throw new TypeError(
        `Compiled IFC glTF validation failed: ${validation.issues
          .slice(0, 5)
          .map(({ code, path }) => `${code} at ${path}`)
          .join(", ")}`,
      );
    }

    const adapterReport = {
      ...identity.report,
      // Derived from the validation `compileSceneToGltf` already ran (it
      // throws before reaching this point when the scene does not validate),
      // so the scene is no longer validated twice.
      sceneIrValidation: {
        ok: true,
        errorCount: 0,
        warningCount: compiled.sceneValidation.issues.filter(
          ({ severity }) => severity === "warning",
        ).length,
      },
    };
    await writeCompiledPackage(compiled, outputDirectory, adapterReport);
    if (options.retainSceneIr) {
      await Promise.all([
        copyFile(scenePath, resolve(outputDirectory, "scene-ir.json")),
        copyFile(geometryPath, resolve(outputDirectory, "scene-ir-geometry.bin")),
        copyFile(propertiesPath, resolve(outputDirectory, "scene-ir-properties.bin")),
      ]);
    }
    return {
      sources,
      outputDirectory,
      report: compiled.report,
      adapterReport,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
