/**
 * The two sides of the relocation comparison. `baseline` must be today's
 * default output, so the record measures a change against what ships.
 */
export const HIERARCHY_RELOCATION_VARIANTS = {
  baseline: {},
  relocated: { relocateHierarchyNodes: true },
};
