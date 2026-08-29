import type { PrototypeId, Representation } from "@naru3d/scene-ir";

import {
  buildCompiledPayload,
  compiledPayloadContentDigest,
} from "./compiled-payload.js";
import type { CompiledPayload, CompiledPayloadSource } from "./compiled-payload.js";
import {
  compiledPayloadEntrySchema,
  CompiledPayloadStoreError,
  createCompiledPayloadKey,
  publishCompiledPayloadSync,
  restoreCompiledPayloadSync,
} from "./compiled-payload-store.js";
import type { CompiledPayloadKeyInput } from "./compiled-payload-store.js";
import type { CacheOptionValue, CacheToolInput } from "./cache-primitives.js";
import type { CompileGltfOptions } from "./types.js";

/**
 * Compile options that cannot change a payload's bytes, each with the reason it
 * is excluded from the key.
 *
 * The list is exhaustive on purpose. An option missing from it is treated as
 * payload-affecting and enters the key, so adding one and forgetting to
 * classify it costs a rebuild rather than serving a payload that was compiled
 * under different rules.
 */
export const layoutAffectingCompileOptions: Readonly<Record<string, string>> = {
  binaryUri: "names the geometry buffer the payload is placed into",
  coarseBounds: "derives the coarse representation from prototype bounds, not from payload bytes",
  coarseBinaryUri: "names the coarse buffer",
  generator: "document metadata",
  compactJson: "document whitespace",
  omitResourceNames:
    "applied at placement in GltfBinaryBuilder.append, so it changes the document and never the payload",
  elideDerivedIdentifiers: "node fields",
  omitDefaultNodeTransforms: "node fields",
  targetChunkByteBudget: "chunk membership, which is placement",
  spatialPayloadOrder: "payload order within the buffer, which is placement",
  spatialIndex: "an occurrence sidecar derived after placement",
  spatialBinaryUri: "names the spatial sidecar",
  spatialLeafCapacity: "spatial sidecar shape",
  propertyColumns: "a property sidecar carried byte-verbatim",
  propertiesUri: "names the property sidecar",
  propertiesBinaryUri: "names the property column file",
  relocateHierarchyNodes: "moves nodes between the document and a sidecar",
  hierarchyUri: "names the hierarchy sidecar",
  hierarchyBinaryUri: "names the hierarchy column file",
  payloadSource: "the source being keyed; not an input to the payload it returns",
};

/**
 * The option half of a payload key.
 *
 * Today it is empty for every supported option -- the encode/place split put
 * every layout decision after `buildCompiledPayload` -- but the rule, not the
 * emptiness, is what keeps it correct as options are added.
 */
export function payloadKeyOptions(
  options: CompileGltfOptions,
): Readonly<Record<string, CacheOptionValue>> {
  const keyed: Record<string, CacheOptionValue> = {};
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || name in layoutAffectingCompileOptions) continue;
    const described = JSON.stringify(value);
    if (described === undefined) {
      throw new TypeError(
        `Compile option ${name} is not classified and cannot be described in a payload key.`,
      );
    }
    keyed[`unclassified:${name}`] = described;
  }
  return keyed;
}

export type CompiledPayloadCacheOutcome = "hit" | "absent" | "corrupt-entry" | "restore-failed";

/** An outcome a healthy store never produces on a prototype it holds. */
export type CompiledPayloadCacheDegradation =
  | Exclude<CompiledPayloadCacheOutcome, "hit" | "absent">
  | "publish-failed";

/**
 * What the store did, by prototype. Ids are the only identifier reported: a
 * source path or a property value would put engineering data in a build report.
 */
export interface CompiledPayloadCacheReport {
  readonly store: typeof compiledPayloadEntrySchema;
  readonly prototypes: number;
  readonly hits: number;
  readonly misses: number;
  readonly published: number;
  readonly outcomes: Readonly<Record<CompiledPayloadCacheOutcome, number>>;
  readonly publishFailures: number;
  /**
   * Prototype ids behind a degraded outcome, capped so a federation-sized model
   * cannot turn a report into a log. `absent` is excluded because on a cold
   * store that is every prototype, and the counts above already say so.
   */
  readonly degraded: readonly {
    readonly prototypeId: string;
    readonly outcome: CompiledPayloadCacheDegradation;
  }[];
}

