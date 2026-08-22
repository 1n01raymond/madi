import { validateScene } from "@madi/scene-ir";
import type {
  Bounds3d,
  CurveHint,
  EngineeringScene,
  MaterialGroup,
  Occurrence,
  Representation,
  SourceRefId,
} from "@madi/scene-ir";
import type {
  GpuOccurrenceInstance,
  GpuPrototypeBatch,
  GpuScene,
} from "@madi/runtime-webgpu";

interface SerializedSurface {
  readonly primitive: "triangles";
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly normals?: readonly number[];
  readonly uvs?: readonly number[];
  readonly colorIds?: readonly number[];
  readonly materialGroups?: readonly MaterialGroup[];
  readonly faceSourceIds?: readonly number[];
}

interface SerializedEdges {
  readonly positions: readonly number[];
  readonly segments: readonly number[];
  readonly classes: readonly number[];
  readonly sourceIds?: readonly number[];
  readonly curveHints?: readonly CurveHint[];
}

type SerializedRepresentation = Omit<Representation, "surface" | "edges"> & {
  readonly surface?: SerializedSurface;
  readonly edges?: SerializedEdges;
};

type SerializedEngineeringScene = Omit<EngineeringScene, "representations"> & {
  readonly representations: readonly SerializedRepresentation[];
};

export interface PreparedEvidenceScene {
  readonly scene: EngineeringScene;
  readonly gpuScene: GpuScene;
  readonly bounds: Bounds3d;
  readonly objectLabels: ReadonlyMap<number, string>;
  readonly objectEvidence: ReadonlyMap<number, ObjectPickEvidence>;
  readonly summary: {
    readonly prototypeBatches: number;
    readonly partOccurrences: number;
    readonly triangles: number;
    readonly edgeSegments: number;
  };
}

export interface ObjectPickEvidence {
  readonly label: string;
  readonly occurrenceId: string;
  readonly prototypeId: string;
  readonly sourceRef?: string;
  readonly edgeSourceRefs: readonly string[];
}

export interface HierarchyEntry {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly renderable: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hydrateEvidenceScene(value: unknown): EngineeringScene {
  if (!isRecord(value) || !Array.isArray(value.representations)) {
    throw new TypeError("OCCT evidence must contain a representations array.");
  }
  const serialized = value as unknown as SerializedEngineeringScene;

  return {
    ...serialized,
    representations: serialized.representations.map((representation) => ({
      ...representation,
      surface: representation.surface
        ? {
            ...representation.surface,
            positions: new Float64Array(representation.surface.positions),
            indices: new Uint32Array(representation.surface.indices),
            normals: representation.surface.normals
              ? new Float32Array(representation.surface.normals)
              : undefined,
            uvs: representation.surface.uvs
              ? new Float32Array(representation.surface.uvs)
              : undefined,
            colorIds: representation.surface.colorIds
              ? new Uint32Array(representation.surface.colorIds)
              : undefined,
            faceSourceIds: representation.surface.faceSourceIds
              ? new Uint32Array(representation.surface.faceSourceIds)
              : undefined,
          }
        : undefined,
      edges: representation.edges
        ? {
            ...representation.edges,
            positions: new Float64Array(representation.edges.positions),
            segments: new Uint32Array(representation.edges.segments),
            classes: new Uint8Array(representation.edges.classes),
            sourceIds: representation.edges.sourceIds
              ? new Uint32Array(representation.edges.sourceIds)
              : undefined,
          }
        : undefined,
      sourceMap: representation.sourceMap
        ? {
            ...representation.sourceMap,
            faceSourceIndices: representation.sourceMap.faceSourceIndices
              ? new Uint32Array(representation.sourceMap.faceSourceIndices)
              : undefined,
            edgeSourceIndices: representation.sourceMap.edgeSourceIndices
              ? new Uint32Array(representation.sourceMap.edgeSourceIndices)
              : undefined,
          }
        : undefined,
    })),
  } as EngineeringScene;
}

function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const result = new Array<number>(16).fill(0);
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

function transformPoint(matrix: readonly number[], point: readonly number[]): number[] {
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  const z = point[2] ?? 0;
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z +
      (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z +
      (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z +
      (matrix[14] ?? 0),
  ];
}

function boundsCorners(bounds: Bounds3d): number[][] {
  const corners: number[][] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
    }
  }
  return corners;
}

