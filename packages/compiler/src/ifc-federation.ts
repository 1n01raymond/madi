import { spawn } from "node:child_process";
import { availableParallelism, tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileSceneToGltf } from "./gltf.js";
import type { CompileStage } from "./gltf.js";
import { hydrateIfcSceneSplit, ifcSceneSplitEncodingVersion } from "./ifc-scene.js";
import { readIfcStructure } from "./ifc-structure-stream.js";
import type { IfcStructureRead } from "./ifc-structure-stream.js";
import { inspectIfcFile } from "./ifc-source.js";
import type { IfcSourceInspection } from "./ifc-source.js";
import {
  createIfcIncrementalDependencyIndex,
  ifcIncrementalDependencyIndexSchema,
  serializeIfcIncrementalDependencyIndex,
} from "./ifc-incremental-dependencies.js";
import type { IfcIncrementalDependencyIndex } from "./ifc-incremental-dependencies.js";
import { writeCompiledPackage } from "./package-output.js";
import type { CompileGltfOptions, CompilerBuildReport } from "./types.js";
import { validateCompiledGltf } from "./validate.js";
import {
  createCompiledCacheKey,
  currentCompilerCacheIdentity,
  publishCompiledCacheEntry,
  restoreCompiledCacheEntry,
} from "./compiled-cache.js";
import type {
  CompilationCacheResult,
  CompiledCacheKeyInput,
  CompiledCacheToolInput,
} from "./compiled-cache.js";

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
  /** Optional persistent package cache keyed by the complete federation/toolchain identity. */
  readonly cacheDirectory?: string;
  readonly spatialIndex?: boolean;
  readonly spatialLeafCapacity?: number;
  readonly spatialPayloadOrder?: boolean;
  /** Omit insignificant scene.gltf whitespace for real-large packages. */
  readonly compactJson?: boolean;
  /** Omit non-semantic glTF mesh, bufferView, and accessor labels. */
  readonly omitResourceNames?: boolean;
  readonly elideDerivedIdentifiers?: boolean;
  readonly omitDefaultNodeTransforms?: boolean;
  readonly relocateHierarchyNodes?: boolean;
  /**
   * Record wall-clock stage durations into the result's `stages`. Timing is
   * diagnostic only: it never enters the adapter report, the build report,
   * the cache key, or the package bytes, so an instrumented compile produces
   * the same package as a plain one.
   */
  readonly stageTiming?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}

export type IfcFederationStageName =
  | "inspectSources"
  | "toolchainIdentity"
  | "cacheLookup"
  | "adapter"
  | "readSceneIr"
  | "hydrate"
  | "compile"
  | "validateCompiled"
  | "dependencyIndex"
  | "writePackage"
  | "writeDependencyIndex"
  | "retainSceneIr"
  | "cachePublish";

export interface IfcAdapterProcessTiming {
  /** Process spawn to the adapter module's first statement (interpreter start). */
  readonly spawnToModuleStartMilliseconds: number;
  /** IfcOpenShell and numpy import cost, measured by the adapter itself. */
  readonly importMilliseconds: number;
  /** Module import end to `main()` start (module-level definitions). */
  readonly importsToMainMilliseconds: number;
  /** `main()` start to the adapter's final stamp (extraction, merge, writes). */
  readonly mainMilliseconds: number;
  /** Final stamp to the process `close` event (interpreter teardown). */
  readonly finishToCloseMilliseconds: number;
  /** The adapter's own `naru.ifc-adapter-stage-timing.1` ledger, verbatim. */
  readonly ledger: unknown;
}

export interface IfcFederationStageTiming {
  readonly schemaVersion: "naru.ifc-federation-stage-timing.1";
  /** Entry of `compileIfcFederation` to its return; excludes temp-dir cleanup. */
  readonly totalMilliseconds: number;
  readonly stages: Readonly<Record<IfcFederationStageName, number>>;
  /** Milliseconds of `totalMilliseconds` outside every named stage. */
  readonly unattributedMilliseconds: number;
  /** The structure stream scan, one component of `readSceneIr`. */
  readonly structureReadMilliseconds: number;
  /** Sub-stages of `compile`; `other` closes the ledger. */
  readonly compileStages: Readonly<Record<CompileStage | "other", number>>;
  /** Present when the adapter ran (a package-cache hit skips it). */
  readonly adapter?: IfcAdapterProcessTiming;
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
  readonly dependencyIndex: IfcIncrementalDependencyIndex;
  readonly cache: CompilationCacheResult;
  /** Only when `stageTiming` was requested. */
  readonly stages?: IfcFederationStageTiming;
}

