export const supportedSpatialDemandIndexSchema = "naru.spatial-demand-index.1";

const headerByteLength = 64;
const nodeByteLength = 72;
const leafSentinel = 0xffff_ffff;
const magic = [0x4e, 0x53, 0x44, 0x49] as const; // NSDI

export interface DecodeSpatialDemandIndexOptions {
  readonly gltfNodeCount: number;
  readonly targetChunkCount: number;
  readonly expectedOccurrenceCount?: number;
  readonly maximumNodeCount?: number;
  readonly maximumOccurrenceCount?: number;
  readonly maximumChunkReferenceCount?: number;
}

export interface DecodedSpatialDemandIndex {
  readonly schemaVersion: typeof supportedSpatialDemandIndexSchema;
  /** Node bounds in min-x/y/z, max-x/y/z order. */
  readonly bounds: Float64Array;
  readonly leftChildren: Uint32Array;
  readonly rightChildren: Uint32Array;
  readonly firstOccurrenceReferences: Uint32Array;
  readonly occurrenceReferenceCounts: Uint32Array;
  readonly firstChunkReferences: Uint32Array;
  readonly chunkReferenceCounts: Uint32Array;
  readonly occurrenceNodeIndexes: Uint32Array;
  readonly occurrenceTargetChunkIndexes: Uint32Array;
  readonly chunkReferences: Uint32Array;
  readonly stats: {
    readonly nodeCount: number;
    readonly leafCount: number;
    readonly occurrenceCount: number;
    readonly chunkReferenceCount: number;
    readonly maxDepth: number;
    readonly leafCapacity: number;
  };
}

export interface SpatialDemandQueryFrame {
  readonly viewProjection: ArrayLike<number>;
  readonly origin: readonly [number, number, number];
}

export interface SpatialDemandQueryCandidate {
  readonly targetChunkIndex: number;
  readonly screenDistanceSquared: number;
}

export interface SpatialDemandQueryResult {
  readonly candidates: readonly SpatialDemandQueryCandidate[];
  readonly visitedNodeCount: number;
  readonly visibleLeafCount: number;
  readonly testedOccurrenceCount: number;
}

export class SpatialDemandIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpatialDemandIndexError";
  }
}

function invalid(message: string): never {
  throw new SpatialDemandIndexError(message);
}

function requireCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must fit an unsigned 32-bit integer.`);
  }
}

function checkedSectionEnd(offset: number, count: number, stride: number, label: string): number {
  const end = offset + count * stride;
  if (!Number.isSafeInteger(end) || end > 0xffff_ffff) {
    invalid(`${label} exceeds the v1 32-bit byte-length limit.`);
  }
  return end;
}

function containedBy(
  childBounds: Float64Array,
  childIndex: number,
  parentIndex: number,
): boolean {
  const child = childIndex * 6;
  const parent = parentIndex * 6;
  return (
    childBounds[child]! >= childBounds[parent]! &&
    childBounds[child + 1]! >= childBounds[parent + 1]! &&
    childBounds[child + 2]! >= childBounds[parent + 2]! &&
    childBounds[child + 3]! <= childBounds[parent + 3]! &&
    childBounds[child + 4]! <= childBounds[parent + 4]! &&
    childBounds[child + 5]! <= childBounds[parent + 5]!
  );
}

/**
 * Decodes and validates the allocation-safe v1 spatial demand sidecar.
 * All indexes are checked against the already-inspected glTF package before
 * the result is exposed to the query scheduler.
 */
export function decodeSpatialDemandIndex(
  bytes: Uint8Array,
  options: DecodeSpatialDemandIndexOptions,
): DecodedSpatialDemandIndex {
  requireCount(options.gltfNodeCount, "gltfNodeCount");
  requireCount(options.targetChunkCount, "targetChunkCount");
  if (options.expectedOccurrenceCount !== undefined) {
    requireCount(options.expectedOccurrenceCount, "expectedOccurrenceCount");
  }
  if (bytes.byteLength < headerByteLength) invalid("Spatial demand index header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (magic.some((value, index) => view.getUint8(index) !== value)) {
    invalid("Spatial demand index magic must be NSDI.");
  }
  if (view.getUint32(4, true) !== 1) invalid("Unsupported spatial demand index version.");
  if (view.getUint32(8, true) !== headerByteLength) invalid("Invalid spatial header byte length.");
  if (view.getUint32(12, true) !== nodeByteLength) invalid("Invalid spatial node byte length.");

  const nodeCount = view.getUint32(16, true);
  const leafCount = view.getUint32(20, true);
  const occurrenceCount = view.getUint32(24, true);
  const chunkReferenceCount = view.getUint32(28, true);
  const rootNode = view.getUint32(32, true);
  const maxDepth = view.getUint32(36, true);
  const leafCapacity = view.getUint32(40, true);
  const nodesOffset = view.getUint32(44, true);
  const occurrenceReferencesOffset = view.getUint32(48, true);
  const chunkReferencesOffset = view.getUint32(52, true);
  const totalByteLength = view.getUint32(56, true);
  const reserved = view.getUint32(60, true);

  if (nodeCount === 0 || leafCount === 0 || occurrenceCount === 0) {
    invalid("Spatial demand index counts must describe a non-empty tree.");
  }
  if (rootNode !== 0) invalid("Spatial demand index root must be node 0.");
  if (leafCapacity < 1 || leafCapacity > 65_535) invalid("Invalid spatial leaf capacity.");
  if (reserved !== 0) invalid("Spatial demand index reserved header field must be zero.");
  if (nodeCount > (options.maximumNodeCount ?? 10_000_000)) {
    invalid("Spatial demand index exceeds the configured node limit.");
  }
  if (occurrenceCount > (options.maximumOccurrenceCount ?? 10_000_000)) {
    invalid("Spatial demand index exceeds the configured occurrence limit.");
  }
  if (chunkReferenceCount > (options.maximumChunkReferenceCount ?? 20_000_000)) {
    invalid("Spatial demand index exceeds the configured chunk-reference limit.");
  }
  if (
    options.expectedOccurrenceCount !== undefined &&
    occurrenceCount !== options.expectedOccurrenceCount
  ) {
    invalid(
      `Spatial occurrence count must be ${options.expectedOccurrenceCount}; received ${occurrenceCount}.`,
    );
  }

  const expectedOccurrenceOffset = checkedSectionEnd(
    headerByteLength,
    nodeCount,
    nodeByteLength,
    "Spatial node table",
  );
  const expectedChunkOffset = checkedSectionEnd(
    expectedOccurrenceOffset,
    occurrenceCount,
    8,
    "Spatial occurrence-reference table",
  );
  const expectedTotal = checkedSectionEnd(
    expectedChunkOffset,
    chunkReferenceCount,
    4,
    "Spatial chunk-reference table",
  );
  if (
    nodesOffset !== headerByteLength ||
    occurrenceReferencesOffset !== expectedOccurrenceOffset ||
    chunkReferencesOffset !== expectedChunkOffset ||
    totalByteLength !== expectedTotal ||
    bytes.byteLength !== expectedTotal
  ) {
    invalid("Spatial demand index section offsets or total byte length are inconsistent.");
  }

  const bounds = new Float64Array(nodeCount * 6);
  const leftChildren = new Uint32Array(nodeCount);
  const rightChildren = new Uint32Array(nodeCount);
  const firstOccurrenceReferences = new Uint32Array(nodeCount);
  const occurrenceReferenceCounts = new Uint32Array(nodeCount);
  const firstChunkReferences = new Uint32Array(nodeCount);
  const chunkReferenceCounts = new Uint32Array(nodeCount);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const offset = nodesOffset + nodeIndex * nodeByteLength;
    for (let axis = 0; axis < 3; axis += 1) {
      const minimum = view.getFloat64(offset + axis * 8, true);
      const maximum = view.getFloat64(offset + 24 + axis * 8, true);
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
        invalid(`Spatial node ${nodeIndex} has invalid axis ${axis} bounds.`);
      }
      bounds[nodeIndex * 6 + axis] = minimum;
      bounds[nodeIndex * 6 + 3 + axis] = maximum;
    }
    leftChildren[nodeIndex] = view.getUint32(offset + 48, true);
    rightChildren[nodeIndex] = view.getUint32(offset + 52, true);
    firstOccurrenceReferences[nodeIndex] = view.getUint32(offset + 56, true);
    occurrenceReferenceCounts[nodeIndex] = view.getUint32(offset + 60, true);
    firstChunkReferences[nodeIndex] = view.getUint32(offset + 64, true);
    chunkReferenceCounts[nodeIndex] = view.getUint32(offset + 68, true);
  }

  const occurrenceNodeIndexes = new Uint32Array(occurrenceCount);
  const occurrenceTargetChunkIndexes = new Uint32Array(occurrenceCount);
  for (let index = 0; index < occurrenceCount; index += 1) {
    const offset = occurrenceReferencesOffset + index * 8;
    const nodeIndex = view.getUint32(offset, true);
    const chunkIndex = view.getUint32(offset + 4, true);
    if (nodeIndex >= options.gltfNodeCount) {
      invalid(`Spatial occurrence reference ${index} selects missing glTF node ${nodeIndex}.`);
    }
    if (chunkIndex >= options.targetChunkCount) {
      invalid(`Spatial occurrence reference ${index} selects missing target chunk ${chunkIndex}.`);
    }
    occurrenceNodeIndexes[index] = nodeIndex;
    occurrenceTargetChunkIndexes[index] = chunkIndex;
  }
  if (new Set(occurrenceNodeIndexes).size !== occurrenceCount) {
    invalid("Spatial occurrence references must contain unique glTF node indexes.");
  }

  const chunkReferences = new Uint32Array(chunkReferenceCount);
  for (let index = 0; index < chunkReferenceCount; index += 1) {
    const chunkIndex = view.getUint32(chunkReferencesOffset + index * 4, true);
    if (chunkIndex >= options.targetChunkCount) {
      invalid(`Spatial chunk reference ${index} selects missing target chunk ${chunkIndex}.`);
    }
    chunkReferences[index] = chunkIndex;
  }

  const occurrenceOwners = new Uint8Array(occurrenceCount);
  const chunkOwners = new Uint8Array(chunkReferenceCount);
  const visited = new Uint8Array(nodeCount);
  let observedLeaves = 0;
  let observedMaxDepth = 0;
  const stack: [number, number][] = [[0, 0]];
  while (stack.length > 0) {
    const [nodeIndex, depth] = stack.pop()!;
    if (nodeIndex >= nodeCount) invalid(`Spatial tree references missing node ${nodeIndex}.`);
    if (visited[nodeIndex] !== 0) invalid(`Spatial node ${nodeIndex} is cyclic or multiply referenced.`);
    visited[nodeIndex] = 1;
    observedMaxDepth = Math.max(observedMaxDepth, depth);
    const left = leftChildren[nodeIndex]!;
    const right = rightChildren[nodeIndex]!;
    const firstOccurrence = firstOccurrenceReferences[nodeIndex]!;
    const nodeOccurrenceCount = occurrenceReferenceCounts[nodeIndex]!;
    const firstChunk = firstChunkReferences[nodeIndex]!;
    const nodeChunkCount = chunkReferenceCounts[nodeIndex]!;
    const isLeaf = left === leafSentinel && right === leafSentinel;
    if ((left === leafSentinel) !== (right === leafSentinel)) {
      invalid(`Spatial node ${nodeIndex} must have either zero or two children.`);
    }
    if (!isLeaf) {
      if (nodeOccurrenceCount !== 0 || nodeChunkCount !== 0 || firstOccurrence !== 0 || firstChunk !== 0) {
        invalid(`Spatial internal node ${nodeIndex} must not own leaf references.`);
      }
      if (left >= nodeCount || right >= nodeCount || left === right) {
        invalid(`Spatial internal node ${nodeIndex} has invalid children.`);
      }
      if (!containedBy(bounds, left, nodeIndex) || !containedBy(bounds, right, nodeIndex)) {
        invalid(`Spatial node ${nodeIndex} does not contain both child bounds.`);
      }
      stack.push([right, depth + 1], [left, depth + 1]);
      continue;
    }

    observedLeaves += 1;
    if (nodeOccurrenceCount < 1 || nodeOccurrenceCount > leafCapacity || nodeChunkCount < 1) {
      invalid(`Spatial leaf ${nodeIndex} has invalid reference counts.`);
    }
    if (firstOccurrence + nodeOccurrenceCount > occurrenceCount) {
      invalid(`Spatial leaf ${nodeIndex} occurrence range is out of bounds.`);
    }
    if (firstChunk + nodeChunkCount > chunkReferenceCount) {
      invalid(`Spatial leaf ${nodeIndex} chunk range is out of bounds.`);
    }
    const expectedChunks = new Set<number>();
    for (let index = firstOccurrence; index < firstOccurrence + nodeOccurrenceCount; index += 1) {
      if (occurrenceOwners[index] !== 0) invalid(`Spatial occurrence reference ${index} has two owners.`);
      occurrenceOwners[index] = 1;
      expectedChunks.add(occurrenceTargetChunkIndexes[index]!);
    }
    let previousChunk = -1;
    for (let index = firstChunk; index < firstChunk + nodeChunkCount; index += 1) {
      if (chunkOwners[index] !== 0) invalid(`Spatial chunk reference ${index} has two owners.`);
      chunkOwners[index] = 1;
      const chunkIndex = chunkReferences[index]!;
      if (chunkIndex <= previousChunk) invalid(`Spatial leaf ${nodeIndex} chunk references must be sorted and unique.`);
      previousChunk = chunkIndex;
      if (!expectedChunks.delete(chunkIndex)) {
        invalid(`Spatial leaf ${nodeIndex} has a chunk reference without an occurrence.`);
      }
    }
    if (expectedChunks.size !== 0) invalid(`Spatial leaf ${nodeIndex} omits an occurrence chunk.`);
  }

  if (visited.some((value) => value === 0)) invalid("Spatial tree contains unreachable nodes.");
  if (occurrenceOwners.some((value) => value === 0)) invalid("Spatial tree omits occurrence references.");
  if (chunkOwners.some((value) => value === 0)) invalid("Spatial tree omits chunk references.");
  if (observedLeaves !== leafCount || observedMaxDepth !== maxDepth) {
    invalid("Spatial tree statistics do not match the header.");
  }

  return {
    schemaVersion: supportedSpatialDemandIndexSchema,
    bounds,
    leftChildren,
    rightChildren,
    firstOccurrenceReferences,
    occurrenceReferenceCounts,
    firstChunkReferences,
    chunkReferenceCounts,
    occurrenceNodeIndexes,
    occurrenceTargetChunkIndexes,
    chunkReferences,
    stats: {
      nodeCount,
      leafCount,
      occurrenceCount,
      chunkReferenceCount,
      maxDepth,
      leafCapacity,
    },
  };
}

function projectedNodeBounds(
  index: DecodedSpatialDemandIndex,
  nodeIndex: number,
  frame: SpatialDemandQueryFrame,
): { readonly visible: boolean; readonly distanceSquared: number } {
  const offset = nodeIndex * 6;
  const minimumX = index.bounds[offset]! - frame.origin[0];
  const minimumY = index.bounds[offset + 1]! - frame.origin[1];
  const minimumZ = index.bounds[offset + 2]! - frame.origin[2];
  const maximumX = index.bounds[offset + 3]! - frame.origin[0];
  const maximumY = index.bounds[offset + 4]! - frame.origin[1];
  const maximumZ = index.bounds[offset + 5]! - frame.origin[2];
  const matrix = frame.viewProjection;
  let outsideLeft = true;
  let outsideRight = true;
  let outsideBottom = true;
  let outsideTop = true;
  let outsideNear = true;
  let outsideFar = true;
  for (const x of [minimumX, maximumX]) {
    for (const y of [minimumY, maximumY]) {
      for (const z of [minimumZ, maximumZ]) {
        const clipX =
          (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z +
          (matrix[12] ?? 0);
        const clipY =
          (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z +
          (matrix[13] ?? 0);
        const clipZ =
          (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z +
          (matrix[14] ?? 0);
        const clipW =
          (matrix[3] ?? 0) * x + (matrix[7] ?? 0) * y + (matrix[11] ?? 0) * z +
          (matrix[15] ?? 0);
        outsideLeft &&= clipX < -clipW;
        outsideRight &&= clipX > clipW;
        outsideBottom &&= clipY < -clipW;
        outsideTop &&= clipY > clipW;
        outsideNear &&= clipZ < 0;
        outsideFar &&= clipZ > clipW;
      }
    }
  }
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  const centerZ = (minimumZ + maximumZ) / 2;
  const projectedX =
    (matrix[0] ?? 0) * centerX + (matrix[4] ?? 0) * centerY +
    (matrix[8] ?? 0) * centerZ + (matrix[12] ?? 0);
  const projectedY =
    (matrix[1] ?? 0) * centerX + (matrix[5] ?? 0) * centerY +
    (matrix[9] ?? 0) * centerZ + (matrix[13] ?? 0);
  const projectedW =
    (matrix[3] ?? 0) * centerX + (matrix[7] ?? 0) * centerY +
    (matrix[11] ?? 0) * centerZ + (matrix[15] ?? 0);
  const screenX = projectedW === 0 ? Infinity : projectedX / projectedW;
  const screenY = projectedW === 0 ? Infinity : projectedY / projectedW;
  return {
    visible:
      !(outsideLeft || outsideRight || outsideBottom || outsideTop || outsideNear || outsideFar),
    distanceSquared: screenX * screenX + screenY * screenY,
  };
}

/** Conservatively returns the target chunks referenced by frustum-visible BVH leaves. */
export function querySpatialDemandIndex(
  index: DecodedSpatialDemandIndex,
  frame: SpatialDemandQueryFrame,
): SpatialDemandQueryResult {
  if (
    frame.viewProjection.length !== 16 ||
    Array.from(frame.viewProjection).some((value) => !Number.isFinite(value)) ||
    frame.origin.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError("A spatial demand query needs a finite 4x4 matrix and world origin.");
  }
  const stack = [0];
  const distances = new Map<number, number>();
  let visitedNodeCount = 0;
  let visibleLeafCount = 0;
  let testedOccurrenceCount = 0;
  while (stack.length > 0) {
    const nodeIndex = stack.pop()!;
    visitedNodeCount += 1;
    const projection = projectedNodeBounds(index, nodeIndex, frame);
    if (!projection.visible) continue;
    const left = index.leftChildren[nodeIndex]!;
    const right = index.rightChildren[nodeIndex]!;
    if (left !== leafSentinel) {
      stack.push(right, left);
      continue;
    }
    visibleLeafCount += 1;
    testedOccurrenceCount += index.occurrenceReferenceCounts[nodeIndex]!;
    const first = index.firstChunkReferences[nodeIndex]!;
    const end = first + index.chunkReferenceCounts[nodeIndex]!;
    for (let chunkReference = first; chunkReference < end; chunkReference += 1) {
      const targetChunkIndex = index.chunkReferences[chunkReference]!;
      distances.set(
        targetChunkIndex,
        Math.min(distances.get(targetChunkIndex) ?? Infinity, projection.distanceSquared),
      );
    }
  }
  const candidates = [...distances]
    .map(([targetChunkIndex, screenDistanceSquared]) => ({
      targetChunkIndex,
      screenDistanceSquared,
    }))
    .sort(
      (left, right) =>
        left.screenDistanceSquared - right.screenDistanceSquared ||
        left.targetChunkIndex - right.targetChunkIndex,
    );
  return { candidates, visitedNodeCount, visibleLeafCount, testedOccurrenceCount };
}
