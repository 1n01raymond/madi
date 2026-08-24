import { isColumnPropertyBag, isIndexedPropertyBag } from "./properties.js";
import { edgeClassCode } from "./types.js";
import type {
  Bounds3d,
  EngineeringScene,
  Matrix4d,
  PropertyIndex,
  PropertyValue,
  Representation,
  UnitSystem,
} from "./types.js";

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validateBounds(
  bounds: Bounds3d,
  path: string,
  add: (issue: ValidationIssue) => void,
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const min = bounds.min[axis]!;
    const max = bounds.max[axis]!;
    if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
      add({
        severity: "error",
        code: "NON_FINITE_BOUNDS",
        path,
        message: `Bounds axis ${axis} must contain finite numbers.`,
      });
    } else if (min > max) {
      add({
        severity: "error",
        code: "INVERTED_BOUNDS",
        path,
        message: `Bounds axis ${axis} has min greater than max.`,
      });
    }
  }
}

function validateMatrix(
  matrix: Matrix4d,
  path: string,
  add: (issue: ValidationIssue) => void,
): void {
  if (matrix.length !== 16 || matrix.some((value) => !isFiniteNumber(value))) {
    add({
      severity: "error",
      code: "INVALID_TRANSFORM",
      path,
      message: "Occurrence transforms must contain 16 finite numbers.",
    });
  }
}

function validateUnits(
  units: UnitSystem,
  path: string,
  add: (issue: ValidationIssue) => void,
): void {
  if (!units.length || !units.angle) {
    add({
      severity: "error",
      code: "UNDECLARED_UNITS",
      path,
      message: "Length and angle units must be declared.",
    });
  }
  if (!isFiniteNumber(units.scaleToMeters) || units.scaleToMeters <= 0) {
    add({
      severity: "error",
      code: "INVALID_UNIT_SCALE",
      path,
      message: "scaleToMeters must be a positive finite number.",
    });
  }
}

function validatePropertyValue(
  value: PropertyValue,
  path: string,
  add: (issue: ValidationIssue) => void,
): void {
  if (typeof value === "number" && !isFiniteNumber(value)) {
    add({
      severity: "error",
      code: "NON_FINITE_PROPERTY",
      path,
      message: "Numeric property values must be finite.",
    });
    return;
  }

  if (typeof value !== "object" || value === null || !("type" in value)) {
    return;
  }

  if (value.type === "quantity" && !isFiniteNumber(value.value)) {
    add({
      severity: "error",
      code: "NON_FINITE_PROPERTY",
      path,
      message: "Quantity property values must be finite.",
    });
  }
  if (value.type === "array") {
    value.values.forEach((entry, index) =>
      validatePropertyValue(entry, `${path}.values[${index}]`, add),
    );
  }
}

function validatePropertyIndex(
  propertyIndex: PropertyIndex,
  add: (issue: ValidationIssue) => void,
): void {
  const seenKeys = new Set<string>();
  propertyIndex.keys.forEach((key, index) => {
    const path = `propertyIndex.keys[${index}]`;
    if (!key) {
      add({
        severity: "error",
        code: "EMPTY_PROPERTY_KEY",
        path,
        message: "Property keys cannot be empty.",
      });
      return;
    }
    if (seenKeys.has(key)) {
      add({
        severity: "error",
        code: "DUPLICATE_PROPERTY_KEY",
        path,
        message: `Property key ${key} is declared more than once.`,
      });
      return;
    }
    seenKeys.add(key);
  });
  propertyIndex.sets.forEach((set, setIndex) => {
    let previous = -1;
    set.forEach((keyIndex, position) => {
      const path = `propertyIndex.sets[${setIndex}][${position}]`;
      if (
        !Number.isInteger(keyIndex) ||
        keyIndex < 0 ||
        keyIndex >= propertyIndex.keys.length
      ) {
        add({
          severity: "error",
          code: "PROPERTY_KEY_OUT_OF_RANGE",
          path,
          message: `Key index ${String(keyIndex)} is not a valid propertyIndex.keys index.`,
        });
        return;
      }
      if (keyIndex <= previous) {
        add({
          severity: "error",
          code: "PROPERTY_SET_NOT_ASCENDING",
          path,
          message: "Property sets must list key indexes in strictly ascending order.",
        });
      }
      previous = keyIndex;
    });
  });
}

