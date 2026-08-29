import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRepeatedTriangleScene } from "@naru3d/scene-ir";
import type { Representation } from "@naru3d/scene-ir";
import { describe, expect, it } from "vitest";

import {
  buildCompiledPayload,
  compiledPayloadContentDigest,
} from "../src/compiled-payload.js";
import {
  compiledPayloadEntrySchema,
  createCompiledPayloadKey,
  publishCompiledPayload,
  readCompiledPayloadEntry,
  restoreCompiledPayload,
} from "../src/compiled-payload-store.js";
import type { CompiledPayloadKeyInput } from "../src/compiled-payload-store.js";

function triangleRepresentation(): Representation {
  const representation = createRepeatedTriangleScene().representations[0];
  if (!representation) throw new TypeError("Triangle fixture is incomplete.");
  return representation;
}

const input: CompiledPayloadKeyInput = {
  compiler: { name: "@naru3d/compiler", version: "0.0.0+cache.1" },
  adapter: { name: "IfcOpenShell", version: "0.8.5" },
  content: compiledPayloadContentDigest(triangleRepresentation()),
  scaleToMeters: 1,
  options: { omitResourceNames: false },
};

async function withStore<T>(run: (storeDirectory: string) => Promise<T>): Promise<T> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "naru-payload-test-"));
  try {
    return await run(join(temporaryDirectory, "payloads"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

describe("compiled payload store", () => {
  it("derives a key from content and payload-affecting options only", () => {
    const key = createCompiledPayloadKey(input);

    expect(createCompiledPayloadKey({ ...input, options: { omitResourceNames: false } })).toBe(key);
    expect(createCompiledPayloadKey({ ...input, scaleToMeters: 0.001 })).not.toBe(key);
    expect(
      createCompiledPayloadKey({ ...input, options: { omitResourceNames: true } }),
    ).not.toBe(key);
    expect(
      createCompiledPayloadKey({ ...input, compiler: { ...input.compiler, version: "next" } }),
    ).not.toBe(key);
    expect(() => createCompiledPayloadKey({ ...input, scaleToMeters: 0 })).toThrow(/positive/u);
  });

  it("restores a payload that equals the one it published", async () => {
    await withStore(async (storeDirectory) => {
      const payload = buildCompiledPayload(triangleRepresentation(), 1);
      const entry = await publishCompiledPayload({ storeDirectory, input, payload });
      const restored = await restoreCompiledPayload({ storeDirectory, key: entry.key });

      expect(entry.key).toBe(createCompiledPayloadKey(input));
      expect(restored).toBeDefined();
      expect(restored?.shape).toEqual(payload.shape);
      expect(restored?.triangles).toBe(payload.triangles);
      expect(restored?.edges).toBe(payload.edges);
      expect(restored?.accessors.map(({ bytes: _restored, ...meta }) => meta)).toEqual(
        payload.accessors.map(({ bytes: _built, ...meta }) => meta),
      );
      for (const [index, accessor] of payload.accessors.entries()) {
        expect(restored?.accessors[index]?.bytes).toEqual(accessor.bytes);
      }
    });
  });

  it("reports a miss for a key it never published", async () => {
    await withStore(async (storeDirectory) => {
      const key = createCompiledPayloadKey({ ...input, scaleToMeters: 0.001 });

      expect(await readCompiledPayloadEntry(storeDirectory, key)).toBeUndefined();
      expect(await restoreCompiledPayload({ storeDirectory, key })).toBeUndefined();
      await expect(restoreCompiledPayload({ storeDirectory, key: "../escape" })).rejects.toThrow(
        /SHA-256/u,
      );
    });
  });

  it("refuses an entry whose bytes or manifest no longer match the key", async () => {
    await withStore(async (storeDirectory) => {
      const payload = buildCompiledPayload(triangleRepresentation(), 1);
      const { key } = await publishCompiledPayload({ storeDirectory, input, payload });
      const entryDirectory = join(storeDirectory, compiledPayloadEntrySchema, key);
      const binaryPath = join(entryDirectory, "payload.bin");
      const original = await readFile(binaryPath);
      const tampered = Uint8Array.from(original);
      tampered[0] = (tampered[0] ?? 0) ^ 0xff;

      await writeFile(binaryPath, tampered);
      await expect(restoreCompiledPayload({ storeDirectory, key })).rejects.toMatchObject({
        code: "INVALID_PAYLOAD_ENTRY",
      });

      // A manifest edited to describe the tampered bytes still fails: the key
      // is reproduced from the inputs the manifest carries, and the digest the
      // store addresses by is one of them.
      await writeFile(binaryPath, original);
      const manifestPath = join(entryDirectory, "payload.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        binary: { sha256: string };
        input: { content: string };
      };
      manifest.binary.sha256 = createHash("sha256").update(tampered).digest("hex");
      manifest.input.content = createHash("sha256").update("other").digest("hex");
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(restoreCompiledPayload({ storeDirectory, key })).rejects.toMatchObject({
        code: "INVALID_PAYLOAD_ENTRY",
      });
    });
  });

  it("refuses a payload binary that is a symlink rather than a file", async () => {
    await withStore(async (storeDirectory) => {
      const payload = buildCompiledPayload(triangleRepresentation(), 1);
      const { key } = await publishCompiledPayload({ storeDirectory, input, payload });
      const entryDirectory = join(storeDirectory, compiledPayloadEntrySchema, key);
      const binaryPath = join(entryDirectory, "payload.bin");
      const target = join(entryDirectory, "elsewhere.bin");
      await rename(binaryPath, target);
      try {
        await symlink(target, binaryPath, "file");
      } catch {
        // Unprivileged Windows cannot create one; the guard is unexercised here.
        return;
      }
      await expect(restoreCompiledPayload({ storeDirectory, key })).rejects.toThrow(/must be a file/u);
    });
  });

  it("publishes idempotently and refuses a key that would describe other bytes", async () => {
    await withStore(async (storeDirectory) => {
      const payload = buildCompiledPayload(triangleRepresentation(), 1);
      const first = await publishCompiledPayload({ storeDirectory, input, payload });
      const again = await publishCompiledPayload({ storeDirectory, input, payload });

      expect(again).toEqual(first);
      // Same key, different bytes: the key is missing an input, so the store
      // refuses rather than serving whichever payload landed first.
      await expect(
        publishCompiledPayload({
          storeDirectory,
          input,
          payload: buildCompiledPayload(triangleRepresentation(), 0.5),
        }),
      ).rejects.toMatchObject({ code: "AMBIGUOUS_PAYLOAD" });
    });
  });
});