const incrementalDependencyIndexFilename = "incremental-dependencies.json";

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

interface AdapterRun {
  readonly stdout: string;
  /** `Date.now()` immediately before `spawn`, comparable with the adapter's own stamps. */
  readonly spawnedAtMs: number;
  readonly closedAtMs: number;
}

async function runAdapter(
  executable: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<AdapterRun> {
  return await new Promise<AdapterRun>((resolvePromise, reject) => {
    const spawnedAtMs = Date.now();
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
        resolvePromise({ stdout, spawnedAtMs, closedAtMs: Date.now() });
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

interface IfcAdapterIdentity {
  readonly schemaVersion: "naru.ifc-adapter-identity.1";
  readonly name: string;
  readonly version: string;
  readonly fingerprint: string;
}

async function inspectAdapterToolchain(
  executable: string,
  adapterScriptPath: string,
  environment: NodeJS.ProcessEnv,
): Promise<IfcAdapterIdentity> {
  const { stdout: serialized } = await runAdapter(
    executable,
    [adapterScriptPath, "--identity"],
    environment,
  );
  const value = parseJson(serialized.trim(), "IFC adapter identity");
  if (typeof value !== "object" || value === null) {
    throw new TypeError("IFC adapter identity must be an object.");
  }
  const identity = value as Partial<IfcAdapterIdentity>;
  if (
    identity.schemaVersion !== "naru.ifc-adapter-identity.1" ||
    typeof identity.name !== "string" ||
    identity.name === "" ||
    typeof identity.version !== "string" ||
    identity.version === "" ||
    typeof identity.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(identity.fingerprint)
  ) {
    throw new TypeError("IFC adapter returned an invalid cache identity.");
  }
  return identity as IfcAdapterIdentity;
}

function federationCacheInput(
  sources: readonly InspectedIfcFederationDocument[],
  identity: IfcAdapterIdentity,
  compiler: CompiledCacheToolInput,
  threads: number,
  targetChunkByteBudget: number,
  retainSceneIr: boolean,
  options: IfcFederationCompileOptions,
): CompiledCacheKeyInput {
  return {
    sources: sources.map(({ discipline, sha256 }) => ({ scope: discipline, sha256 })),
    adapter: {
      name: identity.name,
      version: `${identity.version}+${identity.fingerprint}`,
    },
    compiler,
    options: {
      threads,
      targetChunkByteBudget,
      retainSceneIr,
      coarseBounds: true,
      spatialIndex: options.spatialIndex === true,
      ...(options.spatialLeafCapacity === undefined
        ? {}
        : { spatialLeafCapacity: options.spatialLeafCapacity }),
      spatialPayloadOrder: options.spatialPayloadOrder === true,
      compactJson: options.compactJson === true,
      ...(options.omitResourceNames === true ? { omitResourceNames: true } : {}),
      ...(options.elideDerivedIdentifiers === true ? { elideDerivedIdentifiers: true } : {}),
      ...(options.omitDefaultNodeTransforms === true
        ? { omitDefaultNodeTransforms: true }
        : {}),
      ...(options.relocateHierarchyNodes === true ? { relocateHierarchyNodes: true } : {}),
      ...Object.fromEntries(
        sources.map(({ discipline, uriHint }) => [`uriHint.${discipline}`, uriHint]),
      ),
    },
  };
}

function cacheFailureDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireCachedBuildReport(value: unknown, packageDigest: string): CompilerBuildReport {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Cached IFC build report must be an object.");
  }
  const report = value as Partial<CompilerBuildReport>;
  if (report.output?.packageDigest !== packageDigest) {
    throw new TypeError("Cached IFC build report does not match its package manifest.");
  }
  return report as CompilerBuildReport;
}

function requireCachedDependencyIndex(
  value: unknown,
  packageDigest: string,
): IfcIncrementalDependencyIndex {
  const index = asRecord(value, "Cached IFC incremental dependency index");
  const scene = asRecord(index.scene, "Cached IFC incremental dependency scene identity");
  if (
    index.schemaVersion !== ifcIncrementalDependencyIndexSchema ||
    scene.packageDigest !== packageDigest ||
    !Array.isArray(index.documents) ||
    !Array.isArray(index.prototypes)
  ) {
    throw new TypeError("Cached IFC incremental dependency index is incompatible.");
  }
  return index as unknown as IfcIncrementalDependencyIndex;
}

function assertAdapterIdentity(
  adapterReport: unknown,
  sources: readonly InspectedIfcFederationDocument[],
  structure: IfcStructureRead,
  geometry: Buffer,
  properties: Buffer,
): { readonly report: Record<string, unknown>; readonly federationDigest: string } {
  const report = asRecord(adapterReport, "IFC adapter report");
  const expectedSceneEncoding = new Map<string, string>([
    ["madi.ifc-adapter-report.4", "madi.ifc-scene-ir-split.3"],
    ["naru.ifc-adapter-report.5", ifcSceneSplitEncodingVersion],
    ["naru.ifc-adapter-report.6", ifcSceneSplitEncodingVersion],
  ]).get(String(report.schemaVersion));
  if (expectedSceneEncoding === undefined) {
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
  if (report.schemaVersion === "naru.ifc-adapter-report.6") {
    const cache = asRecord(
      report.documentArtifactCache,
      "IFC adapter document artifact cache result",
    );
    const hits = cache.hits;
    const misses = cache.misses;
    if (
      cache.schemaVersion !== "naru.ifc-document-artifact.1" ||
      (cache.status !== "enabled" && cache.status !== "disabled") ||
      !Array.isArray(hits) ||
      hits.some((discipline) => typeof discipline !== "string") ||
      !Array.isArray(misses) ||
      misses.some((discipline) => typeof discipline !== "string")
    ) {
      throw new TypeError("IFC adapter returned an invalid document artifact cache result.");
    }
    // Both arrays were just proven to hold only strings.
    const covered = [...(hits as readonly string[]), ...(misses as readonly string[])].sort(
      (left, right) => left.localeCompare(right, "en"),
    );
    const expected = cache.status === "enabled"
      ? sources.map(({ discipline }) => discipline)
      : [];
    if (
      covered.length !== new Set(covered).size ||
      covered.length !== expected.length ||
      covered.some((discipline, index) => discipline !== expected[index])
    ) {
      throw new TypeError("IFC adapter document artifact cache coverage is incomplete.");
    }
  }
  const federation = asRecord(report.federation, "IFC adapter federation identity");
  if (typeof federation.sourceDigest !== "string") {
    throw new TypeError("IFC adapter report is missing its federation digest.");
  }
  const scene = asRecord(report.scene, "IFC adapter scene identity");
  if (scene.encodingVersion !== expectedSceneEncoding) {
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

const federationStageNames: readonly IfcFederationStageName[] = [
  "inspectSources",
  "toolchainIdentity",
  "cacheLookup",
  "adapter",
  "readSceneIr",
  "hydrate",
  "compile",
  "validateCompiled",
  "dependencyIndex",
  "writePackage",
  "writeDependencyIndex",
  "retainSceneIr",
  "cachePublish",
];

class StageLedger {
  private readonly startedAt = performance.now();
  private readonly durations = new Map<IfcFederationStageName, number>();
  structureReadMilliseconds = 0;
  readonly compileStages: Record<CompileStage, number> = {
    validateScene: 0,
    encodeGeometry: 0,
    measureDocument: 0,
  };
  adapter: IfcAdapterProcessTiming | undefined;

  async time<T>(stage: IfcFederationStageName, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      this.record(stage, performance.now() - started);
    }
  }

  timeSync<T>(stage: IfcFederationStageName, work: () => T): T {
    const started = performance.now();
    try {
      return work();
    } finally {
      this.record(stage, performance.now() - started);
    }
  }

  finish(): IfcFederationStageTiming {
    const totalMilliseconds = performance.now() - this.startedAt;
    const stages = Object.fromEntries(
      federationStageNames.map((stage) => [stage, this.durations.get(stage) ?? 0]),
    ) as Record<IfcFederationStageName, number>;
    const attributed = federationStageNames.reduce((sum, stage) => sum + stages[stage], 0);
    const compileSubStages =
      this.compileStages.validateScene +
      this.compileStages.encodeGeometry +
      this.compileStages.measureDocument;
    return {
      schemaVersion: "naru.ifc-federation-stage-timing.1",
      totalMilliseconds,
      stages,
      unattributedMilliseconds: totalMilliseconds - attributed,
      structureReadMilliseconds: this.structureReadMilliseconds,
      compileStages: { ...this.compileStages, other: stages.compile - compileSubStages },
      ...(this.adapter ? { adapter: this.adapter } : {}),
    };
  }

  private record(stage: IfcFederationStageName, milliseconds: number): void {
    this.durations.set(stage, (this.durations.get(stage) ?? 0) + milliseconds);
  }
}

async function stage<T>(
  ledger: StageLedger | undefined,
  name: IfcFederationStageName,
  work: () => Promise<T>,
): Promise<T> {
  return ledger ? await ledger.time(name, work) : await work();
}

function stageSync<T>(
  ledger: StageLedger | undefined,
  name: IfcFederationStageName,
  work: () => T,
): T {
  return ledger ? ledger.timeSync(name, work) : work();
}

interface AdapterWallClock {
  readonly moduleStartedAtMs: number;
  readonly importsFinishedAtMs: number;
  readonly mainStartedAtMs: number;
  readonly finishedAtMs: number;
}

async function readAdapterTiming(path: string, run: AdapterRun): Promise<IfcAdapterProcessTiming> {
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    throw new TypeError("The IFC adapter did not write the requested stage-timing ledger.", {
      cause: error,
    });
  }
  const ledger = parseJson(serialized, "IFC adapter stage timing") as {
    schemaVersion?: unknown;
    wallClock?: Partial<Record<keyof AdapterWallClock, unknown>>;
    importMilliseconds?: unknown;
  };
  const wallClock = ledger.wallClock;
  const isMs = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  if (
    ledger.schemaVersion !== "naru.ifc-adapter-stage-timing.1" ||
    !wallClock ||
    !isMs(wallClock.moduleStartedAtMs) ||
    !isMs(wallClock.importsFinishedAtMs) ||
    !isMs(wallClock.mainStartedAtMs) ||
    !isMs(wallClock.finishedAtMs) ||
    !isMs(ledger.importMilliseconds)
  ) {
    throw new TypeError("IFC adapter stage timing ledger has an unexpected shape.");
  }
  return {
    spawnToModuleStartMilliseconds: wallClock.moduleStartedAtMs - run.spawnedAtMs,
    importMilliseconds: ledger.importMilliseconds,
    importsToMainMilliseconds: wallClock.mainStartedAtMs - wallClock.importsFinishedAtMs,
    mainMilliseconds: wallClock.finishedAtMs - wallClock.mainStartedAtMs,
    finishToCloseMilliseconds: run.closedAtMs - wallClock.finishedAtMs,
    ledger,
  };
}

export async function compileIfcFederation(
  options: IfcFederationCompileOptions,
): Promise<IfcFederationCompilationResult> {
  const ledger = options.stageTiming === true ? new StageLedger() : undefined;
  const sources = await stage(ledger, "inspectSources", () =>
    inspectDocuments(options.documents),
  );
  const threads = positiveThreads(options.threads);
  const outputDirectory = resolve(options.outputDirectory);
  const targetChunkByteBudget =
    options.targetChunkByteBudget ?? defaultIfcTargetChunkByteBudget;
  const retainSceneIr = options.retainSceneIr === true;
  const pythonExecutable =
    options.pythonExecutable ??
    process.env.NARU_IFC_PYTHON ??
    process.env.NARU_PYTHON ??
    (process.platform === "win32" ? "python" : "python3");
  const adapterScriptPath = resolve(options.adapterScriptPath ?? defaultAdapterScript);
  const environment = options.environment ?? process.env;
  let cacheKeyInput: CompiledCacheKeyInput | undefined;
  let cacheKey: string | undefined;
  const { adapterToolchain, compiler } = await stage(ledger, "toolchainIdentity", async () => {
    const toolchain = options.cacheDirectory
      ? await inspectAdapterToolchain(pythonExecutable, adapterScriptPath, environment)
      : undefined;
    return {
      adapterToolchain: toolchain,
      compiler: toolchain ? await currentCompilerCacheIdentity() : undefined,
    };
  });
  if (options.cacheDirectory && adapterToolchain && compiler) {
    cacheKeyInput = federationCacheInput(
      sources,
      adapterToolchain,
      compiler,
      threads,
      targetChunkByteBudget,
      retainSceneIr,
      options,
    );
    cacheKey = createCompiledCacheKey(cacheKeyInput);
    try {
      const restored = await stage(ledger, "cacheLookup", () =>
        restoreCompiledCacheEntry({
          cacheDirectory: options.cacheDirectory as string,
          key: cacheKey as string,
          outputDirectory,
        }),
      );
      if (restored) {
        const [
          serializedBuildReport,
          serializedAdapterReport,
          serializedDependencyIndex,
        ] = await Promise.all([
          readFile(resolve(outputDirectory, "build-report.json"), "utf8"),
          readFile(resolve(outputDirectory, "adapter-report.json"), "utf8"),
          readFile(resolve(outputDirectory, incrementalDependencyIndexFilename), "utf8"),
        ]);
        const report = requireCachedBuildReport(
          parseJson(serializedBuildReport, "Cached IFC build report"),
          restored.packageDigest,
        );
        return {
          sources,
          outputDirectory,
          report,
          dependencyIndex: requireCachedDependencyIndex(
            parseJson(
              serializedDependencyIndex,
              "Cached IFC incremental dependency index",
            ),
            report.output.packageDigest,
          ),
          adapterReport: parseJson(serializedAdapterReport, "Cached IFC adapter report"),
          cache: { status: "hit", key: cacheKey },
          ...(ledger ? { stages: ledger.finish() } : {}),
        };
      }
    } catch (error) {
      console.warn(
        `[naru] cache restore failed (${cacheFailureDetails(error)}); recompiling.`,
      );
    }
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-ifc-"));
  const scenePath = join(temporaryDirectory, "scene-ir.json");
  const geometryPath = join(temporaryDirectory, "scene-ir-geometry.bin");
  const propertiesPath = join(temporaryDirectory, "scene-ir-properties.bin");
  const adapterReportPath = join(temporaryDirectory, "adapter-report.json");
  const stageTimingPath = join(temporaryDirectory, "stage-timing.json");
  try {
    const sourceArguments = sources.flatMap((source) => [
      "--document",
      `${source.discipline}=${source.sourcePath}`,
      "--uri-hint",
      `${source.discipline}=${source.uriHint}`,
    ]);
    const adapterRun = await stage(ledger, "adapter", () =>
      runAdapter(
        pythonExecutable,
        [
          adapterScriptPath,
          ...sourceArguments,
          "--scene",
          scenePath,
          "--geometry",
          geometryPath,
          "--properties",
          propertiesPath,
          "--report",
          adapterReportPath,
          ...(options.cacheDirectory
            ? ["--document-cache", resolve(options.cacheDirectory, "ifc-documents")]
            : []),
          "--threads",
          String(threads),
          ...(ledger ? ["--stage-timing", stageTimingPath] : []),
        ],
        environment,
      ),
    );
    if (ledger) ledger.adapter = await readAdapterTiming(stageTimingPath, adapterRun);
    // The structure document is never read or parsed as one string: the
    // streaming reader parses it record by record and hashes it on the way
    // through. Before property indexing (`madi.ifc-scene-ir-split.2`) a
    // real-large federation reached 632 MB against V8's 536,870,888-code-unit
    // string limit, and the reader keeps the compiler safe if a future
    // federation crosses it again.
    const [structure, geometry, properties, serializedAdapterReport] = await stage(
      ledger,
      "readSceneIr",
      () =>
        Promise.all([
          ledger
            ? (async () => {
                const started = performance.now();
                try {
                  return await readIfcStructure(scenePath);
                } finally {
                  ledger.structureReadMilliseconds = performance.now() - started;
                }
              })()
            : readIfcStructure(scenePath),
          readFile(geometryPath),
          readFile(propertiesPath),
          readFile(adapterReportPath, "utf8"),
        ]),
    );
    const parsedAdapterReport = parseJson(serializedAdapterReport, "IFC adapter report");
    const identity = assertAdapterIdentity(
      parsedAdapterReport,
      sources,
      structure,
      geometry,
      properties,
    );
    const scene = stageSync(ledger, "hydrate", () =>
      hydrateIfcSceneSplit(structure.value, geometry, properties),
    );
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

    const compileOptions: CompileGltfOptions = {
      coarseBounds: true,
      generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
      targetChunkByteBudget,
      ...(options.spatialIndex === true ? { spatialIndex: true } : {}),
      ...(options.spatialLeafCapacity === undefined
        ? {}
        : { spatialLeafCapacity: options.spatialLeafCapacity }),
      ...(options.spatialPayloadOrder === true ? { spatialPayloadOrder: true } : {}),
      ...(options.compactJson === true ? { compactJson: true } : {}),
      ...(options.omitResourceNames === true ? { omitResourceNames: true } : {}),
      ...(options.elideDerivedIdentifiers === true ? { elideDerivedIdentifiers: true } : {}),
      ...(options.omitDefaultNodeTransforms === true
        ? { omitDefaultNodeTransforms: true }
        : {}),
      ...(options.relocateHierarchyNodes === true ? { relocateHierarchyNodes: true } : {}),
      // The package carries the adapter's value column file byte-verbatim as
      // a lazy property sidecar; the compiler still never materializes a
      // property value.
      propertyColumns: properties,
    };
    const compiled = stageSync(ledger, "compile", () =>
      compileSceneToGltf(
        scene,
        compileOptions,
        ledger
          ? (compileStage, milliseconds) => {
              ledger.compileStages[compileStage] += milliseconds;
            }
          : undefined,
      ),
    );
    const validation = stageSync(ledger, "validateCompiled", () =>
      validateCompiledGltf(
        compiled.document,
        compiled.coarseBinary
          ? [compiled.binary, compiled.coarseBinary]
          : compiled.binary,
      ),
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
    const dependencyIndex = stageSync(ledger, "dependencyIndex", () =>
      createIfcIncrementalDependencyIndex(
        scene,
        sources,
        compiled.document,
        compiled.report.output.packageDigest,
      ),
    );
    await stage(ledger, "writePackage", () =>
      writeCompiledPackage(compiled, outputDirectory, adapterReport),
    );
    await stage(ledger, "writeDependencyIndex", () =>
      writeFile(
        resolve(outputDirectory, incrementalDependencyIndexFilename),
        serializeIfcIncrementalDependencyIndex(dependencyIndex),
        "utf8",
      ),
    );
    if (retainSceneIr) {
      await stage(ledger, "retainSceneIr", () =>
        Promise.all([
          copyFile(scenePath, resolve(outputDirectory, "scene-ir.json")),
          copyFile(geometryPath, resolve(outputDirectory, "scene-ir-geometry.bin")),
          copyFile(propertiesPath, resolve(outputDirectory, "scene-ir-properties.bin")),
        ]),
      );
    }
    if (cacheKeyInput && cacheKey) {
      const publishInput = cacheKeyInput;
      try {
        await stage(ledger, "cachePublish", () =>
          publishCompiledCacheEntry({
            cacheDirectory: options.cacheDirectory as string,
            packageDirectory: outputDirectory,
            input: publishInput,
            packageDigest: compiled.report.output.packageDigest,
            resourcePaths: [
              ...compiled.report.output.resources.map(({ path }) => path),
              "adapter-report.json",
              "build-report.json",
              incrementalDependencyIndexFilename,
              ...(retainSceneIr
                ? ["scene-ir.json", "scene-ir-geometry.bin", "scene-ir-properties.bin"]
                : []),
            ],
          }),
        );
      } catch (error) {
        console.warn(
          `[naru] cache publish failed (${cacheFailureDetails(error)}); ` +
            "compiled output kept without a cache entry.",
        );
      }
    }
    return {
      sources,
      outputDirectory,
      report: compiled.report,
      adapterReport,
      dependencyIndex,
      cache: cacheKey ? { status: "miss", key: cacheKey } : { status: "disabled" },
      ...(ledger ? { stages: ledger.finish() } : {}),
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