function validateRepresentationGeometry(
  representation: Representation,
  path: string,
  materialIds: ReadonlySet<string>,
  add: (issue: ValidationIssue) => void,
): void {
  validateBounds(representation.bounds, `${path}.bounds`, add);
  const surface = representation.surface;
  if (surface) {
    const vertexCount = surface.positions.length / 3;
    if (!Number.isInteger(vertexCount)) {
      add({
        severity: "error",
        code: "INVALID_POSITION_COUNT",
        path: `${path}.surface.positions`,
        message: "Surface positions must contain xyz triplets.",
      });
    }
    if (surface.indices.length % 3 !== 0) {
      add({
        severity: "error",
        code: "INVALID_TRIANGLE_COUNT",
        path: `${path}.surface.indices`,
        message: "Triangle indices must be grouped in threes.",
      });
    }
    surface.indices.forEach((index, offset) => {
      if (index >= vertexCount) {
        add({
          severity: "error",
          code: "INDEX_OUT_OF_RANGE",
          path: `${path}.surface.indices[${offset}]`,
          message: `Vertex index ${index} exceeds vertex count ${vertexCount}.`,
        });
      }
    });
    if (surface.normals && surface.normals.length !== surface.positions.length) {
      add({
        severity: "error",
        code: "ATTRIBUTE_COUNT_MISMATCH",
        path: `${path}.surface.normals`,
        message: "Surface normals must match the position count.",
      });
    }
    if (
      surface.faceSourceIds &&
      surface.faceSourceIds.length !== surface.indices.length / 3
    ) {
      add({
        severity: "error",
        code: "SOURCE_MAP_COUNT_MISMATCH",
        path: `${path}.surface.faceSourceIds`,
        message: "Face source IDs must map one entry per triangle.",
      });
    }
    surface.materialGroups?.forEach((group, index) => {
      if (
        group.firstIndex + group.indexCount > surface.indices.length ||
        group.firstIndex < 0 ||
        group.indexCount < 0
      ) {
        add({
          severity: "error",
          code: "MATERIAL_GROUP_OUT_OF_RANGE",
          path: `${path}.surface.materialGroups[${index}]`,
          message: "Material group range exceeds the surface index buffer.",
        });
      }
      if (!materialIds.has(group.materialId)) {
        add({
          severity: "error",
          code: "MISSING_REFERENCE",
          path: `${path}.surface.materialGroups[${index}].materialId`,
          message: `Unknown material ${group.materialId}.`,
        });
      }
    });
  }

  const edges = representation.edges;
  if (edges) {
    const vertexCount = edges.positions.length / 3;
    const segmentCount = edges.segments.length / 2;
    if (!Number.isInteger(vertexCount) || !Number.isInteger(segmentCount)) {
      add({
        severity: "error",
        code: "INVALID_EDGE_LAYOUT",
        path: `${path}.edges`,
        message: "Edge positions must be xyz triplets and segments index pairs.",
      });
    }
    edges.segments.forEach((index, offset) => {
      if (index >= vertexCount) {
        add({
          severity: "error",
          code: "INDEX_OUT_OF_RANGE",
          path: `${path}.edges.segments[${offset}]`,
          message: `Edge vertex index ${index} exceeds vertex count ${vertexCount}.`,
        });
      }
    });
    if (edges.classes.length !== segmentCount) {
      add({
        severity: "error",
        code: "ATTRIBUTE_COUNT_MISMATCH",
        path: `${path}.edges.classes`,
        message: "Edge classes must map one entry per segment.",
      });
    }
    edges.classes.forEach((edgeClass, offset) => {
      if (edgeClass > edgeClassCode.construction) {
        add({
          severity: "error",
          code: "UNKNOWN_EDGE_CLASS",
          path: `${path}.edges.classes[${offset}]`,
          message: `Unknown edge class code ${edgeClass}.`,
        });
      }
    });
    if (edges.sourceIds && edges.sourceIds.length !== segmentCount) {
      add({
        severity: "error",
        code: "SOURCE_MAP_COUNT_MISMATCH",
        path: `${path}.edges.sourceIds`,
        message: "Edge source IDs must map one entry per segment.",
      });
    }
  }

  const sourceMap = representation.sourceMap;
  if (sourceMap) {
    const limit = sourceMap.sourceRefs.length;
    for (const [name, indices] of [
      ["faceSourceIndices", sourceMap.faceSourceIndices],
      ["edgeSourceIndices", sourceMap.edgeSourceIndices],
    ] as const) {
      indices?.forEach((index, offset) => {
        if (index >= limit) {
          add({
            severity: "error",
            code: "SOURCE_MAP_OUT_OF_RANGE",
            path: `${path}.sourceMap.${name}[${offset}]`,
            message: `Source-map index ${index} exceeds table size ${limit}.`,
          });
        }
      });
    }
  }
}

