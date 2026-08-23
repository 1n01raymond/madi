import { describe, expect, it } from "vitest";

import type { CompiledHierarchyEntry } from "@madi/runtime-webgpu";

import { HierarchySearchIndex } from "../src/hierarchy-search.js";

const entries: readonly CompiledHierarchyEntry[] = [
  {
    nodeIndex: 0,
    name: "Plant",
    depth: 0,
    renderable: false,
    occurrenceId: "occurrence:plant",
    prototypeId: "prototype:assembly:plant",
  },
  {
    nodeIndex: 1,
    name: "Pump train",
    depth: 1,
    renderable: false,
    occurrenceId: "occurrence:plant/pump-train",
    prototypeId: "prototype:assembly:pump-train",
  },
  {
    nodeIndex: 2,
    name: "Impeller A",
    depth: 2,
    renderable: true,
    occurrenceId: "occurrence:plant/pump-train/impeller-a",
    prototypeId: "prototype:part:impeller",
    sourceRef: "source:part:PX-100",
  },
  {
    nodeIndex: 3,
    name: "Motor",
    depth: 1,
    renderable: true,
    occurrenceId: "occurrence:plant/motor",
    prototypeId: "prototype:part:motor",
    sourceRef: "source:part:M-200",
  },
];

describe("hierarchy search index", () => {
  it("returns every node for an empty query", () => {
    const result = new HierarchySearchIndex(entries).search("  ");

    expect(result.query).toBe("");
    expect(result.visibleNodeIndices).toEqual([0, 1, 2, 3]);
    expect(result.matchingNodeIndices).toEqual([]);
  });

  it("matches identity fields case-insensitively and keeps ancestors", () => {
    const result = new HierarchySearchIndex(entries).search("px-100 IMPELLER");

    expect(result.matchingNodeIndices).toEqual([2]);
    expect(result.visibleNodeIndices).toEqual([0, 1, 2]);
    expect(result.firstRenderableNodeIndex).toBe(2);
  });

  it("reveals the subtree of a matching assembly", () => {
    const result = new HierarchySearchIndex(entries).search("prototype:assembly:pump-train");

    expect(result.matchingNodeIndices).toEqual([1]);
    expect(result.visibleNodeIndices).toEqual([0, 1, 2]);
    expect(result.firstRenderableNodeIndex).toBe(2);
  });

  it("returns a stable empty result when nothing matches", () => {
    const result = new HierarchySearchIndex(entries).search("compressor");

    expect(result.matchingNodeIndices).toEqual([]);
    expect(result.visibleNodeIndices).toEqual([]);
    expect(result.firstRenderableNodeIndex).toBeUndefined();
  });
});
