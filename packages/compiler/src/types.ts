import type { ValidationResult } from "@naru3d/scene-ir";

export const experimentalGltfProfile = "madi.experimental.gltf.1";
export const compilerEvidenceSchema = "madi.phase1.compiler-report.1";

export interface GltfAsset {
  readonly version: "2.0";
  readonly generator: string;
}

export interface GltfBuffer {
  readonly uri: string;
  readonly byteLength: number;
}

export interface GltfBufferView {
  readonly buffer: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly target?: 34962 | 34963;
  readonly name?: string;
}

export interface GltfAccessor {
  readonly bufferView: number;
  readonly componentType: 5121 | 5125 | 5126;
  readonly count: number;
  readonly type: "SCALAR" | "VEC3";
  readonly min?: readonly number[];
  readonly max?: readonly number[];
  readonly name?: string;
}

export interface GltfPrimitive {
  readonly attributes: Readonly<Record<string, number>>;
  readonly indices?: number;
  readonly material?: number;
  readonly mode: 1 | 4;
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfMesh {
  readonly name?: string;
  readonly primitives: readonly GltfPrimitive[];
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly matrix?: readonly number[];
  readonly mesh?: number;
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfMaterial {
  readonly name?: string;
  readonly pbrMetallicRoughness: {
    readonly baseColorFactor: readonly [number, number, number, number];
    readonly metallicFactor: number;
    readonly roughnessFactor: number;
  };
  readonly doubleSided?: boolean;
  readonly alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfDocument {
  readonly asset: GltfAsset;
  readonly scene: 0;
  readonly scenes: readonly [{ readonly name: string; readonly nodes: readonly number[] }];
  readonly nodes: readonly GltfNode[];
  readonly meshes: readonly GltfMesh[];
  readonly materials: readonly GltfMaterial[];
  readonly buffers: readonly GltfBuffer[];
  readonly bufferViews: readonly GltfBufferView[];
  readonly accessors: readonly GltfAccessor[];
  readonly extras: Readonly<Record<string, unknown>>;
}

export interface CompilerResourceRecord {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CompilerBuildReport {
  readonly schemaVersion: typeof compilerEvidenceSchema;
  readonly profile: typeof experimentalGltfProfile;
  readonly status: "experimental-not-interchange";
  readonly compiler: {
    readonly name: "@madi/compiler";
    readonly version: "0.0.0";
    readonly generator: string;
  };
  readonly options: {
    readonly binaryUri: string;
    readonly coarseBinaryUri?: string;
    readonly propertiesUri?: string;
    readonly propertiesBinaryUri?: string;
    readonly coordinateSystem: "right-handed-y-up-meters";
    readonly geometryEncoding: "gltf-f32";
    /** JSON whitespace policy. Omitted for the historical pretty-printed default. */
    readonly jsonFormatting?: "compact";
    /** Optional size policy for non-semantic glTF resource labels. */
    readonly resourceNames?: "omitted";
    readonly progressiveRepresentation?: "prototype-aabb-v1";
    readonly targetChunking?: "prototype-range-v1" | "coalesced-prototype-range-v1";
    /** Maximum bytes per progressive target request when coalescing is enabled. */
    readonly targetChunkByteBudget?: number;
    /** Optional physical target payload order derived from spatial BVH leaves. */
    readonly targetPayloadOrder?: "spatial-leaf-anchor-v1";
  };
  readonly source: {
    readonly sceneId: string;
    readonly revisionId: string;
    readonly sourceDigest: string;
    readonly adapter: string;
    readonly optionsDigest: string;
  };
  readonly output: {
    readonly packageDigest: string;
    readonly resources: readonly CompilerResourceRecord[];
  };
  readonly counts: {
    readonly prototypeCount: number;
    readonly compiledPrototypeCount: number;
    readonly occurrenceCount: number;
    readonly renderableOccurrenceCount: number;
    readonly gltfNodeCount: number;
    readonly gltfMeshCount: number;
    readonly materialCount: number;
    readonly triangleCount: number;
    readonly edgeSegmentCount: number;
    readonly targetChunkCount?: number;
  };
  readonly prototypeReuse: readonly {
    readonly prototypeId: string;
    readonly occurrenceCount: number;
  }[];
  readonly diagnostics: {
    readonly counts: Readonly<Record<"info" | "warning" | "error", number>>;
    readonly codes: readonly string[];
  };
  readonly limitations: readonly string[];
}

export interface CompiledGltfPackage {
  readonly document: GltfDocument;
  readonly json: string;
  readonly binary: Uint8Array;
  readonly coarseBinary?: Uint8Array;
  /** Optional `naru.spatial-demand-index.1` derived-cache sidecar. */
  readonly spatialBinary?: Uint8Array;
  /** Resource URI paired with `spatialBinary`. */
  readonly spatialBinaryUri?: string;
  /** Compact-JSON property sidecar (`madi.package-properties.1`), when emitted. */
  readonly propertiesJson?: string;
  /** Byte-verbatim `madi.property-columns.1` column file, when emitted. */
  readonly propertiesBinary?: Uint8Array;
  readonly report: CompilerBuildReport;
  /**
   * The Scene IR validation the compiler already ran on its input. Exposed so
   * callers can report on it without validating the scene a second time.
   */
  readonly sceneValidation: ValidationResult;
}

export interface CompileGltfOptions {
  readonly binaryUri?: string;
  readonly coarseBounds?: boolean;
  readonly coarseBinaryUri?: string;
  readonly generator?: string;
  /** Omit insignificant JSON whitespace for packages near V8's string limit. */
  readonly compactJson?: boolean;
  /** Omit mesh, bufferView, and accessor names while preserving semantic identity. */
  readonly omitResourceNames?: boolean;
  /**
   * Coalesce adjacent prototype ranges into deterministic HTTP Range requests.
   * Omit this to retain one target chunk per prototype for compatibility.
   */
  readonly targetChunkByteBudget?: number;
  /**
   * Order prototype payloads by their dominant deterministic spatial leaf
   * before byte-budget coalescing. Requires spatialIndex and a chunk budget.
   */
  readonly spatialPayloadOrder?: boolean;
  /** Emit an optional occurrence BVH that maps spatial leaves to target chunks. */
  readonly spatialIndex?: boolean;
  readonly spatialBinaryUri?: string;
  /** Maximum renderable occurrences per spatial BVH leaf. Defaults to 64. */
  readonly spatialLeafCapacity?: number;
  /**
   * The adapter's `madi.property-columns.1` value column file for a scene
   * whose semantics reference `scene.propertyValues`. Required for such a
   * scene; the package then carries the file byte-verbatim next to a
   * `madi.package-properties.1` JSON sidecar so viewers can resolve semantic
   * property entries lazily.
   */
  readonly propertyColumns?: Uint8Array;
  readonly propertiesUri?: string;
  readonly propertiesBinaryUri?: string;
}

export interface PackageValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface PackageValidationResult {
  readonly ok: boolean;
  readonly issues: readonly PackageValidationIssue[];
}
