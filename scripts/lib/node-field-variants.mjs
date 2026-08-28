/**
 * The compiler option sets compared by the node-field elision record.
 *
 * `baseline` is deliberately empty: it must reproduce today's default output
 * byte for byte, so a delta measured against it can only come from the lever
 * named by the variant.
 */
export const NODE_FIELD_VARIANTS = {
  baseline: {},
  identifiers: { elideDerivedIdentifiers: true },
  transforms: { omitDefaultNodeTransforms: true },
  both: { elideDerivedIdentifiers: true, omitDefaultNodeTransforms: true },
};

/** Options every variant shares; they match `compile-engineering-baseline.mjs`. */
export const NODE_FIELD_COMPILE_OPTIONS = {
  coarseBounds: true,
  generator: "MADI compiler 0.0.0 / IfcOpenShell federation slice",
  targetChunkByteBudget: 512 * 1024,
  spatialIndex: true,
  spatialPayloadOrder: true,
  compactJson: true,
  omitResourceNames: true,
};
