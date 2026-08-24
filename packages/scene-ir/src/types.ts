export type Brand<T, Name extends string> = T & {
  readonly __brand: Name;
};

export type DocumentId = Brand<string, "DocumentId">;
export type RevisionId = Brand<string, "RevisionId">;
export type SemanticId = Brand<string, "SemanticId">;
export type PrototypeId = Brand<string, "PrototypeId">;
export type OccurrenceId = Brand<string, "OccurrenceId">;
export type RepresentationId = Brand<string, "RepresentationId">;
export type MaterialId = Brand<string, "MaterialId">;
export type SourceRefId = Brand<string, "SourceRefId">;

export const ids = {
  document: (value: string) => value as DocumentId,
  revision: (value: string) => value as RevisionId,
  semantic: (value: string) => value as SemanticId,
  prototype: (value: string) => value as PrototypeId,
  occurrence: (value: string) => value as OccurrenceId,
  representation: (value: string) => value as RepresentationId,
  material: (value: string) => value as MaterialId,
  sourceRef: (value: string) => value as SourceRefId,
};

export type Vector3d = readonly [number, number, number];
export type Matrix4d = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface Bounds3d {
  readonly min: Vector3d;
  readonly max: Vector3d;
}

export interface UnitSystem {
  readonly length: string;
  readonly angle: string;
  readonly scaleToMeters: number;
}

export interface CoordinateFrame {
  readonly id?: string;
  readonly origin: Vector3d;
  readonly basis: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly handedness: "right" | "left";
  readonly upAxis: "X" | "Y" | "Z";
  readonly crs?: string;
}

export interface ToolIdentity {
  readonly name: string;
  readonly version: string;
  readonly build?: string;
}

export interface SceneRevision {
  readonly id: RevisionId;
  readonly sourceDigest: string;
  readonly adapter: ToolIdentity;
  readonly compiler?: ToolIdentity;
  readonly createdAt: string;
  readonly optionsDigest: string;
}

export interface AdapterCapabilities {
  readonly assemblyHierarchy: boolean;
  readonly brepTopology: boolean;
  readonly exactEvaluation: boolean;
  readonly pmi: boolean;
  readonly persistentIds: boolean;
  readonly sourceTessellation: boolean;
  readonly incrementalRevisions: boolean;
}

export type SourceReferenceKind =
  | "document"
  | "assembly-node"
  | "part"
  | "body"
  | "face"
  | "edge"
  | "vertex"
  | "property"
  | "external";

export interface SourceReference {
  readonly id: SourceRefId;
  readonly documentId: DocumentId;
  readonly namespace: string;
  readonly value: string;
  readonly kind: SourceReferenceKind;
  readonly stability: "persistent" | "revision-local" | "heuristic";
}

export type PropertyValue =
  | null
  | boolean
  | number
  | string
  | { readonly type: "quantity"; readonly value: number; readonly unit: string }
  | { readonly type: "enum"; readonly value: string; readonly schema?: string }
  | { readonly type: "uri"; readonly value: string }
  | { readonly type: "array"; readonly values: readonly PropertyValue[] };

export interface PropertyBag {
  readonly schema?: string;
  readonly entries: Readonly<Record<string, PropertyValue>>;
}

/**
 * Scene-level table for indexed semantic properties. `keys` holds every
 * distinct property key once; `sets` holds every distinct key combination as
 * a strictly ascending tuple of indexes into `keys`. An adapter that emits
 * indexed bags writes both tables deterministically (keys codepoint-sorted,
 * sets sorted lexicographically).
 */
export interface PropertyIndex {
  readonly keys: readonly string[];
  readonly sets: readonly (readonly number[])[];
}

/**
 * A property bag that references the scene's `propertyIndex` instead of
 * repeating key strings per entity: `values[i]` belongs to
 * `propertyIndex.keys[propertyIndex.sets[set][i]]`.
 */
export interface IndexedPropertyBag {
  readonly schema?: string;
  readonly set: number;
  readonly values: readonly PropertyValue[];
}

/**
 * A property bag whose values live in the scene's external property value
 * columns (`scene.propertyValues`) instead of the scene document itself:
 * the keys come from `propertyIndex.sets[set]` and the values from row `row`
 * of the column file. Resolving entries requires a `PropertyValueColumnReader`
 * opened over that file.
 */
export interface ColumnPropertyBag {
  readonly schema?: string;
  readonly set: number;
  readonly row: number;
}

export type SemanticProperties = PropertyBag | IndexedPropertyBag | ColumnPropertyBag;

/**
 * One stream inside the property value column file. Byte ranges are absolute
 * offsets into that file; every stream starts 8-byte aligned.
 */
export interface PropertyColumnStreamRef {
  readonly encoding: "u32le" | "utf8-json";
  readonly byteOffset: number;
  readonly byteLength: number;
}

/**
 * Scene-level header describing the external property value columns
 * (`madi.property-columns.1`). Every distinct value is stored once in
 * `valueHeap` as canonical compact JSON (UTF-8, keys sorted), sorted by
 * encoded byte sequence; `valueOffsets` holds `distinctValueCount + 1` byte
 * offsets bracketing each distinct value; `rows` holds one u32 distinct-value
 * index per (bag, position) in row order; `rowOffsets` holds `rowCount + 1`
 * offsets (in value counts) bracketing each row inside `rows`.
 */
export interface PropertyValueColumns {
  readonly encoding: "madi.property-columns.1";
  readonly valueCount: number;
  readonly rowCount: number;
  readonly distinctValueCount: number;
  readonly rows: PropertyColumnStreamRef;
  readonly rowOffsets: PropertyColumnStreamRef;
  readonly valueOffsets: PropertyColumnStreamRef;
  readonly valueHeap: PropertyColumnStreamRef;
}

