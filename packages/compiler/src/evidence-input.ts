import type {
  CurveHint,
  EngineeringScene,
  MaterialGroup,
  Representation,
} from "@madi/scene-ir";

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

type SerializedScene = Omit<EngineeringScene, "representations"> & {
  readonly representations: readonly SerializedRepresentation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Hydrates the committed Phase 0 JSON evidence; this is not a delivery-format API. */
export function hydratePhase0Evidence(value: unknown): EngineeringScene {
  if (!isRecord(value) || !Array.isArray(value.representations)) {
    throw new TypeError("Phase 0 evidence must contain a representations array.");
  }
  const scene = value as unknown as SerializedScene;
  return {
    ...scene,
    representations: scene.representations.map((representation) => ({
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
    })),
  };
}
