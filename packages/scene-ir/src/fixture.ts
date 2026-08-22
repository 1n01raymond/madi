import { edgeClassCode, ids } from "./types.js";
import type {
  CoordinateFrame,
  EngineeringScene,
  Matrix4d,
  PropertyBag,
} from "./types.js";

const emptyProperties: PropertyBag = { entries: {} };

const rootFrame: CoordinateFrame = {
  origin: [0, 0, 0],
  basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  handedness: "right",
  upAxis: "Y",
};

function translation(x: number): Matrix4d {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
}

/**
 * Creates the smallest scene that proves prototype/occurrence separation and
 * explicit source-edge mapping. Both occurrences reference one geometry object.
 */
export function createRepeatedTriangleScene(): EngineeringScene {
  const documentId = ids.document("document:phase-0-triangle");
  const partRef = ids.sourceRef("source:part:triangle");
  const faceRef = ids.sourceRef("source:face:triangle");
  const edgeRefs = [0, 1, 2].map((index) =>
    ids.sourceRef(`source:edge:triangle:${index}`),
  );
  const prototypeId = ids.prototype("prototype:triangle");
  const representationId = ids.representation("representation:triangle:display");
  const materialId = ids.material("material:phase-0-blue");
  const semanticId = ids.semantic("semantic:triangle-part");

  return {
    schemaVersion: "0.1",
    sceneId: "scene:phase-0-repeated-triangle",
    revision: {
      id: ids.revision("revision:phase-0-repeated-triangle:v1"),
      sourceDigest: "sha256:phase-0-generated-fixture",
      adapter: { name: "@madi/scene-ir fixture", version: "0.0.0" },
      createdAt: "1970-01-01T00:00:00.000Z",
      optionsDigest: "sha256:default-options",
    },
    units: { length: "m", angle: "rad", scaleToMeters: 1 },
    rootFrame,
    documents: [
      {
        id: documentId,
        displayName: "Generated repeated triangle",
        mediaType: "model/step",
        format: "generated-fixture",
        sourceDigest: "sha256:phase-0-generated-fixture",
        units: { length: "m", angle: "rad", scaleToMeters: 1 },
        sourceFrame: rootFrame,
        adapterCapabilities: {
          assemblyHierarchy: true,
          brepTopology: true,
          exactEvaluation: false,
          pmi: false,
          persistentIds: false,
          sourceTessellation: true,
          incrementalRevisions: false,
        },
        sourceRefs: [
          {
            id: partRef,
            documentId,
            namespace: "generated",
            value: "triangle-part",
            kind: "part",
            stability: "revision-local",
          },
          {
            id: faceRef,
            documentId,
            namespace: "generated",
            value: "triangle-face",
            kind: "face",
            stability: "revision-local",
          },
          ...edgeRefs.map((id, index) => ({
            id,
            documentId,
            namespace: "generated",
            value: `triangle-edge-${index}`,
            kind: "edge" as const,
            stability: "revision-local" as const,
          })),
        ],
        metadata: emptyProperties,
      },
    ],
    prototypes: [
      {
        id: prototypeId,
        name: "Triangle prototype",
        semanticId,
        sourceRef: partRef,
        representationIds: [representationId],
        localBounds: { min: [-0.25, -0.25, 0], max: [0.25, 0.25, 0] },
        defaultMaterialId: materialId,
        metadata: emptyProperties,
      },
    ],
    occurrences: [
      {
        id: ids.occurrence("occurrence:triangle:left"),
        prototypeId,
        name: "Left occurrence",
        semanticId,
        sourceRef: partRef,
        localTransform: translation(-0.35),
        initialVisibility: true,
        tags: ["phase-0"],
        metadata: emptyProperties,
      },
      {
        id: ids.occurrence("occurrence:triangle:right"),
        prototypeId,
        name: "Right occurrence",
        semanticId,
        sourceRef: partRef,
        localTransform: translation(0.35),
        initialVisibility: true,
        tags: ["phase-0"],
        metadata: emptyProperties,
      },
    ],
    semantics: [
      {
        id: semanticId,
        documentId,
        type: "part",
        name: "Generated triangle part",
        sourceRef: partRef,
        parentIds: [],
        relationIds: [],
        properties: {
          entries: {
            fixture: true,
            occurrenceCount: 2,
          },
        },
      },
    ],
    representations: [
      {
        id: representationId,
        prototypeId,
        purpose: "display",
        accuracy: {
          kind: "tessellated",
          linearTolerance: 0,
          unit: "m",
          notes: ["Generated bootstrap fixture; not source-exact."],
        },
        localFrame: rootFrame,
        surface: {
          primitive: "triangles",
          positions: new Float32Array([
            -0.25, -0.25, 0, 0.25, -0.25, 0, 0, 0.25, 0,
          ]),
          indices: new Uint32Array([0, 1, 2]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          faceSourceIds: new Uint32Array([0]),
          materialGroups: [
            { firstIndex: 0, indexCount: 3, materialId },
          ],
        },
        edges: {
          positions: new Float32Array([
            -0.25, -0.25, 0, 0.25, -0.25, 0, 0, 0.25, 0,
          ]),
          segments: new Uint32Array([0, 1, 1, 2, 2, 0]),
          classes: new Uint8Array([
            edgeClassCode.boundary,
            edgeClassCode.boundary,
            edgeClassCode.boundary,
          ]),
          sourceIds: new Uint32Array([1, 2, 3]),
        },
        bounds: { min: [-0.25, -0.25, 0], max: [0.25, 0.25, 0] },
        sourceMap: {
          sourceRefs: [faceRef, ...edgeRefs],
          faceSourceIndices: new Uint32Array([0]),
          edgeSourceIndices: new Uint32Array([1, 2, 3]),
        },
      },
    ],
    materials: [
      {
        id: materialId,
        name: "Phase 0 blue",
        baseColor: [0.16, 0.55, 0.92, 1],
        metallic: 0.05,
        roughness: 0.7,
        edgeStyle: { color: [0.02, 0.08, 0.14, 1], width: 1 },
      },
    ],
    diagnostics: [],
  };
}
