import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ids } from "@naru3d/scene-ir";
import { describe, expect, it } from "vitest";

import {
  CompiledPayloadCache,
  layoutAffectingCompileOptions,
  payloadKeyOptions,
} from "../src/compiled-payload-cache.js";
import { compiledPayloadEntrySchema } from "../src/compiled-payload-store.js";
import { compileSceneToGltf } from "../src/index.js";
import { hydratePhase0Evidence } from "../src/evidence-input.js";
import type { CompileGltfOptions } from "../src/types.js";

const evidenceUrl = new URL(
  "../../../artifacts/occt/repeated-fasteners.scene.json",
  import.meta.url,
);

async function evidenceScene() {
  return hydratePhase0Evidence(JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown);
}

const identity = {
  compiler: { name: "@naru3d/compiler", version: "0.0.0+test" },
  adapter: { name: "OCCT", version: "7.8+test" },
} as const;

async function withStore<T>(run: (storeDirectory: string) => Promise<T>): Promise<T> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-payload-cache-"));
  try {
    return await run(join(temporaryDirectory, "payloads"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function cacheFor(storeDirectory: string, compileOptions: CompileGltfOptions = {}) {
  const warnings: string[] = [];
  const cache = new CompiledPayloadCache({
    storeDirectory,
    ...identity,
    compileOptions,
    warn: (message) => warnings.push(message),
  });
  return { cache, warnings };
}

/** Entry directories under the store, so a test can tamper with one. */
async function entryDirectories(storeDirectory: string): Promise<readonly string[]> {
  const namespace = join(storeDirectory, compiledPayloadEntrySchema);
  return (await readdir(namespace)).map((entry) => join(namespace, entry));
}

describe("payload key classification", () => {
  it("classifies every compile option the packager accepts", () => {
    // Typed as Required so a new option that nobody classified fails to compile
    // here rather than silently entering -- or silently skipping -- the key.
    const everyOption: Required<CompileGltfOptions> = {
      binaryUri: "scene.bin",
      coarseBounds: true,
      coarseBinaryUri: "coarse.bin",
      generator: "naru",
      compactJson: true,
      omitResourceNames: true,
      elideDerivedIdentifiers: true,
      omitDefaultNodeTransforms: true,
      targetChunkByteBudget: 512 * 1024,
      spatialPayloadOrder: true,
      spatialIndex: true,
      spatialBinaryUri: "spatial.bin",
      spatialLeafCapacity: 64,
      propertyColumns: new Uint8Array([1, 2, 3]),
      propertiesUri: "properties.json",
      propertiesBinaryUri: "properties.bin",
      relocateHierarchyNodes: true,
      hierarchyUri: "hierarchy.json",
      hierarchyBinaryUri: "hierarchy.bin",
      payloadSource: { payloadFor: () => { throw new TypeError("unused"); } },
    };

    expect(payloadKeyOptions(everyOption)).toEqual({});
    expect(Object.keys(everyOption).sort()).toEqual(
      Object.keys(layoutAffectingCompileOptions).sort(),
    );
  });

  it("keys an option it does not recognize and refuses one it cannot describe", () => {
    expect(payloadKeyOptions({ futureOption: 3 } as CompileGltfOptions)).toEqual({
      "unclassified:futureOption": "3",
    });
    expect(payloadKeyOptions({ futureOption: undefined } as CompileGltfOptions)).toEqual({});
    expect(() =>
      payloadKeyOptions({ futureOption: () => 1 } as unknown as CompileGltfOptions),
    ).toThrow(/not classified/u);
  });
});

describe("compiled payload cache", () => {
  it("misses cold, hits warm, and packages identical bytes either way", async () => {
    await withStore(async (storeDirectory) => {
      const scene = await evidenceScene();
      const direct = compileSceneToGltf(scene);
      const prototypes = direct.report.counts.compiledPrototypeCount;

      const cold = cacheFor(storeDirectory);
      const first = compileSceneToGltf(scene, { payloadSource: cold.cache });
      const warm = cacheFor(storeDirectory);
      const second = compileSceneToGltf(scene, { payloadSource: warm.cache });

      // ADR-0018 gate 1, in miniature: a restored payload is the same value the
      // encoder would have built, so every byte the package publishes matches.
      expect(first.binary).toEqual(direct.binary);
      expect(second.binary).toEqual(direct.binary);
      expect(first.json.sha256).toBe(direct.json.sha256);
      expect(second.report.output.packageDigest).toBe(direct.report.output.packageDigest);

      expect(cold.cache.report()).toMatchObject({
        store: compiledPayloadEntrySchema,
        prototypes,
        hits: 0,
        misses: prototypes,
        published: prototypes,
        outcomes: { hit: 0, absent: prototypes, "corrupt-entry": 0, "restore-failed": 0 },
        publishFailures: 0,
        degraded: [],
      });
      expect(warm.cache.report()).toMatchObject({
        prototypes,
        hits: prototypes,
        misses: 0,
        published: 0,
        publishFailures: 0,
        degraded: [],
      });
      expect(cold.warnings).toEqual([]);
      expect(warm.warnings).toEqual([]);
      // The report is telemetry about the run, so it rides in the build report.
      expect(second.report.compiledPayloadCache?.hits).toBe(prototypes);
      expect(direct.report.compiledPayloadCache).toBeUndefined();
    });
  });

  it("reuses across a layout change and rebuilds across a toolchain change", async () => {
    await withStore(async (storeDirectory) => {
      const scene = await evidenceScene();
      compileSceneToGltf(scene, { payloadSource: cacheFor(storeDirectory).cache });

      // Layout options decide where a payload is placed, never what it holds.
      const relaid = cacheFor(storeDirectory, {
        compactJson: true,
        omitResourceNames: true,
        targetChunkByteBudget: 512 * 1024,
      });
      compileSceneToGltf(scene, {
        compactJson: true,
        omitResourceNames: true,
        targetChunkByteBudget: 512 * 1024,
        payloadSource: relaid.cache,
      });
      expect(relaid.cache.report().hits).toBe(relaid.cache.report().prototypes);

      // A different encoder identity is a different payload, by construction.
      const retooled = new CompiledPayloadCache({
        storeDirectory,
        compiler: { name: "@naru3d/compiler", version: "0.0.0+next" },
        adapter: identity.adapter,
        compileOptions: {},
        warn: () => undefined,
      });
      compileSceneToGltf(scene, { payloadSource: retooled });
      expect(retooled.report().hits).toBe(0);
      expect(retooled.report().outcomes.absent).toBe(retooled.report().prototypes);
    });
  });

  it("warns and rebuilds when a stored entry no longer verifies", async () => {
    await withStore(async (storeDirectory) => {
      const scene = await evidenceScene();
      const direct = compileSceneToGltf(scene);
      compileSceneToGltf(scene, { payloadSource: cacheFor(storeDirectory).cache });

      for (const directory of await entryDirectories(storeDirectory)) {
        const binaryPath = join(directory, "payload.bin");
        const original = new Uint8Array(await readFile(binaryPath));
        original[0] = (original[0] ?? 0) ^ 0xff;
        await writeFile(binaryPath, original);
      }

      const corrupt = cacheFor(storeDirectory);
      const rebuilt = compileSceneToGltf(scene, { payloadSource: corrupt.cache });
      const report = corrupt.cache.report();

      expect(rebuilt.report.output.packageDigest).toBe(direct.report.output.packageDigest);
      expect(report.hits).toBe(0);
      expect(report.outcomes["corrupt-entry"]).toBe(report.prototypes);
      // Republishing over a corrupt entry is refused rather than papered over:
      // the compile keeps its output, and the entry stays visibly broken.
      expect(report.publishFailures).toBe(report.prototypes);
      expect(report.degraded.map(({ outcome }) => outcome)).toContain("corrupt-entry");
      expect(corrupt.warnings.some((message) => /rebuilding\.$/u.test(message))).toBe(true);
    });
  });

  it("compiles without an entry when the store cannot be written to", async () => {
    await withStore(async (storeDirectory) => {
      const scene = await evidenceScene();
      const direct = compileSceneToGltf(scene);
      // A file where the store directory belongs: publishing fails for every
      // prototype, and the compile still produces the same package.
      await writeFile(storeDirectory, "not a directory");

      const blocked = cacheFor(storeDirectory);
      const compiled = compileSceneToGltf(scene, { payloadSource: blocked.cache });
      const report = blocked.cache.report();

      expect(compiled.report.output.packageDigest).toBe(direct.report.output.packageDigest);
      expect(report.hits).toBe(0);
      expect(report.published).toBe(0);
      expect(report.publishFailures).toBe(report.prototypes);
      expect(blocked.warnings[0]).toMatch(/kept without an entry\.$/u);
    });
  });

  it("counts every degraded prototype but names at most sixteen", async () => {
    await withStore(async (storeDirectory) => {
      const scene = await evidenceScene();
      const representation = scene.representations[0];
      if (!representation) throw new TypeError("Evidence scene has no representation.");
      await writeFile(storeDirectory, "not a directory");
      const { cache, warnings } = cacheFor(storeDirectory);

      for (let index = 0; index < 20; index += 1) {
        cache.payloadFor(ids.prototype(`prototype-${index}`), representation, 1);
      }
      const report = cache.report();

      expect(report.prototypes).toBe(20);
      expect(report.publishFailures).toBe(20);
      expect(report.degraded).toHaveLength(16);
      expect(warnings).toHaveLength(20);
    });
  });
});
