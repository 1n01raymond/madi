import { createHash } from "node:crypto";

import {
  isColumnPropertyBag,
  packagePropertiesSchema,
  validateScene,
} from "@naru3d/scene-ir";
import type {
  ColumnPropertyBag,
  EngineeringScene,
  Material,
  MaterialId,
  Matrix4d,
  Occurrence,
  PackagePropertiesDocument,
  Prototype,
  Representation,
} from "@naru3d/scene-ir";

import {
  encodeFloat32,
  encodeUint32,
  encodeUint8,
  GltfBinaryBuilder,
  scaledPositionBounds,
} from "./binary.js";
import {
  compilerEvidenceSchema,
  experimentalGltfProfile,
} from "./types.js";
import {
  encodeSpatialDemandIndex,
  partitionSpatialDemandLeaves,
  spatialDemandIndexSchema,
} from "./spatial-demand.js";
import type {
  SpatialDemandBoundsOccurrence,
  SpatialVector3,
} from "./spatial-demand.js";
import type {
  CompileGltfOptions,
  CompiledGltfPackage,
  CompilerBuildReport,
  GltfAccessor,
  GltfBufferView,
  GltfDocument,
  GltfMaterial,
  GltfMesh,
  GltfNode,
  GltfPrimitive,
} from "./types.js";

const identityBasis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const zeroOrigin = [0, 0, 0];

interface SurfaceGroupResource {
  readonly indexAccessor: number;
  readonly materialId?: MaterialId;
  readonly firstIndex: number;
  readonly indexCount: number;
}

interface GeometryResource {
  readonly prototype: Prototype;
  readonly representation: Representation;
  readonly positionAccessor?: number;
  readonly normalAccessor?: number;
  readonly surfaceGroups: readonly SurfaceGroupResource[];
  readonly faceSourceAccessor?: number;
  readonly edgePositionAccessor?: number;
  readonly edgeIndexAccessor?: number;
  readonly edgeClassAccessor?: number;
  readonly edgeSourceAccessor?: number;
}

interface CoarseGeometryResource {
  readonly prototype: Prototype;
  readonly representation: Representation;
  readonly positionAccessor: number;
  readonly normalAccessor: number;
  readonly indexAccessor: number;
  readonly edgePositionAccessor: number;
  readonly edgeIndexAccessor: number;
  readonly minimum: SpatialVector3;
  readonly maximum: SpatialVector3;
}

interface TargetGeometryRange {
  readonly prototypeId: string;
  readonly byteOffset: number;
  readonly byteLength: number;
}

interface TargetChunkCandidate extends TargetGeometryRange {
  readonly meshIndexes: readonly number[];
  readonly occurrenceCount: number;
}

interface TargetChunkGroup {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly meshIndexes: readonly number[];
  readonly prototypeIds: readonly string[];
  readonly occurrenceCount: number;
}

function compareId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id, "en");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function targetChunkGroups(
  candidates: readonly TargetChunkCandidate[],
  byteBudget: number | undefined,
): readonly TargetChunkGroup[] {
  const sourceOrder = [...candidates].sort(
    (left, right) =>
      left.byteOffset - right.byteOffset || left.prototypeId.localeCompare(right.prototypeId, "en"),
  );
  if (byteBudget === undefined) {
    return sourceOrder.map((candidate) => ({
      byteOffset: candidate.byteOffset,
      byteLength: candidate.byteLength,
      meshIndexes: candidate.meshIndexes,
      prototypeIds: [candidate.prototypeId],
      occurrenceCount: candidate.occurrenceCount,
    }));
  }

  const groups: TargetChunkGroup[] = [];
  let members: TargetChunkCandidate[] = [];
  let byteOffset = 0;
  let byteEnd = 0;
  const finish = (): void => {
    if (members.length === 0) return;
    groups.push({
      byteOffset,
      byteLength: byteEnd - byteOffset,
      meshIndexes: members.flatMap(({ meshIndexes }) => meshIndexes),
      prototypeIds: members.map(({ prototypeId }) => prototypeId),
      occurrenceCount: members.reduce((total, { occurrenceCount }) => total + occurrenceCount, 0),
    });
    members = [];
  };

  for (const candidate of sourceOrder) {
    const candidateEnd = candidate.byteOffset + candidate.byteLength;
    const contiguous = members.length === 0 || candidate.byteOffset === byteEnd;
    const nextLength = candidateEnd - byteOffset;
    if (members.length > 0 && (!contiguous || nextLength > byteBudget)) finish();
    if (members.length === 0) {
      byteOffset = candidate.byteOffset;
      byteEnd = candidateEnd;
    } else {
      byteEnd = candidateEnd;
    }
    members.push(candidate);
  }
  finish();
  return groups;
}

function assertCanonicalFrame(scene: EngineeringScene): void {
  if (
    scene.rootFrame.handedness !== "right" ||
    scene.rootFrame.origin.some((value, index) => value !== zeroOrigin[index]) ||
    scene.rootFrame.basis.some((value, index) => value !== identityBasis[index])
  ) {
    throw new TypeError(
      "The experimental glTF profile currently requires a right-handed, identity root frame.",
    );
  }
  if (!Number.isFinite(scene.units.scaleToMeters) || scene.units.scaleToMeters <= 0) {
    throw new TypeError("Scene length units must declare a positive scaleToMeters value.");
  }
}

function sourceToGltfMatrix(upAxis: "X" | "Y" | "Z"): readonly number[] {
  if (upAxis === "Y") {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  if (upAxis === "Z") {
    return [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  }
  return [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];
}

const maximumF32TranslationErrorMeters = 1e-8;

function deliveredTranslation(value: number): number {
  const rounded = Math.fround(value);
  return Math.abs(value - rounded) <= maximumF32TranslationErrorMeters ? rounded : value;
}

function scaledOccurrenceMatrix(matrix: Matrix4d, scaleToMeters: number): number[] {
  return Array.from(matrix, (value, index) =>
    index >= 12 && index <= 14
      ? deliveredTranslation(value * scaleToMeters)
      : Math.fround(value),
  );
}

function multiplyMatrices(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const result = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (a[index * 4 + row] ?? 0) * (b[column * 4 + index] ?? 0);
      }
      result[column * 4 + row] = value;
    }
  }
  return result;
}

