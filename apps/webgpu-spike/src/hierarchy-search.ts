import type { CompiledHierarchyEntry } from "@madi/runtime-webgpu";

export interface HierarchySearchResult {
  readonly query: string;
  readonly matchingNodeIndices: readonly number[];
  readonly visibleNodeIndices: readonly number[];
  readonly firstRenderableNodeIndex?: number;
}

interface IndexedHierarchyEntry {
  readonly entry: CompiledHierarchyEntry;
  readonly haystack: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

/** Pre-indexes hierarchy identity fields to avoid repeated text normalization. */
export class HierarchySearchIndex {
  private readonly indexed: readonly IndexedHierarchyEntry[];

  constructor(entries: readonly CompiledHierarchyEntry[]) {
    this.indexed = entries.map((entry) => ({
      entry,
      haystack: normalize(
        [entry.name, entry.occurrenceId, entry.prototypeId, entry.sourceRef ?? ""].join("\n"),
      ),
    }));
  }

  search(rawQuery: string): HierarchySearchResult {
    const query = rawQuery.trim();
    const tokens = normalize(query).split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) {
      return {
        query: "",
        matchingNodeIndices: [],
        visibleNodeIndices: this.indexed.map(({ entry }) => entry.nodeIndex),
      };
    }

    const directMatches = this.indexed.map(({ haystack }) =>
      tokens.every((token) => haystack.includes(token)),
    );
    const matchingNodeIndices: number[] = [];
    const visible = new Set<number>();
    const ancestors: number[] = [];

    this.indexed.forEach(({ entry }, index) => {
      ancestors.length = entry.depth;
      if (directMatches[index]) {
        matchingNodeIndices.push(entry.nodeIndex);
        visible.add(entry.nodeIndex);
        for (const ancestor of ancestors) visible.add(ancestor);
      }
      ancestors[entry.depth] = entry.nodeIndex;
    });

    let matchedAssemblyDepth: number | undefined;
    this.indexed.forEach(({ entry }, index) => {
      if (matchedAssemblyDepth !== undefined && entry.depth <= matchedAssemblyDepth) {
        matchedAssemblyDepth = undefined;
      }
      if (directMatches[index] && !entry.renderable) {
        matchedAssemblyDepth = entry.depth;
      }
      if (matchedAssemblyDepth !== undefined) visible.add(entry.nodeIndex);
    });

    const firstDirectRenderable = this.indexed.find(
      ({ entry }, index) => directMatches[index] && entry.renderable,
    )?.entry.nodeIndex;
    const firstVisibleRenderable = this.indexed.find(
      ({ entry }) => visible.has(entry.nodeIndex) && entry.renderable,
    )?.entry.nodeIndex;

    return {
      query,
      matchingNodeIndices,
      visibleNodeIndices: this.indexed
        .filter(({ entry }) => visible.has(entry.nodeIndex))
        .map(({ entry }) => entry.nodeIndex),
      firstRenderableNodeIndex: firstDirectRenderable ?? firstVisibleRenderable,
    };
  }
}
