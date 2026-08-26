export const spatialDemandIndexSchema = "naru.spatial-demand-index.1";
export const defaultSpatialLeafCapacity = 64;

const headerByteLength = 64;
const nodeByteLength = 72;
const leafSentinel = 0xffff_ffff;
const maximumUint32 = 0xffff_ffff;
const magic = [0x4e, 0x53, 0x44, 0x49] as const; // NSDI

export type SpatialVector3 = readonly [number, number, number];

export interface SpatialDemandBoundsOccurrence {
  readonly id: string;
  readonly nodeIndex: number;
  readonly minimum: SpatialVector3;
  readonly maximum: SpatialVector3;
}

export interface SpatialDemandOccurrence extends SpatialDemandBoundsOccurrence {
  readonly targetChunkIndex: number;
}

export interface SpatialDemandIndexStats {
  readonly nodeCount: number;
  readonly leafCount: number;
  readonly occurrenceCount: number;
  readonly chunkReferenceCount: number;
  readonly maxDepth: number;
  readonly leafCapacity: number;
}

export interface EncodedSpatialDemandIndex {
  readonly schemaVersion: typeof spatialDemandIndexSchema;
  readonly bytes: Uint8Array;
  readonly stats: SpatialDemandIndexStats;
}

interface SpatialNode {
  readonly minimum: SpatialVector3;
  readonly maximum: SpatialVector3;
  readonly leftChild: number;
  readonly rightChild: number;
  readonly firstOccurrenceRef: number;
  readonly occurrenceRefCount: number;
  readonly firstChunkRef: number;
  readonly chunkRefCount: number;
}

interface OccurrenceReference {
  readonly nodeIndex: number;
  readonly targetChunkIndex: number;
}

function assertUint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumUint32) {
    throw new RangeError(`${label} must fit an unsigned 32-bit integer.`);
  }
}

function assertBounds(entry: SpatialDemandBoundsOccurrence): void {
  if (entry.id.trim() === "") throw new TypeError("Spatial occurrence id must not be empty.");
  assertUint32(entry.nodeIndex, `Spatial occurrence ${entry.id} nodeIndex`);
  for (const axis of [0, 1, 2] as const) {
    const minimum = entry.minimum[axis];
    const maximum = entry.maximum[axis];
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
      throw new TypeError(`Spatial occurrence ${entry.id} has invalid axis ${axis} bounds.`);
    }
  }
}

function boundsFor(entries: readonly SpatialDemandBoundsOccurrence[]): {
  readonly minimum: SpatialVector3;
  readonly maximum: SpatialVector3;
} {
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const entry of entries) {
    for (const axis of [0, 1, 2] as const) {
      minimum[axis] = Math.min(minimum[axis], entry.minimum[axis]);
      maximum[axis] = Math.max(maximum[axis], entry.maximum[axis]);
    }
  }
  return { minimum, maximum };
}

function splitAxis(minimum: SpatialVector3, maximum: SpatialVector3): 0 | 1 | 2 {
  const extents = [
    maximum[0] - minimum[0],
    maximum[1] - minimum[1],
    maximum[2] - minimum[2],
  ] as const;
  let axis: 0 | 1 | 2 = 0;
  if (extents[1] > extents[axis]) axis = 1;
  if (extents[2] > extents[axis]) axis = 2;
  return axis;
}

function center(entry: SpatialDemandBoundsOccurrence, axis: 0 | 1 | 2): number {
  return entry.minimum[axis] + (entry.maximum[axis] - entry.minimum[axis]) / 2;
}

function validatedLeafCapacity(value: number | undefined): number {
  const leafCapacity = value ?? defaultSpatialLeafCapacity;
  if (!Number.isSafeInteger(leafCapacity) || leafCapacity < 1 || leafCapacity > 65_535) {
    throw new RangeError("Spatial leaf capacity must be an integer between 1 and 65535.");
  }
  return leafCapacity;
}

/**
 * Returns deterministic depth-first BVH leaf membership without assigning
 * payload chunks. The compiler uses the same split/tie rules to derive an
 * opt-in spatial payload order before final chunk indexes exist.
 */
