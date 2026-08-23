#!/usr/bin/env node

import { compileStepFile } from "./step-compiler.js";

const usage = `Usage:
  madi compile <source.step> --output <directory> [options]

Options:
  --python <executable>          Python environment containing CadQuery/OCP
  --linear-tolerance <mm>        Tessellation tolerance (default: 0.15)
  --angular-tolerance <radians>  Angular tolerance (default: 0.15)
  --help                         Show this help`;

interface CompileArguments {
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly pythonExecutable?: string;
  readonly linearTolerance?: number;
  readonly angularTolerance?: number;
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

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0 || arguments_.includes("--help")) {
    console.log(usage);
    process.exitCode = arguments_.includes("--help") ? 0 : 1;
    return;
  }
  if (arguments_[0] !== "compile") {
    throw new TypeError(`Unknown command ${String(arguments_[0])}.\n\n${usage}`);
  }
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
}

try {
  await main();
} catch (error) {
  console.error(`[madi] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