function mergePoints(points: readonly number[][]): Bounds3d {
  if (points.length === 0) {
    throw new TypeError("The OCCT evidence contains no renderable bounds.");
  }
  return {
    min: [
      Math.min(...points.map((point) => point[0] ?? 0)),
      Math.min(...points.map((point) => point[1] ?? 0)),
      Math.min(...points.map((point) => point[2] ?? 0)),
    ],
    max: [
      Math.max(...points.map((point) => point[0] ?? 0)),
      Math.max(...points.map((point) => point[1] ?? 0)),
      Math.max(...points.map((point) => point[2] ?? 0)),
    ],
  };
}

function surfaceVertices(representation: Representation): Float32Array {
  const surface = representation.surface;
  if (!surface) return new Float32Array();
  const result = new Float32Array((surface.positions.length / 3) * 6);
  for (let vertex = 0; vertex < surface.positions.length / 3; vertex += 1) {
    const positionOffset = vertex * 3;
    const resultOffset = vertex * 6;
    result[resultOffset] = surface.positions[positionOffset] ?? 0;
    result[resultOffset + 1] = surface.positions[positionOffset + 1] ?? 0;
    result[resultOffset + 2] = surface.positions[positionOffset + 2] ?? 0;
    result[resultOffset + 3] = surface.normals?.[positionOffset] ?? 0;
    result[resultOffset + 4] = surface.normals?.[positionOffset + 1] ?? 0;
    result[resultOffset + 5] = surface.normals?.[positionOffset + 2] ?? 1;
  }
  return result;
}

function expandedEdgeVertices(representation: Representation): Float32Array {
  const edges = representation.edges;
  if (!edges) return new Float32Array();
  const result = new Float32Array(edges.segments.length * 3);
  edges.segments.forEach((vertexIndex, segmentOffset) => {
    const sourceOffset = vertexIndex * 3;
    const targetOffset = segmentOffset * 3;
    result[targetOffset] = edges.positions[sourceOffset] ?? 0;
    result[targetOffset + 1] = edges.positions[sourceOffset + 1] ?? 0;
    result[targetOffset + 2] = edges.positions[sourceOffset + 2] ?? 0;
  });
  return result;
}

