import type { PropertyValueColumnReader } from "./property-columns.js";
import type {
  ColumnPropertyBag,
  IndexedPropertyBag,
  PropertyIndex,
  PropertyValue,
  SemanticProperties,
} from "./types.js";

/** Distinguishes an indexed bag from the inline and column property forms. */
export function isIndexedPropertyBag(
  properties: SemanticProperties,
): properties is IndexedPropertyBag {
  return "set" in properties && "values" in properties;
}

/** Distinguishes a column bag (values in `scene.propertyValues`) from the other forms. */
export function isColumnPropertyBag(
  properties: SemanticProperties,
): properties is ColumnPropertyBag {
  return "set" in properties && "row" in properties;
}

function keySet(
  propertyIndex: PropertyIndex | undefined,
  set: number,
): readonly number[] {
  if (!propertyIndex) {
    throw new TypeError("Indexed properties require a scene propertyIndex.");
  }
  const keys = propertyIndex.sets[set];
  if (keys === undefined) {
    throw new RangeError(`Unknown property set ${String(set)}.`);
  }
  return keys;
}

function joinEntries(
  propertyIndex: PropertyIndex,
  set: readonly number[],
  values: readonly PropertyValue[],
): Readonly<Record<string, PropertyValue>> {
  const entries: Record<string, PropertyValue> = {};
  set.forEach((keyIndex, position) => {
    const key = propertyIndex.keys[keyIndex];
    if (key === undefined) {
      throw new RangeError(`Unknown property key index ${String(keyIndex)}.`);
    }
    entries[key] = values[position] as PropertyValue;
  });
  return entries;
}

/**
 * Resolves any property form to concrete `key -> value` entries. Inline bags
 * return their entries unchanged; indexed bags are joined against the scene's
 * `propertyIndex`; column bags additionally read their value row from the
 * `values` reader opened over the scene's property column file. Referential
 * errors throw — run `validateScene` first when the scene is untrusted.
 */
export function resolvePropertyEntries(
  properties: SemanticProperties,
  propertyIndex: PropertyIndex | undefined,
  values?: PropertyValueColumnReader,
): Readonly<Record<string, PropertyValue>> {
  if (isColumnPropertyBag(properties)) {
    if (!values) {
      throw new TypeError("Column properties require a property value column reader.");
    }
    const set = keySet(propertyIndex, properties.set);
    if (set.length !== values.rowLength(properties.row)) {
      throw new RangeError(
        `Property set ${String(properties.set)} expects ${String(set.length)} ` +
          `values, row ${String(properties.row)} holds ` +
          `${String(values.rowLength(properties.row))}.`,
      );
    }
    return joinEntries(propertyIndex as PropertyIndex, set, values.rowValues(properties.row));
  }
  if (!isIndexedPropertyBag(properties)) return properties.entries;
  const set = keySet(propertyIndex, properties.set);
  if (set.length !== properties.values.length) {
    throw new RangeError(
      `Property set ${String(properties.set)} expects ${String(set.length)} ` +
        `values, received ${String(properties.values.length)}.`,
    );
  }
  return joinEntries(propertyIndex as PropertyIndex, set, properties.values);
}
