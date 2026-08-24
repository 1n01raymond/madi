import { endianness } from "node:os";

import { isColumnPropertyBag, openPropertyValueColumns } from "@madi/scene-ir";
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

export const ifcSceneSplitEncodingVersion = "madi.ifc-scene-ir-split.3";

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

/**
 * Structurally verifies the property value column file against the scene it
 * belongs to: `openPropertyValueColumns` checks the offset tables and
 * references, and every column bag's row must hold exactly as many values as
 * its key set expects. Property values are never materialized — the check
 * reads only the u32 offset tables.
 */
function verifyPropertyColumns(scene: SerializedSplitScene, properties: Buffer): void {
  // Buffer is a Uint8Array; `alignedGeometry` re-homes it when Node's pooled
  // `readFile` slab breaks the file's own 8-byte stream alignment.
  const reader = openPropertyValueColumns(scene.propertyValues, alignedGeometry(properties));
  const sets = scene.propertyIndex?.sets;
  (scene.semantics ?? []).forEach((semantic, index) => {
    if (!isColumnPropertyBag(semantic.properties)) return;
    const expected = sets?.[semantic.properties.set]?.length;
    if (expected === undefined) {
      throw new RangeError(
        `Split IFC semantic ${String(index)} references an unknown property set.`,
      );
    }
    if (reader.rowLength(semantic.properties.row) !== expected) {
      throw new RangeError(
        `Split IFC semantic ${String(index)} property row does not match its key set.`,
      );
    }
  });
}

/** Hydrates the split transport; the buffers must come from the same adapter run. */
export function hydrateIfcSceneSplit(
  value: unknown,
  geometry: Buffer,
  properties?: Buffer,
): EngineeringScene {
  if (endianness() !== "LE") {
    throw new TypeError("Split IFC Scene IR hydration requires a little-endian host.");
  }
  if (!isRecord(value) || !Array.isArray(value.representations)) {
    throw new TypeError("Split IFC Scene IR must contain a representations array.");
  }
  const aligned = alignedGeometry(geometry);
  const scene = value as unknown as SerializedSplitScene;
  if (scene.propertyValues !== undefined) {
    if (properties === undefined) {
      throw new TypeError("Split IFC Scene IR property columns require the column file.");
    }
    verifyPropertyColumns(scene, properties);
  } else if (properties !== undefined) {
    throw new TypeError("Split IFC Scene IR does not declare the provided property columns.");
  }
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