export function prepareEvidenceScene(scene: EngineeringScene): PreparedEvidenceScene {
  const validation = validateScene(scene);
  if (!validation.ok) {
    const summary = validation.issues
      .filter((issue) => issue.severity === "error")
      .slice(0, 5)
      .map((issue) => `${issue.code} at ${issue.path}`)
      .join(", ");
    throw new TypeError(`OCCT Scene IR validation failed: ${summary}`);
  }

  const prototypeById = new Map(scene.prototypes.map((prototype) => [prototype.id, prototype]));
  const occurrenceById = new Map(
    scene.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  const materialById = new Map(scene.materials.map((material) => [material.id, material]));
  const worldTransforms = new Map<string, number[]>();

  const worldTransform = (occurrence: Occurrence): number[] => {
    const cached = worldTransforms.get(occurrence.id);
    if (cached) return cached;
    const local = Array.from(occurrence.localTransform);
    const result = occurrence.parentId
      ? multiplyMatrices(
          worldTransform(
            occurrenceById.get(occurrence.parentId) ??
              (() => {
                throw new TypeError(`Missing parent occurrence ${occurrence.parentId}.`);
              })(),
          ),
          local,
        )
      : local;
    worldTransforms.set(occurrence.id, result);
    return result;
  };

  const objectLabels = new Map<number, string>();
  const objectEvidence = new Map<number, ObjectPickEvidence>();
  const worldBoundsPoints: number[][] = [];
  const batches: GpuPrototypeBatch[] = [];
  let objectId = 1;
  let triangleCount = 0;
  let edgeSegmentCount = 0;
  let partOccurrenceCount = 0;

  for (const representation of scene.representations) {
    if (!representation.surface) continue;
    const prototype = prototypeById.get(representation.prototypeId);
    if (!prototype) continue;
    const matchingOccurrences = scene.occurrences.filter(
      (occurrence) => occurrence.prototypeId === prototype.id,
    );
    if (matchingOccurrences.length === 0) continue;

    const edgeSourceRefs = Array.from(
      new Set(
        Array.from(representation.sourceMap?.edgeSourceIndices ?? []).map(
          (sourceIndex) => representation.sourceMap?.sourceRefs[sourceIndex],
        ),
      ),
    ).filter((sourceRef): sourceRef is SourceRefId => sourceRef !== undefined);

    const instances: GpuOccurrenceInstance[] = matchingOccurrences.map((occurrence) => {
      const transform = worldTransform(occurrence);
      const materialId = occurrence.materialOverrideId ?? prototype.defaultMaterialId;
      const color = materialId ? materialById.get(materialId)?.baseColor : undefined;
      const currentObjectId = objectId;
      objectId += 1;
      const label = occurrence.name ?? occurrence.id;
      objectLabels.set(currentObjectId, label);
      objectEvidence.set(currentObjectId, {
        label,
        occurrenceId: occurrence.id,
        prototypeId: occurrence.prototypeId,
        sourceRef: occurrence.sourceRef,
        edgeSourceRefs,
      });
      boundsCorners(prototype.localBounds).forEach((corner) =>
        worldBoundsPoints.push(transformPoint(transform, corner)),
      );
      partOccurrenceCount += 1;
      return {
        transform: new Float32Array(transform),
        objectId: currentObjectId,
        baseColor: color ?? [0.55, 0.62, 0.68, 1],
      };
    });

    triangleCount += representation.surface.indices.length / 3;
    edgeSegmentCount += (representation.edges?.segments.length ?? 0) / 2;
    batches.push({
      surfaceVertices: surfaceVertices(representation),
      surfaceIndices: new Uint32Array(representation.surface.indices),
      edgeVertices: expandedEdgeVertices(representation),
      instances,
    });
  }

  return {
    scene,
    gpuScene: { batches },
    bounds: mergePoints(worldBoundsPoints),
    objectLabels,
    objectEvidence,
    summary: {
      prototypeBatches: batches.length,
      partOccurrences: partOccurrenceCount,
      triangles: triangleCount,
      edgeSegments: edgeSegmentCount,
    },
  };
}

function dot(axis: readonly number[], point: readonly number[]): number {
  return (
    (axis[0] ?? 0) * (point[0] ?? 0) +
    (axis[1] ?? 0) * (point[1] ?? 0) +
    (axis[2] ?? 0) * (point[2] ?? 0)
  );
}

export function createIsometricCamera(bounds: Bounds3d, aspect: number): Float32Array {
  const right = [Math.SQRT1_2, -Math.SQRT1_2, 0];
  const up = [1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)];
  const depth = [-1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const corners = boundsCorners(bounds);
  const projectedX = corners.map((corner) => dot(right, corner));
  const projectedY = corners.map((corner) => dot(up, corner));
  const projectedDepth = corners.map((corner) => dot(depth, corner));
  const minX = Math.min(...projectedX);
  const maxX = Math.max(...projectedX);
  const minY = Math.min(...projectedY);
  const maxY = Math.max(...projectedY);
  const minDepth = Math.min(...projectedDepth);
  const maxDepth = Math.max(...projectedDepth);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  let halfWidth = Math.max((maxX - minX) * 0.58, 1);
  let halfHeight = Math.max((maxY - minY) * 0.58, 1);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (halfWidth / halfHeight < safeAspect) halfWidth = halfHeight * safeAspect;
  else halfHeight = halfWidth / safeAspect;
  const depthPadding = Math.max((maxDepth - minDepth) * 0.08, 1);
  const nearDepth = minDepth - depthPadding;
  const depthRange = Math.max(maxDepth - minDepth + depthPadding * 2, 1);

  return new Float32Array([
    (right[0] ?? 0) / halfWidth,
    (up[0] ?? 0) / halfHeight,
    (depth[0] ?? 0) / depthRange,
    0,
    (right[1] ?? 0) / halfWidth,
    (up[1] ?? 0) / halfHeight,
    (depth[1] ?? 0) / depthRange,
    0,
    (right[2] ?? 0) / halfWidth,
    (up[2] ?? 0) / halfHeight,
    (depth[2] ?? 0) / depthRange,
    0,
    -centerX / halfWidth,
    -centerY / halfHeight,
    -nearDepth / depthRange,
    1,
  ]);
}

export function hierarchyEntries(scene: EngineeringScene): HierarchyEntry[] {
  const prototypeById = new Map(scene.prototypes.map((prototype) => [prototype.id, prototype]));
  const occurrenceById = new Map(
    scene.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  const depthOf = (occurrence: Occurrence): number =>
    occurrence.parentId
      ? 1 + depthOf(occurrenceById.get(occurrence.parentId) as Occurrence)
      : 0;
  return scene.occurrences.map((occurrence) => ({
    id: occurrence.id,
    name: occurrence.name ?? occurrence.id,
    depth: depthOf(occurrence),
    renderable:
      (prototypeById.get(occurrence.prototypeId)?.representationIds.length ?? 0) > 0,
  }));
}
