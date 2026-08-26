import { describe, expect, it } from "vitest";

import {
  createLargeCoordinatePrecisionScene,
  createRepeatedTriangleScene,
  ids,
  resolvePropertyEntries,
  validateScene,
} from "../src/index.js";
import type { EngineeringScene, PropertyIndex, SemanticEntity } from "../src/index.js";

function indexedScene(
  propertyIndex: PropertyIndex,
  properties: SemanticEntity["properties"],
): EngineeringScene {
  const scene = createRepeatedTriangleScene();
  const semantic = scene.semantics[0];
  if (!semantic) throw new Error("Fixture semantic is missing.");
  return {
    ...scene,
    propertyIndex,
    semantics: [{ ...semantic, properties }],
  };
}

describe("validateScene", () => {
  it("accepts the repeated-prototype fixture", () => {
    const scene = createRepeatedTriangleScene();
    const result = validateScene(scene);

    expect(result).toEqual({ ok: true, issues: [] });
    expect(scene.occurrences).toHaveLength(2);
    expect(scene.prototypes).toHaveLength(1);
    expect(scene.representations).toHaveLength(1);
    expect(scene.occurrences[0]?.prototypeId).toBe(scene.occurrences[1]?.prototypeId);
  });

  it("accepts matching near/far large-coordinate precision controls", () => {
    const near = createLargeCoordinatePrecisionScene();
    const far = createLargeCoordinatePrecisionScene([
      10_000_000,
      -7_000_000,
      3_000_000,
    ]);

    expect(validateScene(near)).toEqual({ ok: true, issues: [] });
    expect(validateScene(far)).toEqual({ ok: true, issues: [] });
    expect(Array.from(near.representations[0]?.surface?.positions ?? []))
      .toEqual(Array.from(far.representations[0]?.surface?.positions ?? []));
    expect(far.occurrences.map(({ localTransform }) => localTransform[12]))
      .toEqual([9_999_999.979_875, 10_000_000.020_125]);
  });

  it("rejects an occurrence cycle", () => {
    const scene = createRepeatedTriangleScene();
    const [left, right] = scene.occurrences;
    if (!left || !right) throw new Error("Fixture occurrences are missing.");

    const invalid: EngineeringScene = {
      ...scene,
      occurrences: [
        { ...left, parentId: right.id },
        { ...right, parentId: left.id },
      ],
    };

    const result = validateScene(invalid);
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "OCCURRENCE_CYCLE")).toBe(true);
  });

  it("rejects out-of-range geometry indices", () => {
    const scene = createRepeatedTriangleScene();
    const representation = scene.representations[0];
    if (!representation?.surface) throw new Error("Fixture surface is missing.");

    const invalid: EngineeringScene = {
      ...scene,
      representations: [
        {
          ...representation,
          surface: {
            ...representation.surface,
            indices: new Uint32Array([0, 1, 99]),
          },
        },
      ],
    };

    const result = validateScene(invalid);
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "INDEX_OUT_OF_RANGE")).toBe(true);
  });

  it("rejects missing prototype references", () => {
    const scene = createRepeatedTriangleScene();
    const occurrence = scene.occurrences[0];
    if (!occurrence) throw new Error("Fixture occurrence is missing.");

    const invalid: EngineeringScene = {
      ...scene,
      occurrences: [
        { ...occurrence, prototypeId: ids.prototype("prototype:missing") },
      ],
    };

    const result = validateScene(invalid);
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "MISSING_REFERENCE")).toBe(true);
  });

  it("accepts indexed semantic properties and resolves them losslessly", () => {
    const propertyIndex: PropertyIndex = {
      keys: ["fixture", "occurrenceCount"],
      sets: [[], [0, 1]],
    };
    const scene = indexedScene(propertyIndex, { set: 1, values: [true, 2] });

    expect(validateScene(scene)).toEqual({ ok: true, issues: [] });
    const semantic = scene.semantics[0];
    if (!semantic) throw new Error("Semantic is missing.");
    expect(resolvePropertyEntries(semantic.properties, scene.propertyIndex)).toEqual({
      fixture: true,
      occurrenceCount: 2,
    });
  });

  it("rejects duplicate keys and non-ascending sets in the property index", () => {
    const scene = indexedScene(
      { keys: ["a", "a", ""], sets: [[1, 0], [7]] },
      { set: 0, values: [1, 2] },
    );

    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    const codes = new Set(result.issues.map(({ code }) => code));
    expect(codes.has("DUPLICATE_PROPERTY_KEY")).toBe(true);
    expect(codes.has("EMPTY_PROPERTY_KEY")).toBe(true);
    expect(codes.has("PROPERTY_SET_NOT_ASCENDING")).toBe(true);
    expect(codes.has("PROPERTY_KEY_OUT_OF_RANGE")).toBe(true);
  });

  it("rejects indexed bags whose set or arity does not match the index", () => {
    const propertyIndex: PropertyIndex = { keys: ["a", "b"], sets: [[0, 1]] };
    const arity = validateScene(indexedScene(propertyIndex, { set: 0, values: [1] }));
    expect(arity.ok).toBe(false);
    expect(arity.issues.some(({ code }) => code === "PROPERTY_VALUE_ARITY")).toBe(true);

    const range = validateScene(indexedScene(propertyIndex, { set: 5, values: [] }));
    expect(range.ok).toBe(false);
    expect(range.issues.some(({ code }) => code === "PROPERTY_SET_OUT_OF_RANGE")).toBe(
      true,
    );

    const scene = createRepeatedTriangleScene();
    const semantic = scene.semantics[0];
    if (!semantic) throw new Error("Fixture semantic is missing.");
    const missingIndex = validateScene({
      ...scene,
      semantics: [{ ...semantic, properties: { set: 0, values: [] } }],
    });
    expect(missingIndex.ok).toBe(false);
    expect(
      missingIndex.issues.some(({ code }) => code === "MISSING_PROPERTY_INDEX"),
    ).toBe(true);
  });

  it("rejects non-finite values inside indexed bags", () => {
    const result = validateScene(
      indexedScene({ keys: ["a"], sets: [[0]] }, { set: 0, values: [Number.NaN] }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some(({ code }) => code === "NON_FINITE_PROPERTY")).toBe(true);
  });
});
