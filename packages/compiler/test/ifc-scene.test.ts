import { describe, expect, it } from "vitest";

import { hydrateIfcSceneSplit } from "../src/ifc-scene.js";

const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const indices = Uint32Array.from([0, 1, 2]);
const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);

/** Concatenates the streams the adapter writes, keeping every start 8-aligned. */
function geometryFile(): Buffer {
  const parts = [
    Buffer.from(positions.buffer),
    Buffer.from(indices.buffer),
    Buffer.alloc(4),
    Buffer.from(normals.buffer),
  ];
  return Buffer.concat(parts);
}

function splitScene(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "madi.scene-ir.0",
    propertyIndex: { keys: ["a"], sets: [[0]] },
    representations: [
      {
        id: "representation:one",
        prototypeId: "prototype:one",
        purpose: "display",
        surface: {
          primitive: "triangles",
          positions: { encoding: "f64le", byteOffset: 0, byteLength: 72 },
          indices: { encoding: "u32le", byteOffset: 72, byteLength: 12 },
          normals: { encoding: "f32le", byteOffset: 88, byteLength: 36 },
          ...overrides,
        },
      },
    ],
  };
}

describe("split IFC Scene IR hydration", () => {
  it("resolves stream references into views over the geometry file", () => {
    const geometry = geometryFile();
    const scene = hydrateIfcSceneSplit(splitScene(), geometry);
    const surface = scene.representations[0]?.surface;

    expect(surface?.positions).toBeInstanceOf(Float64Array);
    expect(Array.from(surface?.positions ?? [])).toEqual(Array.from(positions));
    expect(Array.from(surface?.indices ?? [])).toEqual(Array.from(indices));
    expect(Array.from(surface?.normals ?? [])).toEqual(Array.from(normals));
    // Views alias the file rather than copying it.
    expect(surface?.positions.buffer).toBe(geometry.buffer);
    // Non-geometry members such as the property index pass through untouched.
    expect(scene.propertyIndex).toEqual({ keys: ["a"], sets: [[0]] });
  });

  it("hydrates a geometry buffer that starts unaligned inside a pool", () => {
    const pool = Buffer.alloc(geometryFile().byteLength + 4);
    geometryFile().copy(pool, 4);
    const unaligned = pool.subarray(4);
    expect(unaligned.byteOffset % 8).not.toBe(0);

    const scene = hydrateIfcSceneSplit(splitScene(), unaligned);
    expect(Array.from(scene.representations[0]?.surface?.positions ?? [])).toEqual(
      Array.from(positions),
    );
  });

  it("rejects a stream that leaves the geometry file", () => {
    expect(() =>
      hydrateIfcSceneSplit(
        splitScene({ indices: { encoding: "u32le", byteOffset: 72, byteLength: 4096 } }),
        geometryFile(),
      ),
    ).toThrow(/exceeds the geometry buffer/u);
  });

  it("rejects a misdeclared stream encoding", () => {
    expect(() =>
      hydrateIfcSceneSplit(
        splitScene({ positions: { encoding: "f32le", byteOffset: 0, byteLength: 72 } }),
        geometryFile(),
      ),
    ).toThrow(/unexpected encodings/u);
  });

  it("rejects a length that cannot divide into elements", () => {
    expect(() =>
      hydrateIfcSceneSplit(
        splitScene({ indices: { encoding: "u32le", byteOffset: 72, byteLength: 10 } }),
        geometryFile(),
      ),
    ).toThrow(/must align to 4 bytes/u);
  });

  it("rejects surface members the transport cannot encode", () => {
    expect(() =>
      hydrateIfcSceneSplit(splitScene({ faceSourceIds: [0, 1, 2] }), geometryFile()),
    ).toThrow(/cannot carry faceSourceIds/u);
  });

  it("rejects representations that still carry expanded edges", () => {
    const scene = splitScene();
    (scene.representations as Record<string, unknown>[])[0]!.edges = {
      positions: [],
      segments: [],
      classes: [],
    };
    expect(() => hydrateIfcSceneSplit(scene, geometryFile())).toThrow(
      /cannot carry edge streams/u,
    );
  });
});
