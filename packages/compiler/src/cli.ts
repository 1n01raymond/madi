#!/usr/bin/env node

import {
  parseCompileArguments,
  parseIfcCompileArguments,
  usage,
} from "./cli-arguments.js";
import { compileStepFile } from "./step-compiler.js";
import { compileIfcFederation } from "./ifc-federation.js";

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
      `[naru] ${result.source.schema} ${result.source.displayName} ` +
        `(${result.source.sha256.slice(0, 12)})`,
    );
    console.log(
      `[naru] wrote ${result.report.counts.compiledPrototypeCount} shared meshes, ` +
        `${result.report.counts.renderableOccurrenceCount} renderable occurrences, ` +
        `${result.report.counts.triangleCount.toLocaleString("en-US")} triangles`,
    );
    console.log(`[naru] package ${result.report.output.packageDigest}`);
    if (result.cache.status !== "disabled") {
      console.log(`[naru] cache ${result.cache.status}: ${String(result.cache.key)}`);
    }
    console.log(`[naru] output: ${result.outputDirectory}`);
    return;
  }
  if (arguments_[0] === "compile-ifc") {
    const result = await compileIfcFederation(
      parseIfcCompileArguments(arguments_.slice(1)),
    );
    console.log(
      `[naru] IFC federation ${result.sources.map(({ discipline }) => discipline).join(", ")}`,
    );
    console.log(
      `[naru] wrote ${result.report.counts.compiledPrototypeCount} shared meshes, ` +
        `${result.report.counts.renderableOccurrenceCount} renderable occurrences, ` +
        `${result.report.counts.triangleCount.toLocaleString("en-US")} unique triangles`,
    );
    console.log(`[naru] package ${result.report.output.packageDigest}`);
    if (result.cache.status !== "disabled") {
      console.log(`[naru] cache ${result.cache.status}: ${String(result.cache.key)}`);
    }
    console.log(`[naru] output: ${result.outputDirectory}`);
    return;
  }
  throw new TypeError(`Unknown command ${String(arguments_[0])}.\n\n${usage}`);
}

try {
  await main();
} catch (error) {
  console.error(`[naru] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
