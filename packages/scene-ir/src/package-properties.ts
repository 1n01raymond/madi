import type {
  PropertyIndex,
  PropertyValueColumns,
  SemanticId,
} from "./types.js";

/**
 * Compiled-package property sidecar (`madi.package-properties.1`).
 *
 * A compiled glTF package can carry semantic property values as two optional
 * sidecar resources next to `scene.gltf`: a JSON document (this shape) holding
 * the scene's property key/key-set index and one column reference per
 * semantic entity, and a binary column file that is a byte-verbatim copy of
 * the adapter's `madi.property-columns.1` output. Neither resource is on the
 * render path: a viewer fetches them lazily and resolves one semantic's
 * entries at a time with `openPropertyValueColumns` and
 * `resolvePropertyEntries`.
 *
 * The semantic table is columnar to keep the document small at real-large
 * scale: `semanticIds[i]` references row `semanticRows[i]` of the column file
 * with key set `semanticSets[i]`, and `semanticSchemas[i]` indexes `schemas`
 * (or is null for a bag without a schema label). Ids are sorted by UTF-16
 * code units and unique, so the document is deterministic for a deterministic
 * scene.
 */

export const packagePropertiesSchema = "madi.package-properties.1";

export interface PackagePropertyColumnsRef {
  readonly uri: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface PackagePropertiesDocument {
  readonly schemaVersion: typeof packagePropertiesSchema;
  readonly status: "experimental-not-interchange";
  readonly sceneId: string;
  readonly revisionId: string;
  readonly sourceDigest: string;
  readonly propertyIndex: PropertyIndex;
  readonly schemas: readonly string[];
  readonly semanticIds: readonly SemanticId[];
  readonly semanticSchemas: readonly (number | null)[];
  readonly semanticSets: readonly number[];
  readonly semanticRows: readonly number[];
  readonly columns: PackagePropertyColumnsRef;
  readonly propertyValues: PropertyValueColumns;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIndexArray(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => Number.isSafeInteger(entry) && entry >= 0)
  );
}

function isNullableIndexArray(value: unknown): value is readonly (number | null)[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => entry === null || (Number.isSafeInteger(entry) && entry >= 0))
  );
}

function isPropertyIndex(value: unknown): value is PropertyIndex {
  return (
    isRecord(value) &&
    isStringArray(value.keys) &&
    Array.isArray(value.sets) &&
    value.sets.every((set) => isIndexArray(set))
  );
}

function isColumnsRef(value: unknown): value is PackagePropertyColumnsRef {
  return (
    isRecord(value) &&
    typeof value.uri === "string" &&
    value.uri.length > 0 &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) >= 0 &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(value.sha256)
  );
}

function isStreamRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.encoding === "u32le" || value.encoding === "utf8-json") &&
    Number.isSafeInteger(value.byteOffset) &&
    (value.byteOffset as number) >= 0 &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) >= 0
  );
}

function isPropertyValueColumns(value: unknown): value is PropertyValueColumns {
  return (
    isRecord(value) &&
    value.encoding === "madi.property-columns.1" &&
    Number.isSafeInteger(value.valueCount) &&
    Number.isSafeInteger(value.rowCount) &&
    Number.isSafeInteger(value.distinctValueCount) &&
    isStreamRef(value.rows) &&
    isStreamRef(value.rowOffsets) &&
    isStreamRef(value.valueOffsets) &&
    isStreamRef(value.valueHeap)
  );
}

/**
 * Parses and structurally verifies a package property sidecar document.
 * Referential checks cover the columnar semantic table (equal lengths, ids
 * sorted and unique, set/schema indexes in range) but not the column file
 * itself — open it with `openPropertyValueColumns` to verify its offsets.
 */
export function parsePackageProperties(value: unknown): PackagePropertiesDocument {
  if (!isRecord(value)) {
    throw new TypeError("Package properties must be an object.");
  }
  if (value.schemaVersion !== packagePropertiesSchema) {
    throw new TypeError("Package properties use an unsupported schema version.");
  }
  if (value.status !== "experimental-not-interchange") {
    throw new TypeError("Package properties are missing their experimental status.");
  }
  for (const name of ["sceneId", "revisionId", "sourceDigest"] as const) {
    if (typeof value[name] !== "string" || value[name].length === 0) {
      throw new TypeError(`Package properties are missing ${name}.`);
    }
  }
  if (!isPropertyIndex(value.propertyIndex)) {
    throw new TypeError("Package properties are missing their property index.");
  }
  if (!isStringArray(value.schemas)) {
    throw new TypeError("Package properties are missing their schema table.");
  }
  if (
    !isStringArray(value.semanticIds) ||
    !isNullableIndexArray(value.semanticSchemas) ||
    !isIndexArray(value.semanticSets) ||
    !isIndexArray(value.semanticRows)
  ) {
    throw new TypeError("Package properties are missing their semantic columns.");
  }
  const count = value.semanticIds.length;
  if (
    value.semanticSchemas.length !== count ||
    value.semanticSets.length !== count ||
    value.semanticRows.length !== count
  ) {
    throw new TypeError("Package property semantic columns must have equal lengths.");
  }
  for (let index = 1; index < count; index += 1) {
    if ((value.semanticIds[index - 1] as string) >= (value.semanticIds[index] as string)) {
      throw new TypeError("Package property semantic ids must be sorted and unique.");
    }
  }
  if (!isColumnsRef(value.columns)) {
    throw new TypeError("Package properties are missing their column file reference.");
  }
  if (!isPropertyValueColumns(value.propertyValues)) {
    throw new TypeError("Package properties are missing their column header.");
  }
  const setCount = value.propertyIndex.sets.length;
  const schemaCount = value.schemas.length;
  const rowCount = value.propertyValues.rowCount;
  for (let index = 0; index < count; index += 1) {
    if ((value.semanticSets[index] as number) >= setCount) {
      throw new RangeError("Package property semantic references an unknown key set.");
    }
    if ((value.semanticRows[index] as number) >= rowCount) {
      throw new RangeError("Package property semantic references an unknown column row.");
    }
    const schema = value.semanticSchemas[index];
    if (schema !== null && (schema as number) >= schemaCount) {
      throw new RangeError("Package property semantic references an unknown schema.");
    }
  }
  return value as unknown as PackagePropertiesDocument;
}
