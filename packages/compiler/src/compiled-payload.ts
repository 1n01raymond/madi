import { createHash } from "node:crypto";

import type { MaterialId, Representation } from "@naru3d/scene-ir";


import { encodeFloat32, encodeUint32, encodeUint8, scaledPositionBounds } from "./binary.js";
import type { GltfBinaryBuilder } from "./binary.js";
import type { GltfAccessor, GltfBufferView } from "./types.js";

/**
 * One `GltfBinaryBuilder.append` call with everything that depends on where the
 * prototype lands removed: no byte offset, no bufferView index, no accessor
 * index. What remains is a function of the representation's own content, which
 * is what makes a payload addressable by that content.
 */
export interface CompiledPayloadAccessor {
  readonly bytes: Uint8Array;
  readonly componentType: GltfAccessor["componentType"];
  readonly count: number;
  readonly type: GltfAccessor["type"];
  readonly target?: GltfBufferView["target"];
  readonly name?: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

export interface CompiledPayloadSurfaceGroup {
  /** Index into `CompiledPayload.accessors`, not into the glTF document. */
  readonly accessor: number;
  readonly materialId?: MaterialId;
  readonly firstIndex: number;
  readonly indexCount: number;
}

/** Which payload-local accessor plays which role once the payload is placed. */
export interface CompiledPayloadShape {
  readonly position?: number;
  readonly normal?: number;
  readonly faceSource?: number;
  readonly surfaceGroups: readonly CompiledPayloadSurfaceGroup[];
  readonly edgePosition?: number;
  readonly edgeIndex?: number;
  readonly edgeClass?: number;
  readonly edgeSource?: number;
}

export interface CompiledPayload {
  readonly accessors: readonly CompiledPayloadAccessor[];
  readonly shape: CompiledPayloadShape;
  readonly triangles: number;
  readonly edges: number;
}

/**
 * Where the packager gets a prototype's payload.
 *
 * Without a source the packager calls `buildCompiledPayload` itself; a source
 * may hand back a stored payload instead. The prototype id travels with the
 * request so a source can report per prototype -- the only identifier a cache
 * report is allowed to name, never a source path or a property value.
 */
export interface PlacedPayloadSurfaceGroup {
  readonly indexAccessor: number;
  readonly materialId?: MaterialId;
  readonly firstIndex: number;
  readonly indexCount: number;
}

/** The same roles after placement, addressed by glTF accessor index. */
export interface PlacedPayload {
  readonly positionAccessor?: number;
  readonly normalAccessor?: number;
  readonly surfaceGroups: readonly PlacedPayloadSurfaceGroup[];
  readonly faceSourceAccessor?: number;
  readonly edgePositionAccessor?: number;
  readonly edgeIndexAccessor?: number;
  readonly edgeClassAccessor?: number;
  readonly edgeSourceAccessor?: number;
}

function sharesTypedArrayStorage(left: ArrayBufferView, right: ArrayBufferView): boolean {
  return (
    left.buffer === right.buffer &&
    left.byteOffset === right.byteOffset &&
    left.byteLength === right.byteLength
  );
}

/**
 * Encodes one representation into its payload.
 *
 * This is the only geometry encoder in the compiler: placement appends the
 * accessors it returns, in order, so a payload restored from a store and a
 * payload built here reach `scene.bin` through exactly the same path.
 */
export function buildCompiledPayload(
  representation: Representation,
  scaleToMeters: number,
): CompiledPayload {
  const accessors: CompiledPayloadAccessor[] = [];
  const push = (accessor: CompiledPayloadAccessor): number => {
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const surface = representation.surface;
  const edges = representation.edges;
  let position: number | undefined;
  let normal: number | undefined;
  let faceSource: number | undefined;
  const surfaceGroups: CompiledPayloadSurfaceGroup[] = [];
  let triangles = 0;

  if (surface && surface.positions.length > 0 && surface.indices.length > 0) {
    const bounds = scaledPositionBounds(surface.positions, scaleToMeters);
    position = push({
      bytes: encodeFloat32(surface.positions, scaleToMeters),
      componentType: 5126,
      count: surface.positions.length / 3,
      type: "VEC3",
      target: 34962,
      name: `${representation.id} surface positions`,
      ...bounds,
    });
    if (surface.normals) {
      normal = push({
        bytes: encodeFloat32(surface.normals),
        componentType: 5126,
        count: surface.normals.length / 3,
        type: "VEC3",
        target: 34962,
        name: `${representation.id} surface normals`,
      });
    }
    if (surface.faceSourceIds) {
      faceSource = push({
        bytes: encodeUint32(surface.faceSourceIds),
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
      const accessor = push({
        bytes: encodeUint32(indices),
        componentType: 5125,
        count: indices.length,
        type: "SCALAR",
        target: 34963,
        name: `${representation.id} surface indices ${groupIndex}`,
        min: [indices.reduce((minimum, value) => Math.min(minimum, value), Infinity)],
        max: [indices.reduce((maximum, value) => Math.max(maximum, value), -Infinity)],
      });
      surfaceGroups.push({
        accessor,
        ...(group.materialId === undefined ? {} : { materialId: group.materialId }),
        firstIndex: group.firstIndex,
        indexCount: group.indexCount,
      });
      triangles += group.indexCount / 3;
    }
  }

  let edgePosition: number | undefined;
  let edgeIndex: number | undefined;
  let edgeClass: number | undefined;
  let edgeSource: number | undefined;
  if (edges && edges.positions.length > 0 && edges.segments.length > 0) {
    if (
      position !== undefined &&
      surface !== undefined &&
      sharesTypedArrayStorage(edges.positions, surface.positions)
    ) {
      edgePosition = position;
    } else {
      const bounds = scaledPositionBounds(edges.positions, scaleToMeters);
      edgePosition = push({
        bytes: encodeFloat32(edges.positions, scaleToMeters),
        componentType: 5126,
        count: edges.positions.length / 3,
        type: "VEC3",
        target: 34962,
        name: `${representation.id} edge positions`,
        ...bounds,
      });
    }
    edgeIndex = push({
      bytes: encodeUint32(edges.segments),
      componentType: 5125,
      count: edges.segments.length,
      type: "SCALAR",
      target: 34963,
      name: `${representation.id} edge indices`,
      min: [edges.segments.reduce((minimum, value) => Math.min(minimum, value), Infinity)],
      max: [edges.segments.reduce((maximum, value) => Math.max(maximum, value), -Infinity)],
    });
    edgeClass = push({
      bytes: encodeUint8(edges.classes),
      componentType: 5121,
      count: edges.classes.length,
      type: "SCALAR",
      name: `${representation.id} edge classes`,
    });
    if (edges.sourceIds) {
      edgeSource = push({
        bytes: encodeUint32(edges.sourceIds),
        componentType: 5125,
        count: edges.sourceIds.length,
        type: "SCALAR",
        name: `${representation.id} edge source IDs`,
      });
    }
  }

  return {
    accessors,
    shape: {
      ...(position === undefined ? {} : { position }),
      ...(normal === undefined ? {} : { normal }),
      ...(faceSource === undefined ? {} : { faceSource }),
      surfaceGroups,
      ...(edgePosition === undefined ? {} : { edgePosition }),
      ...(edgeIndex === undefined ? {} : { edgeIndex }),
      ...(edgeClass === undefined ? {} : { edgeClass }),
      ...(edgeSource === undefined ? {} : { edgeSource }),
    },
    triangles,
    edges: edges && edges.segments.length > 0 ? edges.segments.length / 2 : 0,
  };
}

/**
 * Places a payload into the federation buffer. Offsets, padding, bufferView and
 * accessor indices are decided here and only here, so a reused payload can
 * never carry a stale layout into a package.
 */
export function appendCompiledPayload(
  builder: GltfBinaryBuilder,
  payload: CompiledPayload,
): PlacedPayload {
  const placed = payload.accessors.map(({ bytes, ...options }) => builder.append(bytes, options));
  const accessorAt = (local: number | undefined): number | undefined => {
    if (local === undefined) return undefined;
    const accessor = placed[local];
    if (accessor === undefined) {
      throw new RangeError(`Compiled payload references accessor ${local}, which it does not hold.`);
    }
    return accessor;
  };
  const position = accessorAt(payload.shape.position);
  const normal = accessorAt(payload.shape.normal);
  const faceSource = accessorAt(payload.shape.faceSource);
  const edgePosition = accessorAt(payload.shape.edgePosition);
  const edgeIndex = accessorAt(payload.shape.edgeIndex);
  const edgeClass = accessorAt(payload.shape.edgeClass);
  const edgeSource = accessorAt(payload.shape.edgeSource);
  return {
    ...(position === undefined ? {} : { positionAccessor: position }),
    ...(normal === undefined ? {} : { normalAccessor: normal }),
    surfaceGroups: payload.shape.surfaceGroups.map((group) => ({
      indexAccessor: accessorAt(group.accessor) ?? 0,
      ...(group.materialId === undefined ? {} : { materialId: group.materialId }),
      firstIndex: group.firstIndex,
      indexCount: group.indexCount,
    })),
    ...(faceSource === undefined ? {} : { faceSourceAccessor: faceSource }),
    ...(edgePosition === undefined ? {} : { edgePositionAccessor: edgePosition }),
    ...(edgeIndex === undefined ? {} : { edgeIndexAccessor: edgeIndex }),
    ...(edgeClass === undefined ? {} : { edgeClassAccessor: edgeClass }),
    ...(edgeSource === undefined ? {} : { edgeSourceAccessor: edgeSource }),
  };
}

function hashTypedArray(hash: ReturnType<typeof createHash>, label: string, view?: ArrayBufferView): void {
  if (!view) {
    hash.update(`${label}\u0000absent\n`);
    return;
  }
  hash.update(`${label}\u0000${view.constructor.name}\u0000${view.byteLength}\n`);
  hash.update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/**
 * Content identity of a representation, taken over exactly what
 * `buildCompiledPayload` reads and nothing else.
 *
 * The element type is hashed beside the bytes, so the same coordinates held as
 * `Float64Array` and as `Float32Array` are treated as different content. That
 * is conservative in the safe direction: it can cost a rebuild, never a wrong
 * payload. The aliasing flag is hashed for the same reason -- an edge set that
 * shares its positions with the surface encodes one accessor fewer.
 */
export function compiledPayloadContentDigest(representation: Representation): string {
  const hash = createHash("sha256");
  const surface = representation.surface;
  const edges = representation.edges;
  hash.update(`representation\u0000${representation.id}\n`);
  hashTypedArray(hash, "surface.positions", surface?.positions);
  hashTypedArray(hash, "surface.normals", surface?.normals);
  hashTypedArray(hash, "surface.indices", surface?.indices);
  hashTypedArray(hash, "surface.faceSourceIds", surface?.faceSourceIds);
  hash.update(`surface.materialGroups\u0000${JSON.stringify(surface?.materialGroups ?? null)}\n`);
  hashTypedArray(hash, "edges.positions", edges?.positions);
  hashTypedArray(hash, "edges.segments", edges?.segments);
  hashTypedArray(hash, "edges.classes", edges?.classes);
  hashTypedArray(hash, "edges.sourceIds", edges?.sourceIds);
  const aliased = surface !== undefined &&
    edges !== undefined &&
    sharesTypedArrayStorage(edges.positions, surface.positions);
  hash.update(`edges.sharesSurfacePositions\u0000${String(aliased)}\n`);
  return hash.digest("hex");
}