export function validateScene(scene: EngineeringScene): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => issues.push(issue);
  const ids = new Map<string, string>();
  const register = (id: string, path: string): void => {
    if (!id) {
      add({ severity: "error", code: "EMPTY_ID", path, message: "ID cannot be empty." });
      return;
    }
    const previous = ids.get(id);
    if (previous) {
      add({
        severity: "error",
        code: "DUPLICATE_ID",
        path,
        message: `ID ${id} is already declared at ${previous}.`,
      });
      return;
    }
    ids.set(id, path);
  };
  const requireReference = (
    id: string | undefined,
    allowed: ReadonlySet<string>,
    path: string,
  ): void => {
    if (id !== undefined && !allowed.has(id)) {
      add({
        severity: "error",
        code: "MISSING_REFERENCE",
        path,
        message: `Unknown reference ${id}.`,
      });
    }
  };

  if (!scene.schemaVersion || !scene.sceneId) {
    add({
      severity: "error",
      code: "INVALID_SCENE_HEADER",
      path: "scene",
      message: "schemaVersion and sceneId are required.",
    });
  }
  register(scene.revision.id, "revision.id");
  validateUnits(scene.units, "units", add);
  if (scene.propertyIndex) validatePropertyIndex(scene.propertyIndex, add);

  scene.documents.forEach((document, documentIndex) => {
    const path = `documents[${documentIndex}]`;
    register(document.id, `${path}.id`);
    validateUnits(document.units, `${path}.units`, add);
    document.sourceRefs.forEach((sourceRef, sourceIndex) => {
      register(sourceRef.id, `${path}.sourceRefs[${sourceIndex}].id`);
    });
    Object.entries(document.metadata.entries).forEach(([key, value]) =>
      validatePropertyValue(value, `${path}.metadata.entries.${key}`, add),
    );
  });
  scene.prototypes.forEach((prototype, index) =>
    register(prototype.id, `prototypes[${index}].id`),
  );
  scene.occurrences.forEach((occurrence, index) =>
    register(occurrence.id, `occurrences[${index}].id`),
  );
  scene.semantics.forEach((semantic, index) =>
    register(semantic.id, `semantics[${index}].id`),
  );
  scene.representations.forEach((representation, index) =>
    register(representation.id, `representations[${index}].id`),
  );
  scene.materials.forEach((material, index) =>
    register(material.id, `materials[${index}].id`),
  );

  const documentIds = new Set(scene.documents.map(({ id }) => id as string));
  const prototypeIds = new Set(scene.prototypes.map(({ id }) => id as string));
  const occurrenceIds = new Set(scene.occurrences.map(({ id }) => id as string));
  const semanticIds = new Set(scene.semantics.map(({ id }) => id as string));
  const representationIds = new Set(
    scene.representations.map(({ id }) => id as string),
  );
  const materialIds = new Set(scene.materials.map(({ id }) => id as string));
  const sourceRefIds = new Set(
    scene.documents.flatMap((document) =>
      document.sourceRefs.map(({ id }) => id as string),
    ),
  );

  scene.documents.forEach((document, documentIndex) => {
    document.sourceRefs.forEach((sourceRef, sourceIndex) =>
      requireReference(
        sourceRef.documentId,
        documentIds,
        `documents[${documentIndex}].sourceRefs[${sourceIndex}].documentId`,
      ),
    );
  });

  scene.prototypes.forEach((prototype, index) => {
    const path = `prototypes[${index}]`;
    validateBounds(prototype.localBounds, `${path}.localBounds`, add);
    requireReference(prototype.semanticId, semanticIds, `${path}.semanticId`);
    requireReference(prototype.sourceRef, sourceRefIds, `${path}.sourceRef`);
    requireReference(
      prototype.defaultMaterialId,
      materialIds,
      `${path}.defaultMaterialId`,
    );
    prototype.representationIds.forEach((id, representationIndex) =>
      requireReference(
        id,
        representationIds,
        `${path}.representationIds[${representationIndex}]`,
      ),
    );
  });

  const occurrenceById = new Map(
    scene.occurrences.map((occurrence) => [occurrence.id as string, occurrence]),
  );
  scene.occurrences.forEach((occurrence, index) => {
    const path = `occurrences[${index}]`;
    requireReference(occurrence.parentId, occurrenceIds, `${path}.parentId`);
    requireReference(occurrence.prototypeId, prototypeIds, `${path}.prototypeId`);
    requireReference(occurrence.semanticId, semanticIds, `${path}.semanticId`);
    requireReference(occurrence.sourceRef, sourceRefIds, `${path}.sourceRef`);
    requireReference(
      occurrence.materialOverrideId,
      materialIds,
      `${path}.materialOverrideId`,
    );
    validateMatrix(occurrence.localTransform, `${path}.localTransform`, add);
  });

  for (const occurrence of scene.occurrences) {
    const visited = new Set<string>();
    let cursor = occurrence;
    while (cursor.parentId) {
      if (visited.has(cursor.id)) {
        add({
          severity: "error",
          code: "OCCURRENCE_CYCLE",
          path: `occurrences.${occurrence.id}.parentId`,
          message: `Occurrence hierarchy contains a cycle through ${cursor.id}.`,
        });
        break;
      }
      visited.add(cursor.id);
      const parent = occurrenceById.get(cursor.parentId);
      if (!parent) break;
      cursor = parent;
    }
  }

  scene.semantics.forEach((semantic, index) => {
    const path = `semantics[${index}]`;
    requireReference(semantic.documentId, documentIds, `${path}.documentId`);
    requireReference(semantic.sourceRef, sourceRefIds, `${path}.sourceRef`);
    semantic.parentIds.forEach((id, parentIndex) =>
      requireReference(id, semanticIds, `${path}.parentIds[${parentIndex}]`),
    );
    semantic.relationIds.forEach((relation, relationIndex) =>
      requireReference(
        relation.targetId,
        semanticIds,
        `${path}.relationIds[${relationIndex}].targetId`,
      ),
    );
    if (isColumnPropertyBag(semantic.properties)) {
      const { set, row } = semantic.properties;
      if (!scene.propertyIndex || !scene.propertyValues) {
        add({
          severity: "error",
          code: "MISSING_PROPERTY_COLUMNS",
          path: `${path}.properties.row`,
          message:
            "Column properties require both a scene propertyIndex and propertyValues.",
        });
      } else {
        if (!Number.isInteger(set) || scene.propertyIndex.sets[set] === undefined) {
          add({
            severity: "error",
            code: "PROPERTY_SET_OUT_OF_RANGE",
            path: `${path}.properties.set`,
            message: `Set ${String(set)} is not a valid propertyIndex.sets index.`,
          });
        }
        if (!Number.isInteger(row) || row < 0 || row >= scene.propertyValues.rowCount) {
          add({
            severity: "error",
            code: "PROPERTY_ROW_OUT_OF_RANGE",
            path: `${path}.properties.row`,
            message: `Row ${String(row)} is not a valid propertyValues row.`,
          });
        }
      }
      // Row arity and value finiteness live in the external column file and
      // are verified when the columns are opened (`openPropertyValueColumns`)
      // and resolved, not here.
    } else if (isIndexedPropertyBag(semantic.properties)) {
      const { set, values } = semantic.properties;
      const keySet = scene.propertyIndex?.sets[set];
      if (!scene.propertyIndex) {
        add({
          severity: "error",
          code: "MISSING_PROPERTY_INDEX",
          path: `${path}.properties.set`,
          message: "Indexed properties require a scene propertyIndex.",
        });
      } else if (!Number.isInteger(set) || keySet === undefined) {
        add({
          severity: "error",
          code: "PROPERTY_SET_OUT_OF_RANGE",
          path: `${path}.properties.set`,
          message: `Set ${String(set)} is not a valid propertyIndex.sets index.`,
        });
      } else if (keySet.length !== values.length) {
        add({
          severity: "error",
          code: "PROPERTY_VALUE_ARITY",
          path: `${path}.properties.values`,
          message:
            `Set ${String(set)} expects ${String(keySet.length)} values, ` +
            `found ${String(values.length)}.`,
        });
      }
      values.forEach((value, valueIndex) =>
        validatePropertyValue(value, `${path}.properties.values[${valueIndex}]`, add),
      );
    } else {
      Object.entries(semantic.properties.entries).forEach(([key, value]) =>
        validatePropertyValue(value, `${path}.properties.entries.${key}`, add),
      );
    }
  });

  const prototypeRepresentationPairs = new Set(
    scene.prototypes.flatMap((prototype) =>
      prototype.representationIds.map(
        (representationId) => `${prototype.id}\u0000${representationId}`,
      ),
    ),
  );
  scene.representations.forEach((representation, index) => {
    const path = `representations[${index}]`;
    requireReference(representation.prototypeId, prototypeIds, `${path}.prototypeId`);
    if (
      !prototypeRepresentationPairs.has(
        `${representation.prototypeId}\u0000${representation.id}`,
      )
    ) {
      add({
        severity: "error",
        code: "REPRESENTATION_NOT_OWNED",
        path,
        message: "Representation is not listed by its prototype.",
      });
    }
    representation.sourceMap?.sourceRefs.forEach((id, sourceIndex) =>
      requireReference(id, sourceRefIds, `${path}.sourceMap.sourceRefs[${sourceIndex}]`),
    );
    validateRepresentationGeometry(representation, path, materialIds, add);
  });

  scene.materials.forEach((material, index) =>
    requireReference(material.sourceRef, sourceRefIds, `materials[${index}].sourceRef`),
  );
  scene.diagnostics.forEach((diagnostic, index) => {
    requireReference(
      diagnostic.documentId,
      documentIds,
      `diagnostics[${index}].documentId`,
    );
    requireReference(
      diagnostic.sourceRef,
      sourceRefIds,
      `diagnostics[${index}].sourceRef`,
    );
  });

  return { ok: !issues.some(({ severity }) => severity === "error"), issues };
}
