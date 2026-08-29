import { createRepeatedTriangleScene, ids } from "@naru3d/scene-ir";
import type { Representation } from "@naru3d/scene-ir";
import { describe, expect, it } from "vitest";

import { GltfBinaryBuilder } from "../src/binary.js";
import {
  appendCompiledPayload,
  buildCompiledPayload,
  compiledPayloadContentDigest,
} from "../src/compiled-payload.js";

function triangleRepresentation(): Representation {
  const representation = createRepeatedTriangleScene().representations[0];
  if (!representation) throw new TypeError("Triangle fixture is incomplete.");
  return representation;
}

/** The same geometry with the edge positions aliasing the surface positions. */
function aliasedRepresentation(): Representation {
  const base = triangleRepresentation();
  if (!base.surface || !base.edges) throw new TypeError("Triangle fixture is incomplete.");
  return { ...base, edges: { ...base.edges, positions: base.surface.positions } };
}

describe("compiled payload", () => {
  it("encodes every accessor role without any placement input", () => {
    const payload = buildCompiledPayload(triangleRepresentation(), 1);

    expect(payload.accessors.map(({ name }) => name)).toEqual([
      "representation:triangle:display surface positions",
      "representation:triangle:display surface normals",
      "representation:triangle:display face source IDs",
      "representation:triangle:display surface indices 0",
      "representation:triangle:display edge positions",
      "representation:triangle:display edge indices",
      "representation:triangle:display edge classes",
      "representation:triangle:display edge source IDs",
    ]);
    expect(payload.shape).toEqual({
      position: 0,
      normal: 1,
      faceSource: 2,
      surfaceGroups: [
        {
          accessor: 3,
          materialId: ids.material("material:phase-0-blue"),
          firstIndex: 0,
          indexCount: 3,
        },
      ],
      edgePosition: 4,
      edgeIndex: 5,
      edgeClass: 6,
      edgeSource: 7,
    });
    expect(payload.triangles).toBe(1);
    expect(payload.edges).toBe(3);
    // Placement decides offsets; a payload carries none of them.
    expect(payload.accessors.every((accessor) => !("byteOffset" in accessor))).toBe(true);
  });

  it("reuses the surface accessor when the edges share its positions", () => {
    const payload = buildCompiledPayload(aliasedRepresentation(), 1);

    expect(payload.shape.edgePosition).toBe(payload.shape.position);
    expect(payload.accessors).toHaveLength(7);
  });

  it("places the same payload twice at different offsets with identical bytes", () => {
    const payload = buildCompiledPayload(triangleRepresentation(), 1);
    const builder = new GltfBinaryBuilder();
    const first = appendCompiledPayload(builder, payload);
    const second = appendCompiledPayload(builder, payload);
    const bytes = builder.finish();
    const { accessors, bufferViews } = builder;

    expect(first.positionAccessor).toBe(0);
    expect(second.positionAccessor).toBe(payload.accessors.length);
    expect(second.surfaceGroups[0]?.indexAccessor).toBe(
      (first.surfaceGroups[0]?.indexAccessor ?? -1) + payload.accessors.length,
    );
    for (const [index, accessor] of payload.accessors.entries()) {
      const left = bufferViews[accessors[index]?.bufferView ?? -1];
      const right = bufferViews[accessors[index + payload.accessors.length]?.bufferView ?? -1];
      if (!left || !right) throw new TypeError("Placement lost a buffer view.");
      expect(left.byteOffset).not.toBe(right.byteOffset);
      expect(bytes.subarray(left.byteOffset, left.byteOffset + left.byteLength)).toEqual(
        bytes.subarray(right.byteOffset, right.byteOffset + right.byteLength),
      );
      expect(left.byteLength).toBe(accessor.bytes.byteLength);
    }
  });

  it("addresses content, not identity, and separates aliasing and element type", () => {
    const representation = triangleRepresentation();
    const digest = compiledPayloadContentDigest(representation);

    expect(compiledPayloadContentDigest({ ...representation })).toBe(digest);
    expect(compiledPayloadContentDigest(aliasedRepresentation())).not.toBe(digest);
    // The id is hashed because it names every accessor the payload carries.
    expect(
      compiledPayloadContentDigest({ ...representation, id: ids.representation("other") }),
    ).not.toBe(digest);
    if (!representation.surface) throw new TypeError("Triangle fixture is incomplete.");
    const widened = {
      ...representation,
      surface: { ...representation.surface, positions: new Float64Array(representation.surface.positions) },
    };
    expect(compiledPayloadContentDigest(widened)).not.toBe(digest);
  });
});
