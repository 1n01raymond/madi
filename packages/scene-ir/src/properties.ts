import type {
  IndexedPropertyBag,
  PropertyIndex,
  PropertyValue,
  SemanticProperties,
} from "./types.js";

/** Distinguishes an indexed bag from an inline `PropertyBag`. */
export function isIndexedPropertyBag(
  properties: SemanticProperties,
): properties is IndexedPropertyBag {
  return "set" in properties;
}

/**
 * Resolves either property form to concrete `key -> value` entries. Inline
 * bags return their entries unchanged; indexed bags are joined against the
 * scene's `propertyIndex`. Referential errors throw — run `validateScene`
 * first when the scene is untrusted.
 */
export function resolvePropertyEntries(
  properties: SemanticProperties,
  propertyIndex: PropertyIndex | undefined,
): Readonly<Record<string, PropertyValue>> {
  if (!isIndexedPropertyBag(properties)) return properties.entries;
  if (!propertyIndex) {
    throw new TypeError("Indexed properties require a scene propertyIndex.");
  }
  const set = propertyIndex.sets[properties.set];
  if (set === undefined) {
    throw new RangeError(`Unknown property set ${String(properties.set)}.`);
  }
  if (set.length !== properties.values.length) {
    throw new RangeError(
      `Property set ${String(properties.set)} expects ${String(set.length)} ` +
        `values, received ${String(properties.values.length)}.`,
    );
  }
  const entries: Record<string, PropertyValue> = {};
  set.forEach((keyIndex, position) => {
    const key = propertyIndex.keys[keyIndex];
    if (key === undefined) {
      throw new RangeError(`Unknown property key index ${String(keyIndex)}.`);
    }
    entries[key] = properties.values[position] as PropertyValue;
  });
  return entries;
}