export function partitionSpatialDemandLeaves<T extends SpatialDemandBoundsOccurrence>(
  input: readonly T[],
  options: { readonly leafCapacity?: number } = {},
): readonly (readonly T[])[] {
  const leafCapacity = validatedLeafCapacity(options.leafCapacity);
  if (input.length === 0) throw new TypeError("A spatial demand partition needs one occurrence.");
  const ids = new Set<string>();
  const nodeIndexes = new Set<number>();
  for (const entry of input) {
    assertBounds(entry);
    if (ids.has(entry.id)) throw new RangeError(`Duplicate spatial occurrence id ${entry.id}.`);
    if (nodeIndexes.has(entry.nodeIndex)) {
      throw new RangeError(`Duplicate spatial occurrence nodeIndex ${entry.nodeIndex}.`);
    }
    ids.add(entry.id);
    nodeIndexes.add(entry.nodeIndex);
  }

  const leaves: T[][] = [];
  const append = (entries: readonly T[]): void => {
    if (entries.length <= leafCapacity) {
      leaves.push(
        [...entries].sort(
          (left, right) => left.id.localeCompare(right.id, "en") || left.nodeIndex - right.nodeIndex,
        ),
      );
      return;
    }
    const bounds = boundsFor(entries);
    const axis = splitAxis(bounds.minimum, bounds.maximum);
    const ordered = [...entries].sort(
      (left, right) =>
        center(left, axis) - center(right, axis) ||
        left.id.localeCompare(right.id, "en") ||
        left.nodeIndex - right.nodeIndex,
    );
    const midpoint = Math.floor(ordered.length / 2);
    append(ordered.slice(0, midpoint));
    append(ordered.slice(midpoint));
  };
  append([...input].sort((left, right) => left.id.localeCompare(right.id, "en")));
  return leaves;
}

function checkedTotalByteLength(
  nodeCount: number,
  occurrenceCount: number,
  chunkReferenceCount: number,
): number {
  const total =
    headerByteLength +
    nodeCount * nodeByteLength +
    occurrenceCount * 8 +
    chunkReferenceCount * 4;
  if (!Number.isSafeInteger(total) || total > maximumUint32) {
    throw new RangeError("Spatial demand index exceeds the v1 32-bit byte-length limit.");
  }
  return total;
}

