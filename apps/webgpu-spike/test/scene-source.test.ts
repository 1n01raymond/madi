import { describe, expect, it } from "vitest";

import type { CompiledHierarchy } from "@madi/runtime-webgpu";

import {
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

  it("selects one local glTF and binary independent of order", () => {
    const gltf = new File(["{}"], "scene.gltf");
    const binary = new File([new Uint8Array(4)], "scene.bin");

    expect(selectLocalSceneFiles([binary, gltf])).toEqual({
      kind: "local",
      gltfFile: gltf,
      binaryFile: binary,
    });
    expect(() => selectLocalSceneFiles([gltf])).toThrow(/exactly one/u);
    expect(() => selectLocalSceneFiles([gltf, binary, new File([""], "report.json")])).toThrow(
      /exactly one/u,
    );
  });

  it("checks local binary identity and declared byte length", () => {
    expect(() => validateLocalBinary(hierarchy, { name: "scene.bin", size: 4 })).not.toThrow();
    expect(() => validateLocalBinary(hierarchy, { name: "other.bin", size: 4 })).toThrow(
      /expects scene.bin/u,
    );
    expect(() => validateLocalBinary(hierarchy, { name: "scene.bin", size: 3 })).toThrow(
      /must be 4 bytes/u,
    );
  });
});
