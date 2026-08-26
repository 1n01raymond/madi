import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCompiledCacheKey,
  publishCompiledCacheEntry,
  restoreCompiledCacheEntry,
} from "../src/compiled-cache.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

const input = {
  sources: [
    { scope: "structure", sha256: digest("structure") },
    { scope: "architecture", sha256: digest("architecture") },
  ],
  adapter: { name: "IfcOpenShell", version: "0.8.5" },
  compiler: { name: "@naru3d/compiler", version: "0.0.0+cache.1" },
  options: { targetChunkBytes: 524_288, coarseBounds: true },
} as const;

describe("compiled package cache", () => {
  it("derives a deterministic key from normalized source and option order", () => {
    const reordered = {
      ...input,
      sources: [...input.sources].reverse(),
      options: { coarseBounds: true, targetChunkBytes: 524_288 },
    };

    expect(createCompiledCacheKey(reordered)).toBe(createCompiledCacheKey(input));
    expect(
      createCompiledCacheKey({
        ...input,
        sources: [{ scope: "architecture", sha256: digest("changed") }],
      }),
    ).not.toBe(createCompiledCacheKey(input));
  });

  it("publishes and atomically restores a verified package", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-cache-test-"));
    try {
      const packageDirectory = join(temporaryDirectory, "package");
      const cacheDirectory = join(temporaryDirectory, "cache");
      const outputDirectory = join(temporaryDirectory, "restored");
      await mkdir(packageDirectory);
      await Promise.all([
        writeFile(join(packageDirectory, "scene.gltf"), "{\"asset\":{\"version\":\"2.0\"}}\n"),
        writeFile(join(packageDirectory, "scene.bin"), new Uint8Array([1, 2, 3, 4])),
      ]);
      const entry = await publishCompiledCacheEntry({
        cacheDirectory,
        packageDirectory,
        input,
        packageDigest: digest("package"),
        resourcePaths: ["scene.bin", "scene.gltf"],
      });

      expect(entry.key).toBe(createCompiledCacheKey(input));
      await expect(
        publishCompiledCacheEntry({
          cacheDirectory,
          packageDirectory,
          input,
          packageDigest: digest("package"),
          resourcePaths: ["scene.gltf", "scene.bin"],
        }),
      ).resolves.toEqual(entry);
      await expect(
        restoreCompiledCacheEntry({ cacheDirectory, key: entry.key, outputDirectory }),
      ).resolves.toEqual(entry);
      await expect(readFile(join(outputDirectory, "scene.bin"))).resolves.toEqual(
        Buffer.from([1, 2, 3, 4]),
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a corrupted entry before creating output", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-cache-corrupt-test-"));
    try {
      const packageDirectory = join(temporaryDirectory, "package");
      const cacheDirectory = join(temporaryDirectory, "cache");
      const outputDirectory = join(temporaryDirectory, "restored");
      await mkdir(packageDirectory);
      await writeFile(join(packageDirectory, "scene.gltf"), "original");
      const entry = await publishCompiledCacheEntry({
        cacheDirectory,
        packageDirectory,
        input,
        packageDigest: digest("package"),
        resourcePaths: ["scene.gltf"],
      });
      await writeFile(join(cacheDirectory, entry.key, "scene.gltf"), "corrupted");

      await expect(
        restoreCompiledCacheEntry({ cacheDirectory, key: entry.key, outputDirectory }),
      ).rejects.toThrow(/integrity verification/u);
      await expect(readFile(join(outputDirectory, "scene.gltf"))).rejects.toThrow();
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects different output published under the same input key", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-cache-identity-test-"));
    try {
      const packageDirectory = join(temporaryDirectory, "package");
      const cacheDirectory = join(temporaryDirectory, "cache");
      await mkdir(packageDirectory);
      await writeFile(join(packageDirectory, "scene.gltf"), "first");
      await publishCompiledCacheEntry({
        cacheDirectory,
        packageDirectory,
        input,
        packageDigest: digest("first-package"),
        resourcePaths: ["scene.gltf"],
      });
      await writeFile(join(packageDirectory, "scene.gltf"), "second");

      await expect(
        publishCompiledCacheEntry({
          cacheDirectory,
          packageDirectory,
          input,
          packageDigest: digest("second-package"),
          resourcePaths: ["scene.gltf"],
        }),
      ).rejects.toThrow(/different package output/u);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