export function encodeSpatialDemandIndex(
  input: readonly SpatialDemandOccurrence[],
  options: { readonly leafCapacity?: number } = {},
): EncodedSpatialDemandIndex {
  const leafCapacity = validatedLeafCapacity(options.leafCapacity);
  if (input.length === 0) throw new TypeError("A spatial demand index needs one occurrence.");
  assertUint32(input.length, "Spatial occurrence count");

  const ids = new Set<string>();
  const nodeIndexes = new Set<number>();
  for (const entry of input) {
    assertBounds(entry);
    assertUint32(entry.targetChunkIndex, `Spatial occurrence ${entry.id} targetChunkIndex`);
    if (ids.has(entry.id)) throw new RangeError(`Duplicate spatial occurrence id ${entry.id}.`);
    if (nodeIndexes.has(entry.nodeIndex)) {
      throw new RangeError(`Duplicate spatial occurrence nodeIndex ${entry.nodeIndex}.`);
    }
    ids.add(entry.id);
    nodeIndexes.add(entry.nodeIndex);
  }

  const nodes: SpatialNode[] = [];
  const occurrenceReferences: OccurrenceReference[] = [];
  const chunkReferences: number[] = [];
  let leafCount = 0;
  let maxDepth = 0;

  const append = (entries: readonly SpatialDemandOccurrence[], depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const bounds = boundsFor(entries);
    const nodeIndex = nodes.length;
    nodes.push({
      ...bounds,
      leftChild: leafSentinel,
      rightChild: leafSentinel,
      firstOccurrenceRef: 0,
      occurrenceRefCount: 0,
      firstChunkRef: 0,
      chunkRefCount: 0,
    });

    if (entries.length <= leafCapacity) {
      leafCount += 1;
      const ordered = [...entries].sort(
        (left, right) => left.id.localeCompare(right.id, "en") || left.nodeIndex - right.nodeIndex,
      );
      const firstOccurrenceRef = occurrenceReferences.length;
      for (const entry of ordered) {
        occurrenceReferences.push({
          nodeIndex: entry.nodeIndex,
          targetChunkIndex: entry.targetChunkIndex,
        });
      }
      const firstChunkRef = chunkReferences.length;
      const leafChunks = [...new Set(ordered.map(({ targetChunkIndex }) => targetChunkIndex))]
        .sort((left, right) => left - right);
      chunkReferences.push(...leafChunks);
      nodes[nodeIndex] = {
        ...bounds,
        leftChild: leafSentinel,
        rightChild: leafSentinel,
        firstOccurrenceRef,
        occurrenceRefCount: ordered.length,
        firstChunkRef,
        chunkRefCount: leafChunks.length,
      };
      return nodeIndex;
    }

    const axis = splitAxis(bounds.minimum, bounds.maximum);
    const ordered = [...entries].sort(
      (left, right) =>
        center(left, axis) - center(right, axis) ||
        left.id.localeCompare(right.id, "en") ||
        left.nodeIndex - right.nodeIndex,
    );
    const midpoint = Math.floor(ordered.length / 2);
    const leftChild = append(ordered.slice(0, midpoint), depth + 1);
    const rightChild = append(ordered.slice(midpoint), depth + 1);
    nodes[nodeIndex] = {
      ...bounds,
      leftChild,
      rightChild,
      firstOccurrenceRef: 0,
      occurrenceRefCount: 0,
      firstChunkRef: 0,
      chunkRefCount: 0,
    };
    return nodeIndex;
  };

  append([...input].sort((left, right) => left.id.localeCompare(right.id, "en")), 0);
  assertUint32(nodes.length, "Spatial node count");
  assertUint32(leafCount, "Spatial leaf count");
  assertUint32(chunkReferences.length, "Spatial chunk reference count");
  const totalByteLength = checkedTotalByteLength(
    nodes.length,
    occurrenceReferences.length,
    chunkReferences.length,
  );
  const nodesOffset = headerByteLength;
  const occurrenceReferencesOffset = nodesOffset + nodes.length * nodeByteLength;
  const chunkReferencesOffset = occurrenceReferencesOffset + occurrenceReferences.length * 8;
  const bytes = new Uint8Array(totalByteLength);
  bytes.set(magic, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, headerByteLength, true);
  view.setUint32(12, nodeByteLength, true);
  view.setUint32(16, nodes.length, true);
  view.setUint32(20, leafCount, true);
  view.setUint32(24, occurrenceReferences.length, true);
  view.setUint32(28, chunkReferences.length, true);
  view.setUint32(32, 0, true);
  view.setUint32(36, maxDepth, true);
  view.setUint32(40, leafCapacity, true);
  view.setUint32(44, nodesOffset, true);
  view.setUint32(48, occurrenceReferencesOffset, true);
  view.setUint32(52, chunkReferencesOffset, true);
  view.setUint32(56, totalByteLength, true);
  view.setUint32(60, 0, true);

  nodes.forEach((node, index) => {
    const offset = nodesOffset + index * nodeByteLength;
    for (const axis of [0, 1, 2] as const) {
      view.setFloat64(offset + axis * 8, node.minimum[axis], true);
      view.setFloat64(offset + 24 + axis * 8, node.maximum[axis], true);
    }
    view.setUint32(offset + 48, node.leftChild, true);
    view.setUint32(offset + 52, node.rightChild, true);
    view.setUint32(offset + 56, node.firstOccurrenceRef, true);
    view.setUint32(offset + 60, node.occurrenceRefCount, true);
    view.setUint32(offset + 64, node.firstChunkRef, true);
    view.setUint32(offset + 68, node.chunkRefCount, true);
  });
  occurrenceReferences.forEach((reference, index) => {
    const offset = occurrenceReferencesOffset + index * 8;
    view.setUint32(offset, reference.nodeIndex, true);
    view.setUint32(offset + 4, reference.targetChunkIndex, true);
  });
  chunkReferences.forEach((chunkIndex, index) => {
    view.setUint32(chunkReferencesOffset + index * 4, chunkIndex, true);
  });

  return {
    schemaVersion: spatialDemandIndexSchema,
    bytes,
    stats: {
      nodeCount: nodes.length,
      leafCount,
      occurrenceCount: occurrenceReferences.length,
      chunkReferenceCount: chunkReferences.length,
      maxDepth,
      leafCapacity,
    },
  };
}