function transformedBounds(
  matrix: ArrayLike<number>,
  minimum: SpatialVector3,
  maximum: SpatialVector3,
): { readonly minimum: SpatialVector3; readonly maximum: SpatialVector3 } {
  const worldMinimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const worldMaximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const x of [minimum[0], maximum[0]]) {
    for (const y of [minimum[1], maximum[1]]) {
      for (const z of [minimum[2], maximum[2]]) {
        const point = [
          (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
          (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
          (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
        ] as const;
        for (const axis of [0, 1, 2] as const) {
          worldMinimum[axis] = Math.min(worldMinimum[axis], point[axis]);
          worldMaximum[axis] = Math.max(worldMaximum[axis], point[axis]);
        }
      }
    }
  }
  return { minimum: worldMinimum, maximum: worldMaximum };
}

function occurrenceWorldMatrices(
  occurrences: readonly Occurrence[],
  sourceMatrix: ArrayLike<number>,
  scaleToMeters: number,
): ReadonlyMap<string, Float64Array> {
  const byId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const result = new Map<string, Float64Array>();
  const visiting = new Set<string>();
  const worldFor = (occurrence: Occurrence): Float64Array => {
    const existing = result.get(occurrence.id);
    if (existing) return existing;
    if (visiting.has(occurrence.id)) {
      throw new TypeError(`Occurrence hierarchy cycle at ${occurrence.id}.`);
    }
    visiting.add(occurrence.id);
    const parent = occurrence.parentId ? byId.get(occurrence.parentId) : undefined;
    if (occurrence.parentId && !parent) {
      throw new TypeError(`Missing parent occurrence ${occurrence.parentId}.`);
    }
    const parentMatrix = parent ? worldFor(parent) : sourceMatrix;
    const world = multiplyMatrices(
      parentMatrix,
      scaledOccurrenceMatrix(occurrence.localTransform, scaleToMeters),
    );
    visiting.delete(occurrence.id);
    result.set(occurrence.id, world);
    return world;
  };
  for (const occurrence of occurrences) worldFor(occurrence);
  return result;
}

interface SpatialPayloadOccurrence extends SpatialDemandBoundsOccurrence {
  readonly prototypeId: string;
}

function localDeliveredBounds(
  representation: Representation,
  scaleToMeters: number,
): { readonly minimum: SpatialVector3; readonly maximum: SpatialVector3 } {
  const surfacePositions = representation.surface?.positions;
  const positions = surfacePositions && surfacePositions.length > 0
    ? surfacePositions
    : representation.edges?.positions;
  if (!positions || positions.length === 0) {
    throw new TypeError(`Representation ${representation.id} has no positions for coarse bounds.`);
  }
  const { min, max } = scaledPositionBounds(positions, 1);
  return {
    minimum: [
      Math.fround((min[0] ?? 0) * scaleToMeters),
      Math.fround((min[1] ?? 0) * scaleToMeters),
      Math.fround((min[2] ?? 0) * scaleToMeters),
    ],
    maximum: [
      Math.fround((max[0] ?? 0) * scaleToMeters),
      Math.fround((max[1] ?? 0) * scaleToMeters),
      Math.fround((max[2] ?? 0) * scaleToMeters),
    ],
  };
}

function spatialPayloadPrototypeOrder(
  prototypes: readonly Prototype[],
  occurrences: readonly Occurrence[],
  representations: ReadonlyMap<string, Representation>,
  sourceMatrix: ArrayLike<number>,
  scaleToMeters: number,
  leafCapacity: number | undefined,
): readonly Prototype[] {
  const prototypeById = new Map(prototypes.map((prototype) => [prototype.id, prototype]));
  const localBounds = new Map<string, ReturnType<typeof localDeliveredBounds>>();
  for (const prototype of prototypes) {
    const representation = representationFor(prototype, representations);
    if (representation) {
      localBounds.set(prototype.id, localDeliveredBounds(representation, scaleToMeters));
    }
  }
  const worldMatrices = occurrenceWorldMatrices(occurrences, sourceMatrix, scaleToMeters);
  const entries: SpatialPayloadOccurrence[] = occurrences.flatMap((occurrence, index) => {
    const local = localBounds.get(occurrence.prototypeId);
    const world = worldMatrices.get(occurrence.id);
    if (!local || !world || !prototypeById.has(occurrence.prototypeId)) return [];
    return [{
      id: occurrence.id,
      nodeIndex: index + 1,
      prototypeId: occurrence.prototypeId,
      ...transformedBounds(world, local.minimum, local.maximum),
    }];
  });
  if (entries.length === 0) return prototypes;
  const leaves = partitionSpatialDemandLeaves(entries, {
    ...(leafCapacity === undefined ? {} : { leafCapacity }),
  });
  const countsByPrototype = new Map<string, Map<number, number>>();
  leaves.forEach((leaf, leafIndex) => {
    for (const occurrence of leaf) {
      const counts = countsByPrototype.get(occurrence.prototypeId) ?? new Map<number, number>();
      counts.set(leafIndex, (counts.get(leafIndex) ?? 0) + 1);
      countsByPrototype.set(occurrence.prototypeId, counts);
    }
  });
  const anchorFor = (prototypeId: string): { readonly leaf: number; readonly count: number } => {
    const counts = countsByPrototype.get(prototypeId);
    if (!counts) return { leaf: Number.MAX_SAFE_INTEGER, count: 0 };
    return [...counts]
      .map(([leaf, count]) => ({ leaf, count }))
      .sort((left, right) => right.count - left.count || left.leaf - right.leaf)[0] ?? {
        leaf: Number.MAX_SAFE_INTEGER,
        count: 0,
      };
  };
  const anchors = new Map(prototypes.map(({ id }) => [id, anchorFor(id)]));
  return [...prototypes].sort((left, right) => {
    const leftAnchor = anchors.get(left.id) ?? { leaf: Number.MAX_SAFE_INTEGER, count: 0 };
    const rightAnchor = anchors.get(right.id) ?? { leaf: Number.MAX_SAFE_INTEGER, count: 0 };
    return leftAnchor.leaf - rightAnchor.leaf ||
      rightAnchor.count - leftAnchor.count ||
      left.id.localeCompare(right.id, "en");
  });
}

function gltfMaterial(material: Material, edge: boolean): GltfMaterial {
  const color = edge ? (material.edgeStyle?.color ?? material.baseColor) : material.baseColor;
  const alphaMode = material.alphaMode?.toUpperCase() as
    | "OPAQUE"
    | "MASK"
    | "BLEND"
    | undefined;
  return {
    name: `${material.name ?? material.id}${edge ? " edges" : ""}`,
    pbrMetallicRoughness: {
      baseColorFactor: color,
      metallicFactor: edge ? 0 : (material.metallic ?? 0),
      roughnessFactor: edge ? 1 : (material.roughness ?? 1),
    },
    ...(material.doubleSided === undefined ? {} : { doubleSided: material.doubleSided }),
    ...(alphaMode === undefined ? {} : { alphaMode }),
    extras: { madi: { materialId: material.id, role: edge ? "edge" : "surface" } },
  };
}

function fallbackMaterial(edge: boolean): GltfMaterial {
  return {
    name: edge ? "MADI fallback edges" : "MADI fallback surface",
    pbrMetallicRoughness: {
      baseColorFactor: edge ? [0.025, 0.045, 0.06, 1] : [0.55, 0.62, 0.68, 1],
      metallicFactor: edge ? 0 : 0.05,
      roughnessFactor: edge ? 1 : 0.72,
    },
    extras: { madi: { role: edge ? "edge" : "surface", fallback: true } },
  };
}

function representationFor(
  prototype: Prototype,
  representations: ReadonlyMap<string, Representation>,
): Representation | undefined {
  const candidates = prototype.representationIds
    .map((id) => representations.get(id))
    .filter((value): value is Representation => value !== undefined)
    .filter(({ purpose }) => purpose === "display")
    .sort(compareId);
  if (candidates.length > 1) {
    throw new TypeError(`Prototype ${prototype.id} has multiple display representations.`);
  }
  return candidates[0];
}

function sharesTypedArrayStorage(
  left: ArrayBufferView,
  right: ArrayBufferView,
): boolean {
  return (
    left.buffer === right.buffer &&
    left.byteOffset === right.byteOffset &&
    left.byteLength === right.byteLength
  );
}

function appendGeometry(
  builder: GltfBinaryBuilder,
  prototype: Prototype,
  representation: Representation,
  scaleToMeters: number,
): { readonly resource: GeometryResource; readonly triangles: number; readonly edges: number } {
  const surface = representation.surface;
  const edges = representation.edges;
  let positionAccessor: number | undefined;
  let normalAccessor: number | undefined;
  let faceSourceAccessor: number | undefined;
  const surfaceGroups: SurfaceGroupResource[] = [];
  let triangleCount = 0;

  if (surface && surface.positions.length > 0 && surface.indices.length > 0) {
    const bounds = scaledPositionBounds(surface.positions, scaleToMeters);
    positionAccessor = builder.append(encodeFloat32(surface.positions, scaleToMeters), {
      componentType: 5126,
      count: surface.positions.length / 3,
      type: "VEC3",
      target: 34962,
      name: `${representation.id} surface positions`,
      ...bounds,
    });
    if (surface.normals) {
      normalAccessor = builder.append(encodeFloat32(surface.normals), {
        componentType: 5126,
        count: surface.normals.length / 3,
        type: "VEC3",
        target: 34962,
        name: `${representation.id} surface normals`,
      });
    }
    if (surface.faceSourceIds) {
      faceSourceAccessor = builder.append(encodeUint32(surface.faceSourceIds), {
        componentType: 5125,
        count: surface.faceSourceIds.length,
        type: "SCALAR",
        name: `${representation.id} face source IDs`,
      });
    }

    const groups = surface.materialGroups?.length
      ? [...surface.materialGroups]
      : [{ firstIndex: 0, indexCount: surface.indices.length, materialId: undefined }];
    groups.sort((left, right) => left.firstIndex - right.firstIndex);
    for (const [groupIndex, group] of groups.entries()) {
      const lastIndex = group.firstIndex + group.indexCount;
      if (lastIndex > surface.indices.length || group.indexCount % 3 !== 0) {
        throw new RangeError(`Invalid material group ${groupIndex} in ${representation.id}.`);
      }
      const indices = surface.indices.slice(group.firstIndex, lastIndex);
      const indexAccessor = builder.append(encodeUint32(indices), {
        componentType: 5125,
        count: indices.length,
        type: "SCALAR",
        target: 34963,
        name: `${representation.id} surface indices ${groupIndex}`,
        min: [indices.reduce((minimum, value) => Math.min(minimum, value), Infinity)],
        max: [indices.reduce((maximum, value) => Math.max(maximum, value), -Infinity)],
      });
      surfaceGroups.push({
        indexAccessor,
        ...(group.materialId === undefined ? {} : { materialId: group.materialId }),
        firstIndex: group.firstIndex,
        indexCount: group.indexCount,
      });
      triangleCount += group.indexCount / 3;
    }
  }

  let edgePositionAccessor: number | undefined;
  let edgeIndexAccessor: number | undefined;
  let edgeClassAccessor: number | undefined;
  let edgeSourceAccessor: number | undefined;
  if (edges && edges.positions.length > 0 && edges.segments.length > 0) {
    if (
      positionAccessor !== undefined &&
      surface !== undefined &&
      sharesTypedArrayStorage(edges.positions, surface.positions)
    ) {
      edgePositionAccessor = positionAccessor;
    } else {
      const bounds = scaledPositionBounds(edges.positions, scaleToMeters);
      edgePositionAccessor = builder.append(encodeFloat32(edges.positions, scaleToMeters), {
        componentType: 5126,
        count: edges.positions.length / 3,
        type: "VEC3",
        target: 34962,
        name: `${representation.id} edge positions`,
        ...bounds,
      });
    }
    edgeIndexAccessor = builder.append(encodeUint32(edges.segments), {
      componentType: 5125,
      count: edges.segments.length,
      type: "SCALAR",
      target: 34963,
      name: `${representation.id} edge indices`,
      min: [edges.segments.reduce((minimum, value) => Math.min(minimum, value), Infinity)],
      max: [edges.segments.reduce((maximum, value) => Math.max(maximum, value), -Infinity)],
    });
    edgeClassAccessor = builder.append(encodeUint8(edges.classes), {
      componentType: 5121,
      count: edges.classes.length,
      type: "SCALAR",
      name: `${representation.id} edge classes`,
    });
    if (edges.sourceIds) {
      edgeSourceAccessor = builder.append(encodeUint32(edges.sourceIds), {
        componentType: 5125,
        count: edges.sourceIds.length,
        type: "SCALAR",
        name: `${representation.id} edge source IDs`,
      });
    }
  }

  return {
    resource: {
      prototype,
      representation,
      ...(positionAccessor === undefined ? {} : { positionAccessor }),
      ...(normalAccessor === undefined ? {} : { normalAccessor }),
      surfaceGroups,
      ...(faceSourceAccessor === undefined ? {} : { faceSourceAccessor }),
      ...(edgePositionAccessor === undefined ? {} : { edgePositionAccessor }),
      ...(edgeIndexAccessor === undefined ? {} : { edgeIndexAccessor }),
      ...(edgeClassAccessor === undefined ? {} : { edgeClassAccessor }),
      ...(edgeSourceAccessor === undefined ? {} : { edgeSourceAccessor }),
    },
    triangles: triangleCount,
    edges: edges?.segments.length ? edges.segments.length / 2 : 0,
  };
}

function appendCoarseBounds(
  builder: GltfBinaryBuilder,
  prototype: Prototype,
  representation: Representation,
  scaleToMeters: number,
): CoarseGeometryResource {
  const surfacePositionsSource = representation.surface?.positions;
  const sourcePositions = surfacePositionsSource && surfacePositionsSource.length > 0
    ? surfacePositionsSource
    : representation.edges?.positions;
  if (!sourcePositions || sourcePositions.length === 0) {
    throw new TypeError(`Representation ${representation.id} has no positions for coarse bounds.`);
  }
  const { min, max } = scaledPositionBounds(sourcePositions, 1);
  const [minX = 0, minY = 0, minZ = 0] = min;
  const [maxX = 0, maxY = 0, maxZ = 0] = max;
  const deliveredMinimum: SpatialVector3 = [
    Math.fround(minX * scaleToMeters),
    Math.fround(minY * scaleToMeters),
    Math.fround(minZ * scaleToMeters),
  ];
  const deliveredMaximum: SpatialVector3 = [
    Math.fround(maxX * scaleToMeters),
    Math.fround(maxY * scaleToMeters),
    Math.fround(maxZ * scaleToMeters),
  ];
  const corners: readonly (readonly [number, number, number])[] = [
    [minX, minY, minZ],
    [maxX, minY, minZ],
    [maxX, maxY, minZ],
    [minX, maxY, minZ],
    [minX, minY, maxZ],
    [maxX, minY, maxZ],
    [maxX, maxY, maxZ],
    [minX, maxY, maxZ],
  ];
  const faces = [
    { corners: [0, 3, 2, 1], normal: [0, 0, -1] },
    { corners: [4, 5, 6, 7], normal: [0, 0, 1] },
    { corners: [0, 1, 5, 4], normal: [0, -1, 0] },
    { corners: [3, 7, 6, 2], normal: [0, 1, 0] },
    { corners: [0, 4, 7, 3], normal: [-1, 0, 0] },
    { corners: [1, 2, 6, 5], normal: [1, 0, 0] },
  ] as const;
  const surfacePositions = faces.flatMap((face) =>
    face.corners.flatMap((corner) => [...(corners[corner] ?? [0, 0, 0])]),
  );
  const normals = faces.flatMap((face) => face.corners.flatMap(() => [...face.normal]));
  const indices = faces.flatMap((_, faceIndex) => {
    const offset = faceIndex * 4;
    return [offset, offset + 1, offset + 2, offset, offset + 2, offset + 3];
  });
  const edgeIndices = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  const positionAccessor = builder.append(encodeFloat32(surfacePositions, scaleToMeters), {
    componentType: 5126,
    count: 24,
    type: "VEC3",
    target: 34962,
    name: `${representation.id} coarse bounds positions`,
    min: min.map((value) => Math.fround(value * scaleToMeters)),
    max: max.map((value) => Math.fround(value * scaleToMeters)),
  });
  const normalAccessor = builder.append(encodeFloat32(normals), {
    componentType: 5126,
    count: 24,
    type: "VEC3",
    target: 34962,
    name: `${representation.id} coarse bounds normals`,
  });
  const indexAccessor = builder.append(encodeUint32(indices), {
    componentType: 5125,
    count: indices.length,
    type: "SCALAR",
    target: 34963,
    name: `${representation.id} coarse bounds surface indices`,
    min: [0],
    max: [23],
  });
  const edgePositionAccessor = builder.append(encodeFloat32(corners.flat(), scaleToMeters), {
    componentType: 5126,
    count: 8,
    type: "VEC3",
    target: 34962,
    name: `${representation.id} coarse bounds edge positions`,
    min: min.map((value) => Math.fround(value * scaleToMeters)),
    max: max.map((value) => Math.fround(value * scaleToMeters)),
  });
  const edgeIndexAccessor = builder.append(encodeUint32(edgeIndices), {
    componentType: 5125,
    count: edgeIndices.length,
    type: "SCALAR",
    target: 34963,
    name: `${representation.id} coarse bounds edge indices`,
    min: [0],
    max: [7],
  });
  return {
    prototype,
    representation,
    positionAccessor,
    normalAccessor,
    indexAccessor,
    edgePositionAccessor,
    edgeIndexAccessor,
    minimum: deliveredMinimum,
    maximum: deliveredMaximum,
  };
}

interface PropertySidecar {
  readonly json: string;
  readonly jsonBytes: Uint8Array;
  readonly jsonDigest: string;
  readonly binary: Uint8Array;
  readonly binaryDigest: string;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Builds the compiled-package property sidecar
 * (`madi.package-properties.1`): a compact-JSON document holding the scene's
 * property key/key-set index and a columnar table of every column-bag
 * semantic, next to the adapter's `madi.property-columns.1` file carried
 * byte-verbatim. Values are never materialized — only the u32 stream bounds
 * are checked against the provided file.
 */
function buildPropertySidecar(
  scene: EngineeringScene,
  columns: Uint8Array,
  columnsUri: string,
): PropertySidecar {
  const propertyValues = scene.propertyValues;
  const propertyIndex = scene.propertyIndex;
  if (propertyValues === undefined || propertyIndex === undefined) {
    throw new TypeError(
      "Property columns were provided, but the scene declares no property value columns.",
    );
  }
  for (const stream of [
    propertyValues.rows,
    propertyValues.rowOffsets,
    propertyValues.valueOffsets,
    propertyValues.valueHeap,
  ]) {
    if (stream.byteOffset + stream.byteLength > columns.byteLength) {
      throw new RangeError("Property column stream exceeds the provided column file.");
    }
  }
  const semantics = scene.semantics
    .filter((semantic) => isColumnPropertyBag(semantic.properties))
    .sort((left, right) => codeUnitCompare(left.id, right.id));
  const schemas = [
    ...new Set(
      semantics
        .map(({ properties }) => (properties as ColumnPropertyBag).schema)
        .filter((schema): schema is string => schema !== undefined),
    ),
  ].sort(codeUnitCompare);
  const schemaIndexes = new Map(schemas.map((schema, index) => [schema, index]));
  const document: PackagePropertiesDocument = {
    schemaVersion: packagePropertiesSchema,
    status: "experimental-not-interchange",
    sceneId: scene.sceneId,
    revisionId: scene.revision.id,
    sourceDigest: scene.revision.sourceDigest,
    propertyIndex,
    schemas,
    semanticIds: semantics.map(({ id }) => id),
    semanticSchemas: semantics.map(({ properties }) => {
      const schema = (properties as ColumnPropertyBag).schema;
      return schema === undefined ? null : (schemaIndexes.get(schema) as number);
    }),
    semanticSets: semantics.map(({ properties }) => (properties as ColumnPropertyBag).set),
    semanticRows: semantics.map(({ properties }) => (properties as ColumnPropertyBag).row),
    columns: {
      uri: columnsUri,
      byteLength: columns.byteLength,
      sha256: sha256(columns),
    },
    propertyValues,
  };
  // Compact on purpose: the semantic table is columnar and real-large
  // federations reach hundreds of thousands of rows, so pretty-printing
  // would multiply the document by line-per-number formatting.
  const json = `${JSON.stringify(document)}\n`;
  const jsonBytes = new TextEncoder().encode(json);
  return {
    json,
    jsonBytes,
    jsonDigest: sha256(jsonBytes),
    binary: columns,
    binaryDigest: document.columns.sha256,
  };
}

export function compileSceneToGltf(
  scene: EngineeringScene,
  options: CompileGltfOptions = {},
): CompiledGltfPackage {
  if (
    options.targetChunkByteBudget !== undefined &&
    (!Number.isSafeInteger(options.targetChunkByteBudget) || options.targetChunkByteBudget < 4)
  ) {
    throw new TypeError("targetChunkByteBudget must be an integer of at least four bytes.");
  }
  const validation = validateScene(scene);
  if (!validation.ok) {
    const errors = validation.issues
      .filter(({ severity }) => severity === "error")
      .slice(0, 5)
      .map(({ code, path }) => `${code} at ${path}`)
      .join(", ");
    throw new TypeError(`Scene IR validation failed: ${errors}`);
  }
  assertCanonicalFrame(scene);

  const binaryUri = options.binaryUri ?? "scene.bin";
  const coarseBounds = options.coarseBounds ?? false;
  const coarseBinaryUri = options.coarseBinaryUri ?? "coarse.bin";
  if (coarseBounds && coarseBinaryUri === binaryUri) {
    throw new TypeError("Target and coarse glTF buffers must use different URIs.");
  }
  if (options.spatialIndex === true && !coarseBounds) {
    throw new TypeError("A spatial demand index requires coarse bounds and target chunks.");
  }
  if (options.spatialLeafCapacity !== undefined && options.spatialIndex !== true) {
    throw new TypeError("spatialLeafCapacity requires spatialIndex.");
  }
  if (
    options.spatialPayloadOrder === true &&
    (options.spatialIndex !== true || options.targetChunkByteBudget === undefined)
  ) {
    throw new TypeError("spatialPayloadOrder requires spatialIndex and targetChunkByteBudget.");
  }
  const spatialBinaryUri = options.spatialBinaryUri ?? "spatial.bin";
  if (
    options.spatialIndex === true &&
    new Set(["scene.gltf", binaryUri, coarseBinaryUri]).has(spatialBinaryUri)
  ) {
    throw new TypeError("The spatial index resource URI must be distinct.");
  }
  if (scene.propertyValues !== undefined && options.propertyColumns === undefined) {
    throw new TypeError(
      "A scene with property value columns requires options.propertyColumns.",
    );
  }
  const propertiesUri = options.propertiesUri ?? "properties.json";
  const propertiesBinaryUri = options.propertiesBinaryUri ?? "properties.bin";
  const propertySidecar = options.propertyColumns
    ? buildPropertySidecar(scene, options.propertyColumns, propertiesBinaryUri)
    : undefined;
  if (propertySidecar) {
    const uris = new Set([
      binaryUri,
      ...(coarseBounds ? [coarseBinaryUri] : []),
      ...(options.spatialIndex === true ? [spatialBinaryUri] : []),
      "scene.gltf",
    ]);
    if (
      propertiesUri === propertiesBinaryUri ||
      uris.has(propertiesUri) ||
      uris.has(propertiesBinaryUri)
    ) {
      throw new TypeError("Property sidecar resources must use distinct URIs.");
    }
  }
  const generator = options.generator ?? "MADI compiler 0.0.0 / experimental glTF profile 1";
  const scaleToMeters = scene.units.scaleToMeters;
  const bufferViews: GltfBufferView[] = [];
  const accessors: GltfAccessor[] = [];
  const builder = new GltfBinaryBuilder({ bufferIndex: 0, bufferViews, accessors });
  const coarseBuilder = coarseBounds
    ? new GltfBinaryBuilder({ bufferIndex: 1, bufferViews, accessors })
    : undefined;
  const representations = new Map(scene.representations.map((value) => [value.id, value]));
  const occurrences = [...scene.occurrences].sort(compareId);
  const prototypes = [...scene.prototypes].sort(compareId);
  const payloadPrototypes = options.spatialPayloadOrder === true
    ? spatialPayloadPrototypeOrder(
        prototypes,
        occurrences,
        representations,
        sourceToGltfMatrix(scene.rootFrame.upAxis),
        scaleToMeters,
        options.spatialLeafCapacity,
      )
    : prototypes;
  const prototypeById = new Map(prototypes.map((value) => [value.id, value]));
  const geometryByPrototype = new Map<string, GeometryResource>();
  const coarseGeometryByPrototype = new Map<string, CoarseGeometryResource>();
  const targetRangesByPrototype = new Map<string, TargetGeometryRange>();
  let triangleCount = 0;
  let edgeSegmentCount = 0;

  for (const prototype of payloadPrototypes) {
    const representation = representationFor(prototype, representations);
    if (!representation) continue;
    const byteOffset = builder.byteLength;
    const compiled = appendGeometry(builder, prototype, representation, scaleToMeters);
    geometryByPrototype.set(prototype.id, compiled.resource);
    targetRangesByPrototype.set(prototype.id, {
      prototypeId: prototype.id,
      byteOffset,
      byteLength: builder.byteLength - byteOffset,
    });
    if (coarseBuilder && options.spatialPayloadOrder !== true) {
      coarseGeometryByPrototype.set(
        prototype.id,
        appendCoarseBounds(coarseBuilder, prototype, representation, scaleToMeters),
      );
    }
    triangleCount += compiled.triangles;
    edgeSegmentCount += compiled.edges;
  }
  if (coarseBuilder && options.spatialPayloadOrder === true) {
    for (const prototype of prototypes) {
      const representation = representationFor(prototype, representations);
      if (!representation) continue;
      coarseGeometryByPrototype.set(
        prototype.id,
        appendCoarseBounds(coarseBuilder, prototype, representation, scaleToMeters),
      );
    }
  }

  const materials: GltfMaterial[] = [fallbackMaterial(false), fallbackMaterial(true)];
  const materialIndexes = new Map<string, number>([
    ["surface:fallback", 0],
    ["edge:fallback", 1],
  ]);
  for (const material of [...scene.materials].sort(compareId)) {
    materialIndexes.set(`surface:${material.id}`, materials.length);
    materials.push(gltfMaterial(material, false));
    materialIndexes.set(`edge:${material.id}`, materials.length);
    materials.push(gltfMaterial(material, true));
  }

  const materialIndex = (role: "surface" | "edge", id?: MaterialId): number =>
    materialIndexes.get(`${role}:${id ?? "fallback"}`) ??
    materialIndexes.get(`${role}:fallback`) ??
    0;
  const meshes: GltfMesh[] = [];
  const meshVariants = new Map<string, number>();
  const coarseMeshVariants = new Map<string, number>();
  const targetMeshesByPrototype = new Map<string, Set<number>>();

  function meshFor(resource: GeometryResource, overrideMaterialId?: MaterialId): number {
    const variantKey = `${resource.representation.id}\u0000${overrideMaterialId ?? ""}`;
    const existing = meshVariants.get(variantKey);
    if (existing !== undefined) return existing;

    const primitives: GltfPrimitive[] = resource.surfaceGroups.map((group) => ({
      attributes: {
        POSITION: resource.positionAccessor ?? 0,
        ...(resource.normalAccessor === undefined ? {} : { NORMAL: resource.normalAccessor }),
      },
      indices: group.indexAccessor,
      material: materialIndex("surface", overrideMaterialId ?? group.materialId),
      mode: 4,
      extras: {
        madi: {
          kind: "surface",
          representationId: resource.representation.id,
          firstIndex: group.firstIndex,
          indexCount: group.indexCount,
          ...(resource.faceSourceAccessor === undefined
            ? {}
            : { faceSourceAccessor: resource.faceSourceAccessor }),
          sourceRefs: resource.representation.sourceMap?.sourceRefs ?? [],
        },
      },
    }));

    if (
      resource.edgePositionAccessor !== undefined &&
      resource.edgeIndexAccessor !== undefined
    ) {
      primitives.push({
        attributes: { POSITION: resource.edgePositionAccessor },
        indices: resource.edgeIndexAccessor,
        material: materialIndex(
          "edge",
          overrideMaterialId ?? resource.prototype.defaultMaterialId,
        ),
        mode: 1,
        extras: {
          madi: {
            kind: "explicit-cad-edges",
            representationId: resource.representation.id,
            ...(resource.edgeClassAccessor === undefined
              ? {}
              : { edgeClassAccessor: resource.edgeClassAccessor }),
            ...(resource.edgeSourceAccessor === undefined
              ? {}
              : { edgeSourceAccessor: resource.edgeSourceAccessor }),
            sourceRefs: resource.representation.sourceMap?.sourceRefs ?? [],
            curveHints: resource.representation.edges?.curveHints ?? [],
          },
        },
      });
    }

    const meshIndex = meshes.length;
    meshes.push({
      name: resource.prototype.name ?? resource.prototype.id,
      primitives,
      extras: {
        madi: {
          prototypeId: resource.prototype.id,
          representationId: resource.representation.id,
          sourceRef: resource.prototype.sourceRef,
          materialOverrideId: overrideMaterialId,
        },
      },
    });
    meshVariants.set(variantKey, meshIndex);
    const prototypeMeshes = targetMeshesByPrototype.get(resource.prototype.id) ?? new Set();
    prototypeMeshes.add(meshIndex);
    targetMeshesByPrototype.set(resource.prototype.id, prototypeMeshes);
    return meshIndex;
  }

  function coarseMeshFor(
    resource: CoarseGeometryResource,
    overrideMaterialId?: MaterialId,
  ): number {
    const variantKey = `${resource.representation.id}\u0000${overrideMaterialId ?? ""}`;
    const existing = coarseMeshVariants.get(variantKey);
    if (existing !== undefined) return existing;
    const meshIndex = meshes.length;
    meshes.push({
      name: `${resource.prototype.name ?? resource.prototype.id} coarse bounds`,
      primitives: [
        {
          attributes: {
            POSITION: resource.positionAccessor,
            NORMAL: resource.normalAccessor,
          },
          indices: resource.indexAccessor,
          material: materialIndex(
            "surface",
            overrideMaterialId ?? resource.prototype.defaultMaterialId,
          ),
          mode: 4,
          extras: {
            madi: {
              kind: "coarse-bounds-surface",
              representationId: resource.representation.id,
            },
          },
        },
        {
          attributes: { POSITION: resource.edgePositionAccessor },
          indices: resource.edgeIndexAccessor,
          material: materialIndex(
            "edge",
            overrideMaterialId ?? resource.prototype.defaultMaterialId,
          ),
          mode: 1,
          extras: {
            madi: {
              kind: "coarse-bounds-edges",
              representationId: resource.representation.id,
            },
          },
        },
      ],
      extras: {
        madi: {
          prototypeId: resource.prototype.id,
          representationId: resource.representation.id,
          role: "coarse-bounds",
          materialOverrideId: overrideMaterialId,
        },
      },
    });
    coarseMeshVariants.set(variantKey, meshIndex);
    return meshIndex;
  }

  const occurrenceCounts = new Map<string, number>();
  for (const occurrence of occurrences) {
    occurrenceCounts.set(
      occurrence.prototypeId,
      (occurrenceCounts.get(occurrence.prototypeId) ?? 0) + 1,
    );
  }
  const occurrenceIndexes = new Map(
    occurrences.map((occurrence, index) => [occurrence.id, index + 1]),
  );
  const children = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    if (!occurrence.parentId) continue;
    const entries = children.get(occurrence.parentId) ?? [];
    entries.push(occurrence);
    children.set(occurrence.parentId, entries);
  }
  for (const entries of children.values()) entries.sort(compareId);
  const rootOccurrences = occurrences.filter(({ parentId }) => parentId === undefined);

  const nodes: GltfNode[] = [
    {
      name: "MADI source frame",
      children: rootOccurrences.map(({ id }) => occurrenceIndexes.get(id) ?? 0),
      matrix: sourceToGltfMatrix(scene.rootFrame.upAxis),
      extras: {
        madi: {
          kind: "source-frame",
          sourceUpAxis: scene.rootFrame.upAxis,
          targetUpAxis: "Y",
          sourceLengthUnit: scene.units.length,
          scaleToMeters,
        },
      },
    },
  ];

  for (const occurrence of occurrences) {
    const prototype = prototypeById.get(occurrence.prototypeId);
    if (!prototype) throw new TypeError(`Missing prototype ${occurrence.prototypeId}.`);
    const geometry = geometryByPrototype.get(prototype.id);
    const coarseGeometry = coarseGeometryByPrototype.get(prototype.id);
    const childIndexes = (children.get(occurrence.id) ?? []).map(
      ({ id }) => occurrenceIndexes.get(id) ?? 0,
    );
    const mesh = geometry === undefined
      ? undefined
      : meshFor(geometry, occurrence.materialOverrideId);
    const coarseMesh = coarseGeometry === undefined
      ? undefined
      : coarseMeshFor(coarseGeometry, occurrence.materialOverrideId);
    nodes.push({
      name: occurrence.name ?? occurrence.id,
      ...(childIndexes.length === 0 ? {} : { children: childIndexes }),
      matrix: scaledOccurrenceMatrix(occurrence.localTransform, scaleToMeters),
      ...(mesh === undefined ? {} : { mesh }),
      extras: {
        madi: {
          occurrenceId: occurrence.id,
          prototypeId: occurrence.prototypeId,
          semanticId: occurrence.semanticId,
          sourceRef: occurrence.sourceRef,
          initialVisibility: occurrence.initialVisibility,
          tags: [...occurrence.tags],
          ...(coarseMesh === undefined ? {} : { coarseMesh }),
        },
      },
    });
  }

  const binary = builder.finish();
  const coarseBinary = coarseBuilder?.finish();
  const targetChunks = coarseBinary
    ? [...targetChunkGroups(
        [...targetRangesByPrototype.values()]
        .map((range) => ({
          ...range,
          meshIndexes: [...(targetMeshesByPrototype.get(range.prototypeId) ?? [])].sort(
            (left, right) => left - right,
          ),
          occurrenceCount: occurrenceCounts.get(range.prototypeId) ?? 0,
        }))
        .filter(({ meshIndexes }) => meshIndexes.length > 0),
        options.targetChunkByteBudget,
      )]
        .sort(
          (left, right) =>
            right.occurrenceCount - left.occurrenceCount ||
            right.byteLength - left.byteLength ||
            (left.prototypeIds[0] ?? "").localeCompare(right.prototypeIds[0] ?? "", "en"),
        )
        .map((chunk, priority) => ({
          id: `target:${String(priority).padStart(4, "0")}:${chunk.prototypeIds[0]}`,
          buffer: 0,
          byteOffset: chunk.byteOffset,
          byteLength: chunk.byteLength,
          meshIndexes: chunk.meshIndexes,
          prototypeId: chunk.prototypeIds[0],
          prototypeIds: chunk.prototypeIds,
          occurrenceCount: chunk.occurrenceCount,
          priority,
        }))
    : [];
  const spatialIndex = options.spatialIndex === true
    ? (() => {
        const chunkByPrototype = new Map<string, number>();
        targetChunks.forEach((chunk, chunkIndex) => {
          for (const prototypeId of chunk.prototypeIds) {
            if (chunkByPrototype.has(prototypeId)) {
              throw new RangeError(`Prototype ${prototypeId} belongs to more than one target chunk.`);
            }
            chunkByPrototype.set(prototypeId, chunkIndex);
          }
        });
        const worldMatrices = occurrenceWorldMatrices(
          occurrences,
          sourceToGltfMatrix(scene.rootFrame.upAxis),
          scaleToMeters,
        );
        const entries = occurrences.flatMap((occurrence) => {
          const coarse = coarseGeometryByPrototype.get(occurrence.prototypeId);
          const targetChunkIndex = chunkByPrototype.get(occurrence.prototypeId);
          const nodeIndex = occurrenceIndexes.get(occurrence.id);
          const world = worldMatrices.get(occurrence.id);
          if (!coarse || targetChunkIndex === undefined || nodeIndex === undefined || !world) return [];
          return [{
            id: occurrence.id,
            nodeIndex,
            targetChunkIndex,
            ...transformedBounds(world, coarse.minimum, coarse.maximum),
          }];
        });
        return encodeSpatialDemandIndex(entries, {
          ...(options.spatialLeafCapacity === undefined
            ? {}
            : { leafCapacity: options.spatialLeafCapacity }),
        });
      })()
    : undefined;
  const spatialBinaryDigest = spatialIndex ? sha256(spatialIndex.bytes) : undefined;
  const diagnostics = [...scene.diagnostics].sort((left, right) =>
    `${left.code}\u0000${left.sourceRef ?? ""}`.localeCompare(
      `${right.code}\u0000${right.sourceRef ?? ""}`,
      "en",
    ),
  );
  const document: GltfDocument = {
    asset: { version: "2.0", generator },
    scene: 0,
    scenes: [{ name: scene.sceneId, nodes: [0] }],
    nodes,
    meshes,
    materials,
    buffers: [
      { uri: binaryUri, byteLength: binary.byteLength },
      ...(coarseBinary ? [{ uri: coarseBinaryUri, byteLength: coarseBinary.byteLength }] : []),
    ],
    bufferViews,
    accessors,
    extras: {
      madi: {
        profile: experimentalGltfProfile,
        status: "experimental-not-interchange",
        sceneId: scene.sceneId,
        revisionId: scene.revision.id,
        sourceDigest: scene.revision.sourceDigest,
        optionsDigest: scene.revision.optionsDigest,
        ...(coarseBinary
          ? {
              progressive: {
                strategy: "prototype-aabb-v1",
                targetBuffer: 0,
                coarseBuffer: 1,
                targetChunks,
                ...(options.spatialPayloadOrder === true
                  ? { targetPayloadOrder: "spatial-leaf-anchor-v1" }
                  : {}),
                ...(spatialIndex && spatialBinaryDigest
                  ? {
                      spatialIndex: {
                        schemaVersion: spatialDemandIndexSchema,
                        uri: spatialBinaryUri,
                        byteLength: spatialIndex.bytes.byteLength,
                        sha256: spatialBinaryDigest,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(propertySidecar
          ? {
              properties: {
                schemaVersion: packagePropertiesSchema,
                uri: propertiesUri,
                byteLength: propertySidecar.jsonBytes.byteLength,
                sha256: propertySidecar.jsonDigest,
              },
            }
          : {}),
        documents: [...scene.documents]
          .sort(compareId)
          .map(({ id, displayName, format, formatVersion, sourceDigest }) => ({
            id,
            displayName,
            format,
            formatVersion,
            sourceDigest,
          })),
        diagnostics: diagnostics.map(
          ({ severity, code, message, documentId, sourceRef, data }) => ({
            severity,
            code,
            message,
            documentId,
            sourceRef,
            data,
          }),
        ),
      },
    },
  };
  const json = `${JSON.stringify(document, null, options.compactJson === true ? undefined : 2)}\n`;
  const jsonDigest = sha256(json);
  const binaryDigest = sha256(binary);
  const coarseBinaryDigest = coarseBinary ? sha256(coarseBinary) : undefined;
  const packageHash = createHash("sha256").update(json).update(binary);
  if (coarseBinary) packageHash.update(coarseBinary);
  if (spatialIndex) packageHash.update(spatialIndex.bytes);
  if (propertySidecar) {
    packageHash.update(propertySidecar.jsonBytes).update(propertySidecar.binary);
  }
  const packageDigest = packageHash.digest("hex");
  const diagnosticCounts = { info: 0, warning: 0, error: 0 };
  for (const diagnostic of diagnostics) diagnosticCounts[diagnostic.severity] += 1;
  const report: CompilerBuildReport = {
    schemaVersion: compilerEvidenceSchema,
    profile: experimentalGltfProfile,
    status: "experimental-not-interchange",
    compiler: {
      // Serialized report identity: frozen at the historical "@madi/compiler"
      // string so recompiles stay byte-identical to committed evidence.
      name: "@madi/compiler",
      version: "0.0.0",
      generator,
    },
    options: {
      binaryUri,
      ...(coarseBinary ? { coarseBinaryUri } : {}),
      ...(propertySidecar ? { propertiesUri, propertiesBinaryUri } : {}),
      coordinateSystem: "right-handed-y-up-meters",
      geometryEncoding: "gltf-f32",
      ...(options.compactJson === true ? { jsonFormatting: "compact" as const } : {}),
      ...(coarseBinary ? { progressiveRepresentation: "prototype-aabb-v1" as const } : {}),
      ...(coarseBinary
        ? {
            targetChunking: options.targetChunkByteBudget === undefined
              ? "prototype-range-v1" as const
              : "coalesced-prototype-range-v1" as const,
            ...(options.targetChunkByteBudget === undefined
              ? {}
              : { targetChunkByteBudget: options.targetChunkByteBudget }),
            ...(options.spatialPayloadOrder === true
              ? { targetPayloadOrder: "spatial-leaf-anchor-v1" as const }
              : {}),
          }
        : {}),
    },
    source: {
      sceneId: scene.sceneId,
      revisionId: scene.revision.id,
      sourceDigest: scene.revision.sourceDigest,
      adapter: `${scene.revision.adapter.name} ${scene.revision.adapter.version}`,
      optionsDigest: scene.revision.optionsDigest,
    },
    output: {
      packageDigest,
      resources: [
        {
          path: "scene.gltf",
          mediaType: "model/gltf+json",
          bytes: new TextEncoder().encode(json).byteLength,
          sha256: jsonDigest,
        },
        {
          path: binaryUri,
          mediaType: "application/octet-stream",
          bytes: binary.byteLength,
          sha256: binaryDigest,
        },
        ...(coarseBinary && coarseBinaryDigest
          ? [
              {
                path: coarseBinaryUri,
                mediaType: "application/octet-stream",
                bytes: coarseBinary.byteLength,
                sha256: coarseBinaryDigest,
              },
            ]
          : []),
        ...(spatialIndex && spatialBinaryDigest
          ? [
              {
                path: spatialBinaryUri,
                mediaType: "application/octet-stream",
                bytes: spatialIndex.bytes.byteLength,
                sha256: spatialBinaryDigest,
              },
            ]
          : []),
        ...(propertySidecar
          ? [
              {
                path: propertiesUri,
                mediaType: "application/json",
                bytes: propertySidecar.jsonBytes.byteLength,
                sha256: propertySidecar.jsonDigest,
              },
              {
                path: propertiesBinaryUri,
                mediaType: "application/octet-stream",
                bytes: propertySidecar.binary.byteLength,
                sha256: propertySidecar.binaryDigest,
              },
            ]
          : []),
      ],
    },
    counts: {
      prototypeCount: prototypes.length,
      compiledPrototypeCount: geometryByPrototype.size,
      occurrenceCount: occurrences.length,
      renderableOccurrenceCount: occurrences.filter(({ prototypeId }) =>
        geometryByPrototype.has(prototypeId),
      ).length,
      gltfNodeCount: nodes.length,
      gltfMeshCount: meshes.length,
      materialCount: materials.length,
      triangleCount,
      edgeSegmentCount,
      ...(coarseBinary ? { targetChunkCount: targetChunks.length } : {}),
    },
    prototypeReuse: [...occurrenceCounts]
      .filter(([, count]) => count > 1)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([prototypeId, occurrenceCount]) => ({ prototypeId, occurrenceCount })),
    diagnostics: {
      counts: diagnosticCounts,
      codes: [...new Set(diagnostics.map(({ code }) => code))].sort(),
    },
    limitations: [
      "This is an experimental glTF profile, not a MADI interchange format.",
      ...(coarseBinary
        ? ["The coarse representation is a prototype AABB, not a shape-preserving LOD."]
        : ["Only one target display representation per prototype is emitted; coarse LOD is pending."]),
      ...(occurrences.some(({ localTransform }) =>
        localTransform.slice(12, 15).some((value) =>
          deliveredTranslation(value * scaleToMeters) !== Math.fround(value * scaleToMeters),
        ),
      )
        ? ["Local geometry and transform linear components are f32; translations that exceed the 1e-8 metre f32 error budget retain JavaScript number precision for camera-relative rendering."]
        : ["Geometry and node transforms are converted to f32 for glTF delivery."]),
      "MADI source mapping uses glTF extras until an interoperable extension is justified.",
    ],
  };
  return {
    document,
    json,
    binary,
    ...(coarseBinary ? { coarseBinary } : {}),
    ...(spatialIndex
      ? {
          spatialBinary: spatialIndex.bytes,
          spatialBinaryUri,
        }
      : {}),
    ...(propertySidecar
      ? {
          propertiesJson: propertySidecar.json,
          propertiesBinary: propertySidecar.binary,
        }
      : {}),
    report,
    sceneValidation: validation,
  };
}
