import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompiledHierarchy } from "@naru3d/runtime-webgpu";

import {
  loadSceneHierarchy,
  parseSceneUrl,
  selectLocalSceneFiles,
  validateLocalBinary,
} from "../src/scene-source.js";

const hierarchy = {
  binaryUri: "geometry/scene.bin",
  binaryByteLength: 4,
} as CompiledHierarchy;

describe("compiled scene sources", () => {
  it("resolves relative HTTP URLs and rejects unsupported protocols", () => {
    expect(parseSceneUrl("../package/scene.gltf", "https://example.com/viewer/").href).toBe(
      "https://example.com/package/scene.gltf",
    );
    expect(() => parseSceneUrl("file:///tmp/scene.gltf", "https://example.com/")).toThrow(
      /HTTP or HTTPS/u,
    );
    expect(() => parseSceneUrl(" ", "https://example.com/")).toThrow(/Enter a compiled/u);
  });

  it("selects one local glTF plus its binary and sidecar resources", () => {
    const gltf = new File(["{}"], "scene.gltf");
    const binary = new File([new Uint8Array(4)], "scene.bin");

    expect(selectLocalSceneFiles([binary, gltf])).toEqual({
      kind: "local",
      gltfFile: gltf,
      binaryFiles: [binary],
      sidecarFiles: [],
    });
    expect(() => selectLocalSceneFiles([gltf])).toThrow(/exactly one/u);
    expect(() => selectLocalSceneFiles([gltf, binary, new File([""], "scene.step")])).toThrow(
      /exactly one/u,
    );
    const coarse = new File([new Uint8Array(8)], "coarse.bin");
    const sidecarJson = new File(["{}"], "properties.json");
    const sidecarColumns = new File([new Uint8Array(8)], "properties.bin");
    expect(selectLocalSceneFiles([coarse, sidecarJson, gltf, sidecarColumns, binary])).toEqual({
      kind: "local",
      gltfFile: gltf,
      binaryFiles: [coarse, sidecarColumns, binary],
      sidecarFiles: [sidecarJson],
    });
  });

  it("checks local binary identity and declared byte length", () => {
    expect(() => validateLocalBinary(hierarchy, { name: "scene.bin", size: 4 })).not.toThrow();
    expect(() => validateLocalBinary(hierarchy, { name: "other.bin", size: 4 })).toThrow(
      /expects scene.bin/u,
    );
    expect(() => validateLocalBinary(hierarchy, { name: "scene.bin", size: 3 })).toThrow(
      /must be 4 bytes/u,
    );
    const progressiveHierarchy = {
      ...hierarchy,
      coarseBinaryUri: "geometry/coarse.bin",
      coarseBinaryByteLength: 8,
    } as CompiledHierarchy;
    expect(() =>
      validateLocalBinary(progressiveHierarchy, { name: "coarse.bin", size: 8 }, "coarse"),
    ).not.toThrow();
  });
});

const fixtureUrl = new URL("https://example.com/package/scene.gltf");

function stubDocument(document: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(document), {
          headers: { "Content-Type": "model/gltf+json" },
        }),
    ),
  );
}

describe("remote scene packages", () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../artifacts/phase1/repeated-fasteners/scene.gltf", import.meta.url)),
      "utf8",
    ),
  ) as { buffers: { uri: string; byteLength: number }[] };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves package resources against the document it loaded", async () => {
    stubDocument(fixture);

    const loaded = await loadSceneHierarchy({ kind: "url", gltfUrl: fixtureUrl });

    expect(loaded.targetBinary).toEqual({
      kind: "url",
      href: "https://example.com/package/scene.bin",
    });
    expect(loaded.hierarchy.binaryByteLength).toBe(188_044);
  });

  it("refuses a package that points its buffer at another origin", async () => {
    stubDocument({
      ...fixture,
      buffers: [{ ...fixture.buffers[0], uri: "https://attacker.example/scene.bin" }],
    });

    await expect(loadSceneHierarchy({ kind: "url", gltfUrl: fixtureUrl })).rejects.toThrow(
      /must stay on https:\/\/example\.com/u,
    );
  });

  it("refuses a package whose declared resources exceed the reviewed budget", async () => {
    stubDocument(fixture);

    await expect(
      loadSceneHierarchy({ kind: "url", gltfUrl: fixtureUrl }, undefined, {
        packageBytes: 60_000,
      }),
    ).rejects.toThrow(/more than 60000 bytes/u);
  });

  // The stub declares no Content-Length, so this exercises the streaming
  // ceiling rather than the declared-length pre-check.
  it("stops reading a document that runs past the reviewed limit", async () => {
    stubDocument(fixture);

    await expect(
      loadSceneHierarchy({ kind: "url", gltfUrl: fixtureUrl }, undefined, {
        documentBytes: 1_024,
      }),
    ).rejects.toThrow(/scene\.gltf is larger than 1024 bytes/u);
  });
});
