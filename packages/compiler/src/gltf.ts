import { createHash } from "node:crypto";

import { validateScene } from "@madi/scene-ir";
import type {
  EngineeringScene,
  Material,
  MaterialId,
  Matrix4d,
  Occurrence,
  Prototype,
  Representation,
} from "@madi/scene-ir";

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
import type {
  CompileGltfOptions,
  CompiledGltfPackage,
  CompilerBuildReport,
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

function compareId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id, "en");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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

function scaledOccurrenceMatrix(matrix: Matrix4d, scaleToMeters: number): number[] {
  return Array.from(matrix, (value, index) =>
    Math.fround(index >= 12 && index <= 14 ? value * scaleToMeters : value),
  );
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
    const bounds = scaledPositionBounds(edges.positions, scaleToMeters);
    edgePositionAccessor = builder.append(encodeFloat32(edges.positions, scaleToMeters), {
      componentType: 5126,
      count: edges.positions.length / 3,
      type: "VEC3",
      target: 34962,
      name: `${representation.id} edge positions`,
      ...bounds,
    });
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

export function compileSceneToGltf(
  scene: EngineeringScene,
  options: CompileGltfOptions = {},
): CompiledGltfPackage {
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
  const generator = options.generator ?? "MADI compiler 0.0.0 / experimental glTF profile 1";
  const scaleToMeters = scene.units.scaleToMeters;
  const builder = new GltfBinaryBuilder();
  const representations = new Map(scene.representations.map((value) => [value.id, value]));
  const prototypes = [...scene.prototypes].sort(compareId);
  const prototypeById = new Map(prototypes.map((value) => [value.id, value]));
  const geometryByPrototype = new Map<string, GeometryResource>();
  let triangleCount = 0;
  let edgeSegmentCount = 0;

  for (const prototype of prototypes) {
    const representation = representationFor(prototype, representations);
    if (!representation) continue;
    const compiled = appendGeometry(builder, prototype, representation, scaleToMeters);
    geometryByPrototype.set(prototype.id, compiled.resource);
    triangleCount += compiled.triangles;
    edgeSegmentCount += compiled.edges;
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
    return meshIndex;
  }

  const occurrences = [...scene.occurrences].sort(compareId);
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
    const childIndexes = (children.get(occurrence.id) ?? []).map(
      ({ id }) => occurrenceIndexes.get(id) ?? 0,
    );
    nodes.push({
      name: occurrence.name ?? occurrence.id,
      ...(childIndexes.length === 0 ? {} : { children: childIndexes }),
      matrix: scaledOccurrenceMatrix(occurrence.localTransform, scaleToMeters),
      ...(geometry === undefined
        ? {}
        : { mesh: meshFor(geometry, occurrence.materialOverrideId) }),
      extras: {
        madi: {
          occurrenceId: occurrence.id,
          prototypeId: occurrence.prototypeId,
          semanticId: occurrence.semanticId,
          sourceRef: occurrence.sourceRef,
          initialVisibility: occurrence.initialVisibility,
          tags: [...occurrence.tags],
        },
      },
    });
  }

  const binary = builder.finish();
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
    buffers: [{ uri: binaryUri, byteLength: binary.byteLength }],
    bufferViews: builder.bufferViews,
    accessors: builder.accessors,
    extras: {
      madi: {
        profile: experimentalGltfProfile,
        status: "experimental-not-interchange",
        sceneId: scene.sceneId,
        revisionId: scene.revision.id,
        sourceDigest: scene.revision.sourceDigest,
        optionsDigest: scene.revision.optionsDigest,
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
  const json = `${JSON.stringify(document, null, 2)}\n`;
  const jsonDigest = sha256(json);
  const binaryDigest = sha256(binary);
  const packageDigest = createHash("sha256").update(json).update(binary).digest("hex");
  const diagnosticCounts = { info: 0, warning: 0, error: 0 };
  for (const diagnostic of diagnostics) diagnosticCounts[diagnostic.severity] += 1;
  const occurrenceCounts = new Map<string, number>();
  for (const occurrence of occurrences) {
    occurrenceCounts.set(
      occurrence.prototypeId,
      (occurrenceCounts.get(occurrence.prototypeId) ?? 0) + 1,
    );
  }
  const report: CompilerBuildReport = {
    schemaVersion: compilerEvidenceSchema,
    profile: experimentalGltfProfile,
    status: "experimental-not-interchange",
    compiler: {
      name: "@madi/compiler",
      version: "0.0.0",
      generator,
    },
    options: {
      binaryUri,
      coordinateSystem: "right-handed-y-up-meters",
      geometryEncoding: "gltf-f32",
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
      "Only one target display representation per prototype is emitted; coarse LOD is pending.",
      "Geometry and node transforms are converted to f32 for glTF delivery.",
      "MADI source mapping uses glTF extras until an interoperable extension is justified.",
    ],
  };
  return { document, json, binary, report };
}
