import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  decodeCompiledGltf,
  inspectCompiledHierarchy,
} from "../src/index.js";
import type { CompiledGltfError } from "../src/index.js";

const gltfUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners/scene.gltf",
  import.meta.url,
);
const binaryUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners/scene.bin",
  import.meta.url,
);

async function loadPackage(): Promise<{ json: unknown; binary: ArrayBuffer }> {
  const [json, bytes] = await Promise.all([
    readFile(gltfUrl, "utf8").then(JSON.parse),
    readFile(binaryUrl),
  ]);
  return {
    json,
    binary: Uint8Array.from(bytes).buffer,
  };
}

describe("compiled glTF runtime boundary", () => {
  it("opens hierarchy and source identity before binary geometry is available", async () => {
    const { json } = await loadPackage();
    const { hierarchy } = inspectCompiledHierarchy(json);

    expect(hierarchy.profile).toBe("madi.experimental.gltf.1");
    expect(hierarchy.sourceFormat).toBe("AP214");
    expect(hierarchy.binaryUri).toBe("scene.bin");
    expect(hierarchy.binaryByteLength).toBe(188_044);
    expect(hierarchy.entries).toHaveLength(12);
    expect(hierarchy.renderableOccurrences).toBe(10);
    expect(hierarchy.sharedMeshes).toBe(3);
    expect(hierarchy.entries.find(({ name }) => name === "fastener-03")).toMatchObject({
      depth: 2,
      renderable: true,
      occurrenceId: "occurrence:madi-repeated-fasteners/fastener-bank/fastener-03",
      prototypeId: "prototype:part:fastener-01",
    });
  });

  it("decodes shared meshes, explicit CAD edges, transforms, and pick evidence", async () => {
    const { json, binary } = await loadPackage();
    const decoded = decodeCompiledGltf(json, binary);

    expect(decoded.gpuScene.batches).toHaveLength(3);
    expect(decoded.summary).toEqual({
      prototypeBatches: 3,
      partOccurrences: 10,
      triangles: 2076,
      edgeSegments: 181,
      binaryBytes: 188_044,
    });
    expect(
      Math.max(...decoded.gpuScene.batches.map(({ instances }) => instances.length)),
    ).toBe(8);
    expect(decoded.bounds.min).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(decoded.bounds.min[0]).toBeCloseTo(-0.048, 5);
    expect(decoded.bounds.min[1]).toBeCloseTo(0, 5);
    expect(decoded.bounds.min[2]).toBeCloseTo(-0.028, 5);
    expect(decoded.bounds.max[0]).toBeCloseTo(0.048, 5);
    expect(decoded.bounds.max[1]).toBeCloseTo(0.022, 5);
    expect(decoded.bounds.max[2]).toBeCloseTo(0.028, 5);
    expect(decoded.objectEvidence.find(({ label }) => label === "center-rail")).toMatchObject({
      objectId: 3,
      nodeIndex: 2,
      prototypeId: "prototype:part:center-rail",
    });
    expect(
      decoded.objectEvidence.find(({ label }) => label === "center-rail")?.edgeSourceRefs,
    ).toHaveLength(12);
  });

  it("rejects a truncated binary before exposing GPU buffers", async () => {
    const { json, binary } = await loadPackage();

    expect(() => decodeCompiledGltf(json, binary.slice(0, binary.byteLength - 4))).toThrowError(
      expect.objectContaining<Partial<CompiledGltfError>>({ code: "INVALID_BINARY" }),
    );
  });

  it("rejects unrecognized MADI extras profiles", async () => {
    const { json } = await loadPackage();
    const copy = structuredClone(json) as {
      extras: { madi: { profile: string } };
    };
    copy.extras.madi.profile = "madi.future.unknown";

    expect(() => inspectCompiledHierarchy(copy)).toThrowError(
      expect.objectContaining<Partial<CompiledGltfError>>({ code: "UNSUPPORTED_PROFILE" }),
    );
  });
});
