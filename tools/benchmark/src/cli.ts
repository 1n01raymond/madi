import { mkdir, writeFile } from "node:fs/promises";
import { hostname, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createRepeatedTriangleScene, validateScene } from "@naru3d/scene-ir";

import { summarize } from "./stats.js";

interface Arguments {
  readonly iterations: number;
  readonly out?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  let iterations = 1_000;
  let out: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--iterations") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError("--iterations must be a positive integer.");
      }
      iterations = value;
      index += 1;
    } else if (argument === "--out") {
      const value = args[index + 1];
      if (!value) throw new TypeError("--out requires a path.");
      out = value;
      index += 1;
    } else {
      throw new TypeError(`Unknown argument ${argument}.`);
    }
  }

  return out ? { iterations, out } : { iterations };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const scene = createRepeatedTriangleScene();
  const samples: number[] = [];

  for (let index = 0; index < options.iterations; index += 1) {
    const start = performance.now();
    const validation = validateScene(scene);
    samples.push(performance.now() - start);
    if (!validation.ok) {
      throw new Error(`Fixture validation failed: ${JSON.stringify(validation.issues)}`);
    }
  }

  const result = {
    schemaVersion: "0.1",
    scenario: "scene-ir-validation-smoke",
    commit: process.env.GITHUB_SHA ?? "working-tree",
    environment: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      node: process.version,
      logicalCpuCount: globalThis.navigator?.hardwareConcurrency ?? null,
      totalMemoryBytes: totalmem(),
    },
    source: {
      fixture: scene.sceneId,
      sourceDigest: scene.revision.sourceDigest,
      prototypes: scene.prototypes.length,
      occurrences: scene.occurrences.length,
    },
    compiledAsset: null,
    milestones: {},
    frameTimes: {},
    memory: {
      heapUsedBytes: process.memoryUsage().heapUsed,
    },
    quality: {
      validationIssues: 0,
    },
    metrics: {
      validation: summarize(samples),
    },
    notes: [
      "Bootstrap microbenchmark only; not a renderer performance claim.",
      "Run metadata is emitted so later regression gates can compare like-for-like environments.",
    ],
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.out) {
    const outputPath = resolve(options.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");
    console.log(`[benchmark] wrote ${outputPath}`);
  } else {
    process.stdout.write(json);
  }
}

await main();
