import { endianness } from "node:os";

import type {
  EngineeringScene,
  MaterialGroup,
  Representation,
} from "@madi/scene-ir";

/**
 * Split Scene IR transport hydration for large IFC federations.
 *
 * The adapter emits a structure-only JSON document whose representation
 * surface streams are little-endian binary references into a separate
 * geometry file. Hydration resolves those references into typed-array views
 * over the geometry buffer without copying, preserving the observable
 * EngineeringScene contract while keeping structure JSON below practical
 * string limits.
 */

export const ifcSceneSplitEncodingVersion = "madi.ifc-scene-ir-split.2";

interface GeometryStreamRef {
  readonly encoding: "f64le" | "f32le" | "u32le";
  readonly byteOffset: number;
  readonly byteLength: number;
}

interface SerializedSplitSurface {
  readonly primitive: "triangles";
  readonly positions: GeometryStreamRef;
  readonly indices: GeometryStreamRef;
  readonly normals?: GeometryStreamRef;
  readonly materialGroups?: readonly MaterialGroup[];
}

type SerializedSplitRepresentation = Omit<Representation, "surface" | "edges"> & {
  readonly surface?: SerializedSplitSurface;
};

type SerializedSplitScene = Omit<EngineeringScene, "representations"> & {
  readonly representations: readonly SerializedSplitRepresentation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGeometryStreamRef(value: unknown): value is GeometryStreamRef {
  return (
    isRecord(value) &&
    typeof value.encoding === "string" &&
    typeof value.byteOffset === "number" &&
    typeof value.byteLength === "number"
  );
}

function elementBytes(encoding: GeometryStreamRef["encoding"]): number {
  return encoding === "f64le" ? 8 : 4;
}

/**
 * Node pools small `readFile` results inside a shared slab, so a geometry
 * buffer can start at an unaligned byte offset even though the adapter aligns
 * every stream inside the file. Typed-array views reject such starts, so an
 * unaligned buffer is copied once into its own allocation.
 */
function alignedGeometry(geometry: Buffer): Buffer {
  if (!(geometry.buffer instanceof ArrayBuffer)) {
    throw new TypeError("Geometry must be backed by an ArrayBuffer.");
  }
  if (geometry.byteOffset % 8 === 0) return geometry;
  const owned = Buffer.allocUnsafeSlow(geometry.byteLength);
  geometry.copy(owned);
  return owned;
}

type GeometryView =
  | Float64ArrayConstructor
  | Float32ArrayConstructor
  | Uint32ArrayConstructor;

function typedArrayView<View extends GeometryView>(
  geometry: Buffer,
  ref: GeometryStreamRef,
  View: View,
): InstanceType<View> {
  const bytes = elementBytes(ref.encoding);
  if (
    !Number.isSafeInteger(ref.byteOffset) ||
    !Number.isSafeInteger(ref.byteLength) ||
    ref.byteOffset < 0 ||
    ref.byteLength < 0 ||
    ref.byteLength % bytes !== 0
  ) {
    throw new TypeError(`Geometry stream length must align to ${String(bytes)} bytes.`);
  }
  if (ref.byteOffset + ref.byteLength > geometry.byteLength) {
    throw new RangeError("Geometry stream exceeds the geometry buffer.");
  }
  const buffer = geometry.buffer as ArrayBuffer;
  const start = geometry.byteOffset + ref.byteOffset;
  return new View(buffer, start, ref.byteLength / bytes) as InstanceType<View>;
}

/** Surface members the split transport does not encode as geometry streams. */
const unencodedSurfaceMembers = ["uvs", "colorIds", "faceSourceIds"] as const;

function member(value: object, name: string): unknown {
  return (value as unknown as Record<string, unknown>)[name];
}

function hydrateSurface(
  geometry: Buffer,
  surface: SerializedSplitSurface,
): Representation["surface"] {
  for (const name of unencodedSurfaceMembers) {
    if (member(surface, name) !== undefined) {
      throw new TypeError(`Split IFC surfaces cannot carry ${name} streams.`);
    }
  }
  if (!isGeometryStreamRef(surface.positions) || !isGeometryStreamRef(surface.indices)) {
    throw new TypeError("Split IFC surface streams must be geometry references.");
  }
  if (surface.positions.encoding !== "f64le" || surface.indices.encoding !== "u32le") {
    throw new TypeError("Split IFC surface streams use unexpected encodings.");
  }
  let normals: Float32Array | undefined;
  if (surface.normals !== undefined) {
    if (!isGeometryStreamRef(surface.normals) || surface.normals.encoding !== "f32le") {
      throw new TypeError("Split IFC normal stream uses an unexpected encoding.");
    }
    normals = typedArrayView(geometry, surface.normals, Float32Array);
  }
  return {
    primitive: "triangles",
    positions: typedArrayView(geometry, surface.positions, Float64Array),
    indices: typedArrayView(geometry, surface.indices, Uint32Array),
    normals,
    materialGroups: surface.materialGroups,
  };
}

/** Hydrates the split transport; the buffer must come from the same adapter run. */
export function hydrateIfcSceneSplit(value: unknown, geometry: Buffer): EngineeringScene {
  if (endianness() !== "LE") {
    throw new TypeError("Split IFC Scene IR hydration requires a little-endian host.");
  }
  if (!isRecord(value) || !Array.isArray(value.representations)) {
    throw new TypeError("Split IFC Scene IR must contain a representations array.");
  }
  const aligned = alignedGeometry(geometry);
  const scene = value as unknown as SerializedSplitScene;
  return {
    ...scene,
    representations: scene.representations.map((representation) => {
      if (member(representation, "edges") !== undefined) {
        throw new TypeError("Split IFC representations cannot carry edge streams.");
      }
      return representation.surface
        ? { ...representation, surface: hydrateSurface(aligned, representation.surface) }
        : (representation as Representation);
    }),
  };
}
