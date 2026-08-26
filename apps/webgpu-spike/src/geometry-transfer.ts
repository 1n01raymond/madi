import type { CompiledHierarchy, DecodedCompiledScene } from "@naru3d/runtime-webgpu";

/**
 * A decoded scene as it crosses the Worker boundary. The compiled hierarchy is
 * document-scoped and identical for every decode of one scene session, so
 * per-chunk responses omit it instead of structured-cloning it again (the
 * sixty5 hierarchy serializes to ~71 MB and dominated per-admission latency).
 */
export type GeometryTransitScene = Omit<DecodedCompiledScene, "hierarchy"> &
  Partial<Pick<DecodedCompiledScene, "hierarchy">>;

/** Prepares a scene for postMessage, omitting the hierarchy for chunk decodes. */
export function transitSceneForResponse(
  scene: DecodedCompiledScene,
  omitHierarchy: boolean,
): GeometryTransitScene {
  if (!omitHierarchy) return scene;
  const { hierarchy: _hierarchy, ...chunkScene } = scene;
  return chunkScene;
}

/**
 * Restores a full scene from a transit scene, caching the hierarchy from any
 * response that carries one. Throws when a chunk response arrives before a
 * hierarchy-bearing response has been seen.
 */
export function adoptTransitScene(
  transit: GeometryTransitScene,
  cachedHierarchy: CompiledHierarchy | undefined,
): { readonly scene: DecodedCompiledScene; readonly hierarchy: CompiledHierarchy } {
  if (transit.hierarchy) {
    return { scene: transit as DecodedCompiledScene, hierarchy: transit.hierarchy };
  }
  if (!cachedHierarchy) {
    throw new Error(
      "The geometry Worker omitted the scene hierarchy before it was cached.",
    );
  }
  return { scene: { ...transit, hierarchy: cachedHierarchy }, hierarchy: cachedHierarchy };
}