export interface SourceDocument {
  readonly id: DocumentId;
  readonly uriHint?: string;
  readonly displayName: string;
  readonly mediaType?: string;
  readonly format: string;
  readonly formatVersion?: string;
  readonly sourceDigest: string;
  readonly revisionLabel?: string;
  readonly units: UnitSystem;
  readonly sourceFrame: CoordinateFrame;
  readonly adapterCapabilities: AdapterCapabilities;
  readonly sourceRefs: readonly SourceReference[];
  readonly metadata: PropertyBag;
}

export interface Prototype {
  readonly id: PrototypeId;
  readonly name?: string;
  readonly semanticId?: SemanticId;
  readonly sourceRef?: SourceRefId;
  readonly representationIds: readonly RepresentationId[];
  readonly localBounds: Bounds3d;
  readonly defaultMaterialId?: MaterialId;
  readonly metadata: PropertyBag;
}

export interface Occurrence {
  readonly id: OccurrenceId;
  readonly parentId?: OccurrenceId;
  readonly prototypeId: PrototypeId;
  readonly name?: string;
  readonly semanticId?: SemanticId;
  readonly sourceRef?: SourceRefId;
  readonly localTransform: Matrix4d;
  readonly materialOverrideId?: MaterialId;
  readonly initialVisibility: boolean;
  readonly tags: readonly string[];
  readonly metadata: PropertyBag;
}

export interface SemanticRelation {
  readonly type: string;
  readonly targetId: SemanticId;
  readonly metadata?: PropertyBag;
}

export interface Classification {
  readonly system: string;
  readonly code: string;
  readonly label?: string;
}

export interface SemanticEntity {
  readonly id: SemanticId;
  readonly documentId: DocumentId;
  readonly type: string;
  readonly name?: string;
  readonly description?: string;
  readonly sourceRef?: SourceRefId;
  readonly parentIds: readonly SemanticId[];
  readonly relationIds: readonly SemanticRelation[];
  readonly properties: SemanticProperties;
  readonly classification?: readonly Classification[];
}

export interface AccuracyDescriptor {
  readonly kind: "source-exact" | "tessellated" | "simplified" | "derived";
  readonly linearTolerance?: number;
  readonly angularTolerance?: number;
  readonly unit?: string;
  readonly notes?: readonly string[];
}

export interface MaterialGroup {
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly materialId: MaterialId;
}

export interface SurfaceGeometry {
  readonly primitive: "triangles";
  readonly positions: Float64Array | Float32Array;
  readonly indices: Uint32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  readonly colorIds?: Uint32Array;
  readonly materialGroups?: readonly MaterialGroup[];
  readonly faceSourceIds?: Uint32Array;
}

export const edgeClassCode = {
  boundary: 0,
  sharp: 1,
  smooth: 2,
  seam: 3,
  "silhouette-candidate": 4,
  annotation: 5,
  construction: 6,
} as const;

export type EdgeClass = keyof typeof edgeClassCode;

export interface CurveHint {
  readonly kind: "line" | "circle" | "ellipse" | "bspline" | "other";
  readonly sourceRef?: SourceRefId;
}

export interface EdgeGeometry {
  readonly positions: Float64Array | Float32Array;
  readonly segments: Uint32Array;
  readonly classes: Uint8Array;
  readonly sourceIds?: Uint32Array;
  readonly curveHints?: readonly CurveHint[];
}

export interface PointGeometry {
  readonly positions: Float64Array | Float32Array;
  readonly sourceIds?: Uint32Array;
}

export interface RepresentationSourceMap {
  readonly sourceRefs: readonly SourceRefId[];
  readonly faceSourceIndices?: Uint32Array;
  readonly edgeSourceIndices?: Uint32Array;
}

export interface Representation {
  readonly id: RepresentationId;
  readonly prototypeId: PrototypeId;
  readonly purpose:
    | "coarse-display"
    | "display"
    | "edges"
    | "analysis"
    | "collision";
  readonly accuracy: AccuracyDescriptor;
  readonly localFrame: CoordinateFrame;
  readonly surface?: SurfaceGeometry;
  readonly edges?: EdgeGeometry;
  readonly points?: PointGeometry;
  readonly bounds: Bounds3d;
  readonly sourceMap?: RepresentationSourceMap;
}

export interface EdgeStyle {
  readonly color: readonly [number, number, number, number];
  readonly width?: number;
}

export interface Material {
  readonly id: MaterialId;
  readonly name?: string;
  readonly baseColor: readonly [number, number, number, number];
  readonly metallic?: number;
  readonly roughness?: number;
  readonly doubleSided?: boolean;
  readonly alphaMode?: "opaque" | "mask" | "blend";
  readonly edgeStyle?: EdgeStyle;
  readonly sourceRef?: SourceRefId;
}

export interface Diagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly documentId?: DocumentId;
  readonly sourceRef?: SourceRefId;
  readonly data?: PropertyBag;
}

export interface EngineeringScene {
  readonly schemaVersion: string;
  readonly sceneId: string;
  readonly revision: SceneRevision;
  readonly units: UnitSystem;
  readonly rootFrame: CoordinateFrame;
  readonly documents: readonly SourceDocument[];
  readonly propertyIndex?: PropertyIndex;
  readonly propertyValues?: PropertyValueColumns;
  readonly prototypes: readonly Prototype[];
  readonly occurrences: readonly Occurrence[];
  readonly semantics: readonly SemanticEntity[];
  readonly representations: readonly Representation[];
  readonly materials: readonly Material[];
  readonly diagnostics: readonly Diagnostic[];
}
