#!/usr/bin/env node

import { compileStepFile } from "./step-compiler.js";
import { compileIfcFederation } from "./ifc-federation.js";

const usage = `Usage:
  madi compile <source.step> --output <directory> [options]
  madi compile-ifc --document <discipline=source.ifc>... --output <directory> [options]

STEP options:
  --python <executable>          Python environment containing CadQuery/OCP
  --linear-tolerance <mm>        Tessellation tolerance (default: 0.15)
  --angular-tolerance <radians>  Angular tolerance (default: 0.15)

IFC options:
  --document <name=path.ifc>     Repeat once per federation discipline
  --uri-hint <name=value>        Optional non-sensitive source label
  --python <executable>          Python environment containing IfcOpenShell
  --threads <count>              Geometry iterator threads (default: up to 8)
  --retain-scene-ir              Keep the large intermediate under output

General options:
  --help                         Show this help`;

interface CompileArguments {
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly pythonExecutable?: string;
  readonly linearTolerance?: number;
  readonly angularTolerance?: number;
}

interface IfcCompileArguments {
  readonly documents: readonly {
    readonly discipline: string;
    readonly sourcePath: string;
    readonly uriHint?: string;
  }[];
  readonly outputDirectory: string;
  readonly pythonExecutable?: string;
  readonly threads?: number;
  readonly retainSceneIr: boolean;
}

function optionValue(arguments_: string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${option} requires a value.`);
  return value;
}

function numericOption(value: string, option: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new TypeError(`${option} requires a positive number.`);
  }
  return result;
}

function integerOption(value: string, option: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new TypeError(`${option} requires a positive integer.`);
  }
  return result;
}

function keyValueOption(value: string, option: string): readonly [string, string] {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new TypeError(`${option} requires a name=value pair.`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseCompileArguments(arguments_: string[]): CompileArguments {
  const sourcePath = arguments_[0];
  if (!sourcePath || sourcePath.startsWith("--")) throw new TypeError(usage);
  let outputDirectory: string | undefined;
  let pythonExecutable: string | undefined;
  let linearTolerance: number | undefined;
  let angularTolerance: number | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === "--output") {
      outputDirectory = optionValue(arguments_, index, option);
      index += 1;
    } else if (option === "--python") {
      pythonExecutable = optionValue(arguments_, index, option);
      index += 1;
    } else if (option === "--linear-tolerance") {
      linearTolerance = numericOption(optionValue(arguments_, index, option), option);
      index += 1;
    } else if (option === "--angular-tolerance") {
      angularTolerance = numericOption(optionValue(arguments_, index, option), option);
      index += 1;
    } else {
      throw new TypeError(`Unknown option ${String(option)}.\n\n${usage}`);
    }
  }
  if (!outputDirectory) throw new TypeError(`--output is required.\n\n${usage}`);
  return {
    sourcePath,
    outputDirectory,
    ...(pythonExecutable ? { pythonExecutable } : {}),
    ...(linearTolerance === undefined ? {} : { linearTolerance }),
    ...(angularTolerance === undefined ? {} : { angularTolerance }),
  };
}

function parseIfcCompileArguments(arguments_: string[]): IfcCompileArguments {
  const documents = new Map<string, { sourcePath: string; uriHint?: string }>();
  const uriHints = new Map<string, string>();
  let outputDirectory: string | undefined;
  let pythonExecutable: string | undefined;
  let threads: number | undefined;
  let retainSceneIr = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === "--document") {
      const [discipline, sourcePath] = keyValueOption(
        optionValue(arguments_, index, option),
        option,
      );
      if (documents.has(discipline)) {
        throw new TypeError(`Duplicate IFC discipline ${discipline}.`);
      }
      documents.set(discipline, { sourcePath });
      index += 1;
    } else if (option === "--uri-hint") {
      const [discipline, uriHint] = keyValueOption(
        optionValue(arguments_, index, option),
        option,
      );
      if (uriHints.has(discipline)) {
        throw new TypeError(`Duplicate IFC URI hint ${discipline}.`);
      }
      uriHints.set(discipline, uriHint);
      index += 1;
    } else if (option === "--output") {
      outputDirectory = optionValue(arguments_, index, option);
      index += 1;
    } else if (option === "--python") {
      pythonExecutable = optionValue(arguments_, index, option);
      index += 1;
    } else if (option === "--threads") {
      threads = integerOption(optionValue(arguments_, index, option), option);
      index += 1;
    } else if (option === "--retain-scene-ir") {
      retainSceneIr = true;
    } else {
      throw new TypeError(`Unknown option ${String(option)}.\n\n${usage}`);
    }
  }
  if (documents.size === 0) throw new TypeError(`--document is required.\n\n${usage}`);
  if (!outputDirectory) throw new TypeError(`--output is required.\n\n${usage}`);
  for (const discipline of uriHints.keys()) {
    if (!documents.has(discipline)) {
      throw new TypeError(`URI hint ${discipline} has no matching IFC document.`);
    }
  }
  return {
    documents: [...documents.entries()].map(([discipline, document]) => ({
      discipline,
      sourcePath: document.sourcePath,
      ...(uriHints.has(discipline) ? { uriHint: uriHints.get(discipline) } : {}),
    })),
    outputDirectory,
    ...(pythonExecutable ? { pythonExecutable } : {}),
    ...(threads === undefined ? {} : { threads }),
    retainSceneIr,
  };
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0 || arguments_.includes("--help")) {
    console.log(usage);
    process.exitCode = arguments_.includes("--help") ? 0 : 1;
    return;
  }
  if (arguments_[0] === "compile") {
    const result = await compileStepFile(parseCompileArguments(arguments_.slice(1)));
    console.log(
      `[madi] ${result.source.schema} ${result.source.displayName} ` +
        `(${result.source.sha256.slice(0, 12)})`,
    );
    console.log(
      `[madi] wrote ${result.report.counts.compiledPrototypeCount} shared meshes, ` +
        `${result.report.counts.renderableOccurrenceCount} renderable occurrences, ` +
        `${result.report.counts.triangleCount.toLocaleString("en-US")} triangles`,
    );
    console.log(`[madi] package ${result.report.output.packageDigest}`);
    console.log(`[madi] output: ${result.outputDirectory}`);
    return;
  }
  if (arguments_[0] === "compile-ifc") {
    const result = await compileIfcFederation(
      parseIfcCompileArguments(arguments_.slice(1)),
    );
    console.log(
      `[madi] IFC federation ${result.sources.map(({ discipline }) => discipline).join(", ")}`,
    );
    console.log(
      `[madi] wrote ${result.report.counts.compiledPrototypeCount} shared meshes, ` +
        `${result.report.counts.renderableOccurrenceCount} renderable occurrences, ` +
        `${result.report.counts.triangleCount.toLocaleString("en-US")} unique triangles`,
    );
    console.log(`[madi] package ${result.report.output.packageDigest}`);
    console.log(`[madi] output: ${result.outputDirectory}`);
    return;
  }
  throw new TypeError(`Unknown command ${String(arguments_[0])}.\n\n${usage}`);
}

try {
  await main();
} catch (error) {
  console.error(`[madi] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
