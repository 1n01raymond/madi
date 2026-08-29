import { describe, expect, it } from "vitest";

import {
  classifyOutcome,
  createSeededRandom,
  documentOperators,
  enumerateMutablePaths,
  mutateBinary,
  mutateDocument,
  normalizeDetail,
  runPackageFuzzCampaign,
  seedFromLabel,
} from "../../../scripts/lib/package-fuzz.mjs";

const controlled = ["CompiledGltfError"];

function drawOperator(name: string, ...rest: number[]): () => number {
  // `mutateDocument` draws the path first and the operator second, so a stream
  // that answers 0 then the operator's position selects it deterministically;
  // anything an operator draws after that is appended by the caller.
  const index = documentOperators.indexOf(name);
  const draws = [0, (index + 0.5) / documentOperators.length, ...rest];
  let at = 0;
  return () => draws[at++] ?? 0;
}

describe("seeded stream", () => {
  it("reproduces the same sequence for a seed and diverges between seeds", () => {
    const first = Array.from({ length: 8 }, createSeededRandom(7));
    const again = Array.from({ length: 8 }, createSeededRandom(7));
    const other = Array.from({ length: 8 }, createSeededRandom(8));

    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
    for (const value of first) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of first) expect(value).toBeLessThan(1);
  });

  it("gives every target label its own stream under one campaign seed", () => {
    expect(seedFromLabel("a/target", 1)).not.toBe(seedFromLabel("b/target", 1));
    expect(seedFromLabel("a/target", 1)).toBe(seedFromLabel("a/target", 1));
    expect(seedFromLabel("a/target", 1)).not.toBe(seedFromLabel("a/target", 2));
  });
});

describe("document mutation", () => {
  it("enumerates members under the declared roots and no others", () => {
    const paths = enumerateMutablePaths(
      { meshes: [{ mode: 4 }], buffers: [], ignored: { deep: 1 } },
      { roots: ["meshes", "buffers"] },
    );

    expect(paths).toContainEqual(["meshes"]);
    expect(paths).toContainEqual(["meshes", 0, "mode"]);
    expect(paths.some((path) => path.includes("ignored"))).toBe(false);
  });

  it("stops descending at the depth bound", () => {
    const deep = { nodes: [{ a: { b: { c: { d: 1 } } } }] };
    const paths = enumerateMutablePaths(deep, { roots: ["nodes"], maximumDepth: 2 });

    expect(paths.every((path) => path.length <= 2)).toBe(true);
  });

  it("reports an operator that found nothing of its kind as a no-op", () => {
    const document = { nodes: 5 };
    // `scale` needs a number at the drawn path and `truncate` needs an array;
    // the root itself is neither, so each is counted rather than retried.
    expect(mutateDocument({ ...document }, drawOperator("truncate"), {}).operator)
      .toBe("truncate-noop");
    expect(mutateDocument({ nodes: [{}] }, drawOperator("scale"), {}).operator)
      .toBe("scale-noop");
  });

  it("builds a deep node chain so the traversal bound is exercised", () => {
    const document: { nodes: unknown[]; scene?: number } = { nodes: [{}] };
    const result = mutateDocument(document, drawOperator("chain", 0.5), {});

    expect(result.operator).toBe("chain");
    expect(document.nodes).toHaveLength(101);
    expect(document.scene).toBe(0);
    expect(document.nodes[0]).toEqual({ children: [1] });
  });
});

describe("binary mutation", () => {
  it("never modifies the seed buffer", () => {
    const seedBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const before = seedBytes.slice();
    for (let seed = 0; seed < 32; seed += 1) {
      const { bytes } = mutateBinary(seedBytes, createSeededRandom(seed));
      expect(bytes).not.toBe(seedBytes);
    }

    expect(seedBytes).toEqual(before);
  });

  it("covers every operator across a short seed sweep", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 64; seed += 1) {
      seen.add(mutateBinary(Uint8Array.of(1, 2, 3), createSeededRandom(seed)).operator);
    }

    expect([...seen].sort()).toEqual(["flip", "grow", "intact", "truncate"]);
  });
});

describe("outcome accounting", () => {
  it("counts a declared error class as a rejection and anything else as a defect", () => {
    const rejection = Object.assign(new Error("bad"), {
      name: "CompiledGltfError",
      code: "INVALID_GLTF",
    });

    expect(classifyOutcome(rejection, controlled)).toEqual({
      outcome: "rejected",
      detail: "INVALID_GLTF",
    });
    expect(classifyOutcome(new TypeError("x of undefined"), controlled).outcome)
      .toBe("uncontrolled");
    expect(classifyOutcome("thrown string", controlled).outcome).toBe("uncontrolled");
  });

  it("collapses run-specific numbers so one defect counts as one kind", () => {
    expect(normalizeDetail("TypeError: meshes[12].primitives[3] is not an object"))
      .toBe(normalizeDetail("TypeError: meshes[7].primitives[915] is not an object"));
    expect(normalizeDetail("x".repeat(400))).toHaveLength(160);
  });

  it("balances the ledger and samples only uncontrolled outcomes", () => {
    const campaign = runPackageFuzzCampaign({
      targets: [
        { id: "accepts", document: { nodes: [] }, run: () => undefined },
        {
          id: "rejects",
          document: { nodes: [] },
          run: () => {
            throw Object.assign(new Error("no"), {
              name: "CompiledGltfError",
              code: "INVALID_GLTF",
            });
          },
        },
        {
          id: "crashes",
          document: { nodes: [] },
          run: () => {
            throw new TypeError("Cannot read properties of null (reading 'mode')");
          },
        },
      ],
      iterations: 5,
      seed: 3,
      controlledErrorNames: controlled,
      maximumSamples: 2,
    });

    expect(campaign.totals).toEqual({
      executions: 15,
      accepted: 5,
      rejected: 5,
      uncontrolled: 5,
    });
    expect(campaign.targets[1]?.rejectionsByCode).toEqual({ INVALID_GLTF: 5 });
    expect(campaign.targets[2]?.uncontrolledByKind).toEqual({
      "TypeError: Cannot read properties of null (reading 'mode')": 5,
    });
    expect(campaign.uncontrolledSamples).toHaveLength(2);
    expect(campaign.uncontrolledSamples.every((sample) => sample.target === "crashes")).toBe(true);
  });

  it("refuses a campaign with no iterations", () => {
    expect(() => runPackageFuzzCampaign({
      targets: [],
      iterations: 0,
      controlledErrorNames: controlled,
    })).toThrow(TypeError);
  });
});
