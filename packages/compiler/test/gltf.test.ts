import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  compileSceneToGltf,
  experimentalGltfProfile,
  validateCompiledGltf,
} from "../src/index.js";
import { hydratePhase0Evidence } from "../src/evidence-input.js";

const evidenceUrl = new URL(
  "../../../artifacts/occt/repeated-fasteners.scene.json",
  import.meta.url,
);
const compiledArtifactUrl = new URL(
  "../../../artifacts/phase1/repeated-fasteners/",
  import.meta.url,
);

async function compileEvidence(options: Parameters<typeof compileSceneToGltf>[1] = {}) {
  const serialized = JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown;
  return compileSceneToGltf(hydratePhase0Evidence(serialized), options);
}

function madiExtras(value: { readonly extras?: Readonly<Record<string, unknown>> }) {
  return value.extras?.madi as Record<string, unknown> | undefined;
}

describe("Phase 1 glTF compiler slice", () => {
  it("compiles OCCT evidence into a validator-clean standards-first package", async () => {
    const compiled = await compileEvidence();
    const validation = validateCompiledGltf(compiled.document, compiled.binary);

    expect(validation).toEqual({ ok: true, issues: [] });
    expect(compiled.document.asset.version).toBe("2.0");
    expect((compiled.document.extras.madi as Record<string, unknown>).profile).toBe(
      experimentalGltfProfile,
    );
    expect(compiled.document.buffers).toEqual([
      { uri: "scene.bin", byteLength: compiled.binary.byteLength },
    ]);
    expect(compiled.report.counts).toMatchObject({
      compiledPrototypeCount: 3,
      occurrenceCount: 12,
      renderableOccurrenceCount: 10,
      gltfNodeCount: 13,
      gltfMeshCount: 3,
      triangleCount: 2076,
      edgeSegmentCount: 181,
    });
  });

  it("preserves authored hierarchy, explicit edges, and fastener mesh reuse", async () => {
    const compiled = await compileEvidence();
    const fasteners = compiled.document.nodes.filter(
      (node) => madiExtras(node)?.prototypeId === "prototype:part:fastener-01",
    );

    expect(compiled.document.scenes[0].nodes).toEqual([0]);
    expect(compiled.document.nodes[0]?.children).toHaveLength(1);
    expect(fasteners).toHaveLength(8);
    expect(new Set(fasteners.map(({ mesh }) => mesh))).toHaveLength(1);
    const fastenerMesh = compiled.document.meshes[fasteners[0]?.mesh ?? -1];
    expect(fastenerMesh?.primitives.map(({ mode }) => mode)).toEqual([4, 1]);
    expect(madiExtras(fastenerMesh ?? { primitives: [] })).toMatchObject({
      prototypeId: "prototype:part:fastener-01",
    });
    expect(madiExtras(fastenerMesh?.primitives[1] ?? { attributes: {}, mode: 1 })).toMatchObject({
      kind: "explicit-cad-edges",
    });
  });

  it("produces byte-identical output for identical inputs and options", async () => {
    const first = await compileEvidence();
    const second = await compileEvidence();

    expect(second.json).toBe(first.json);
    expect(second.binary).toEqual(first.binary);
    expect(second.report).toEqual(first.report);
  });

  it("emits deterministic prototype bounds in a separate standard glTF buffer", async () => {
    const serialized = JSON.parse(await readFile(evidenceUrl, "utf8")) as unknown;
    const compiled = compileSceneToGltf(hydratePhase0Evidence(serialized), {
      coarseBounds: true,
    });
    expect(compiled.coarseBinary).toBeDefined();
    const validation = validateCompiledGltf(compiled.document, [
      compiled.binary,
      compiled.coarseBinary ?? new Uint8Array(),
    ]);

    expect(validation).toEqual({ ok: true, issues: [] });
    expect(compiled.document.buffers).toEqual([
      { uri: "scene.bin", byteLength: compiled.binary.byteLength },
      { uri: "coarse.bin", byteLength: compiled.coarseBinary?.byteLength },
    ]);
    expect(compiled.document.bufferViews.some(({ buffer }) => buffer === 0)).toBe(true);
    expect(compiled.document.bufferViews.some(({ buffer }) => buffer === 1)).toBe(true);
    expect(compiled.document.nodes.filter((node) => madiExtras(node)?.coarseMesh !== undefined))
      .toHaveLength(10);
    expect(compiled.report.options).toMatchObject({
      coarseBinaryUri: "coarse.bin",
      progressiveRepresentation: "prototype-aabb-v1",
      targetChunking: "prototype-range-v1",
    });
    const progressive = (compiled.document.extras.madi as {
      progressive: { targetChunks: readonly { byteOffset: number; byteLength: number }[] };
    }).progressive;
    expect(progressive.targetChunks).toHaveLength(3);
    expect(
      progressive.targetChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    ).toBe(compiled.binary.byteLength);
    expect(compiled.report.counts.targetChunkCount).toBe(3);
  });

  it("coalesces adjacent target prototype ranges when a request budget is declared", async () => {
    const compiled = await compileEvidence({
      coarseBounds: true,
      targetChunkByteBudget: 100_000,
    });
    const progressive = (compiled.document.extras.madi as {
      progressive: {
        targetChunks: readonly {
          byteOffset: number;
          byteLength: number;
          prototypeId: string;
          prototypeIds: readonly string[];
        }[];
      };
    }).progressive;

    expect(compiled.report.options).toMatchObject({
      targetChunking: "coalesced-prototype-range-v1",
      targetChunkByteBudget: 100_000,
    });
    expect(progressive.targetChunks).toHaveLength(2);
    expect(progressive.targetChunks[0]).toMatchObject({
      prototypeId: "prototype:part:center-rail",
      prototypeIds: ["prototype:part:center-rail", "prototype:part:fastener-01"],
    });
    expect(
      progressive.targetChunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    ).toBe(compiled.binary.byteLength);
    expect(compiled.report.counts.targetChunkCount).toBe(2);
  });

  it("reproduces the committed compiler artifact byte for byte", async () => {
    const compiled = await compileEvidence();
    const [json, binary, report] = await Promise.all([
      readFile(new URL("scene.gltf", compiledArtifactUrl), "utf8"),
      readFile(new URL("scene.bin", compiledArtifactUrl)),
      readFile(new URL("build-report.json", compiledArtifactUrl), "utf8").then(JSON.parse),
    ]);

    expect(compiled.json).toBe(json);
    expect(Buffer.from(compiled.binary)).toEqual(binary);
    expect(compiled.report).toEqual(report);
  });

  it("rejects a binary resource whose size differs from the glTF declaration", async () => {
    const compiled = await compileEvidence();
    const validation = validateCompiledGltf(
      compiled.document,
      compiled.binary.subarray(0, compiled.binary.byteLength - 4),
    );

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: "BUFFER_LENGTH", path: "buffers[0]" }),
    );
  });
});