/** How many degraded prototypes a report names before it stops listing them. */
const degradedReportLimit = 16;

export interface CompiledPayloadCacheOptions {
  readonly storeDirectory: string;
  readonly compiler: CacheToolInput;
  /** Adapter identity, composed exactly as the package cache composes it. */
  readonly adapter: CacheToolInput;
  readonly compileOptions: CompileGltfOptions;
  readonly warn?: (message: string) => void;
}

/**
 * Decides, per prototype, whether to restore a payload or build one.
 *
 * A stored entry that fails any check is a miss, not a failure: the payload is
 * rebuilt and the compile completes, the same fail-open-to-work contract the
 * package cache follows. Publishing is best effort for the same reason -- a
 * read-only or full store must not turn a successful compile into an error.
 */
export class CompiledPayloadCache implements CompiledPayloadSource {
  readonly #storeDirectory: string;
  readonly #compiler: CacheToolInput;
  readonly #adapter: CacheToolInput;
  readonly #options: Readonly<Record<string, CacheOptionValue>>;
  readonly #warn: (message: string) => void;
  readonly #outcomes: Record<CompiledPayloadCacheOutcome, number> = {
    hit: 0,
    absent: 0,
    "corrupt-entry": 0,
    "restore-failed": 0,
  };
  readonly #degraded: {
    readonly prototypeId: string;
    readonly outcome: CompiledPayloadCacheDegradation;
  }[] = [];
  #published = 0;
  #publishFailures = 0;

  constructor(options: CompiledPayloadCacheOptions) {
    this.#storeDirectory = options.storeDirectory;
    this.#compiler = options.compiler;
    this.#adapter = options.adapter;
    this.#options = payloadKeyOptions(options.compileOptions);
    this.#warn = options.warn ?? ((message) => console.warn(message));
  }

  payloadFor(
    prototypeId: PrototypeId,
    representation: Representation,
    scaleToMeters: number,
  ): CompiledPayload {
    const input: CompiledPayloadKeyInput = {
      compiler: this.#compiler,
      adapter: this.#adapter,
      content: compiledPayloadContentDigest(representation),
      scaleToMeters,
      options: this.#options,
    };
    const restored = this.#restore(prototypeId, createCompiledPayloadKey(input));
    if (restored) return restored;
    const payload = buildCompiledPayload(representation, scaleToMeters);
    this.#publish(prototypeId, input, payload);
    return payload;
  }

  report(): CompiledPayloadCacheReport {
    const outcomes = { ...this.#outcomes };
    const hits = outcomes.hit;
    return {
      store: compiledPayloadEntrySchema,
      prototypes: Object.values(outcomes).reduce((sum, count) => sum + count, 0),
      hits,
      misses: outcomes.absent + outcomes["corrupt-entry"] + outcomes["restore-failed"],
      published: this.#published,
      outcomes,
      publishFailures: this.#publishFailures,
      degraded: [...this.#degraded],
    };
  }

  #record(prototypeId: string, outcome: CompiledPayloadCacheDegradation): void {
    if (this.#degraded.length < degradedReportLimit) {
      this.#degraded.push({ prototypeId, outcome });
    }
  }

  #restore(prototypeId: string, key: string): CompiledPayload | undefined {
    try {
      const payload = restoreCompiledPayloadSync({ storeDirectory: this.#storeDirectory, key });
      this.#outcomes[payload ? "hit" : "absent"] += 1;
      return payload;
    } catch (error) {
      const outcome = error instanceof CompiledPayloadStoreError
        ? "corrupt-entry"
        : "restore-failed";
      this.#outcomes[outcome] += 1;
      this.#record(prototypeId, outcome);
      this.#warn(
        `[naru] payload cache restore failed for ${prototypeId} (${describe(error)}); rebuilding.`,
      );
      return undefined;
    }
  }

  #publish(
    prototypeId: string,
    input: CompiledPayloadKeyInput,
    payload: CompiledPayload,
  ): void {
    try {
      publishCompiledPayloadSync({ storeDirectory: this.#storeDirectory, input, payload });
      this.#published += 1;
    } catch (error) {
      this.#publishFailures += 1;
      this.#record(prototypeId, "publish-failed");
      this.#warn(
        `[naru] payload cache publish failed for ${prototypeId} (${describe(error)}); compiled output kept without an entry.`,
      );
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
