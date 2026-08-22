import { describe, expect, it } from "vitest";

import { createRepeatedTriangleScene, ids, validateScene } from "../src/index.js";
import type { EngineeringScene } from "../src/index.js";

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
});
