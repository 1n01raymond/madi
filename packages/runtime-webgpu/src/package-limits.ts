/**
 * Structural ceilings applied to an untrusted compiled package (ADR-0011).
 *
 * A compiled package never declares its own limits: a limit that travels with
 * the document is a limit its author chooses. These are loader policy, and an
 * embedding application may raise or lower them.
 */
export interface CompiledPackageLimits {
  /** `nodes.length`; sixty5, the largest recorded package, declares 188,320. */
  readonly nodes: number;
  /** `meshes.length`; sixty5 declares 84,870. */
  readonly meshes: number;
  /** `accessors.length`; sixty5 declares 343,886. */
  readonly accessors: number;
  /** `bufferViews.length`; sixty5 declares 343,886. */
  readonly bufferViews: number;
  /** `extras.madi.progressive.targetChunks.length`; sixty5 declares 234. */
  readonly targetChunks: number;
  /**
   * Deepest chain of glTF nodes the active scene may contain. Digital Hub, the
   * deepest recorded package, nests 7; PyGamer nests 4.
   */
  readonly traversalDepth: number;
}

/** Defaults justified against measured packages in ADR-0011. */
export const defaultCompiledPackageLimits: CompiledPackageLimits = {
  nodes: 2_000_000,
  meshes: 1_000_000,
  accessors: 4_000_000,
  bufferViews: 4_000_000,
  targetChunks: 65_536,
  traversalDepth: 64,
};

export type CompiledPackageLimitOverrides = Partial<CompiledPackageLimits>;

export interface CompiledPackageOptions {
  /** Raises or lowers individual ceilings; omitted keys keep their default. */
  readonly limits?: CompiledPackageLimitOverrides;
}

/**
 * Merges overrides over the defaults, rejecting values that could not bound
 * anything: a ceiling must be a positive safe integer so that comparisons and
 * the sums built on them stay exact.
 */
export function resolveCompiledPackageLimits(
  overrides?: CompiledPackageLimitOverrides,
): CompiledPackageLimits {
  const resolved = { ...defaultCompiledPackageLimits, ...overrides };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`The ${key} limit must be a positive safe integer.`);
    }
  }
  return resolved;
}
