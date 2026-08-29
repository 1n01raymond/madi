import { createHash } from "node:crypto";

/**
 * The compiled-package hierarchy sidecar (`naru.package-hierarchy.1`).
 *
 * A federation spends most of its compiled document on nodes that draw
 * nothing: the engineering baseline carries 163,665 mesh-less occurrence
 * nodes worth 88,741,293 B, 21.88% of its 405,570,167 B document
 * (`artifacts/compiler/node-field-elision`). Those nodes exist to give the
 * assembly tree its shape and to compose transforms; neither job needs them
 * to sit in the glTF node graph, so this sidecar carries them next to the
 * package and the document keeps only what the renderer draws.
 *
 * The encoding is columnar and binary because the payload is exactly the kind
 * of data JSON serializes worst: hundreds of thousands of short strings under
 * repeated keys. Strings are the only variable-width members; everything else
 * is a fixed-width column whose bounds the reader checks against the file.
 */
export const packageHierarchySchema = "naru.package-hierarchy.1";

/** Sentinel `nodeIndexes` value for an entry with no node in the document. */
export const relocatedNodeIndex = 0xff_ff_ff_ff;

/** Bit positions in the per-relocated-entry flags column. */
export const hierarchyEntryFlags = {
  /** The occurrence's `initialVisibility`. */
  visible: 1,
  /** A `semanticId` string is present rather than derived or absent. */
  semanticId: 2,
  /** A `sourceRef` string is present rather than derived or absent. */
  sourceRef: 4,
  /** The node name equalled the occurrence id; the name column holds "". */
  nameIsOccurrenceId: 8,
  /**
   * The document node would have omitted `semanticId`: either the package's
   * derivation rule reconstructs it, or nothing declares one. A reader resolves
   * it exactly as it resolves an absent key on a retained node. Distinct from
   * an explicit `null`, which sets no bit and means "this occurrence has none".
   */
  semanticIdOmitted: 16,
  /** As above, for `sourceRef`. */
  sourceRefOmitted: 32,
} as const;

/** String columns, in the order they occupy the binary. */
export const hierarchyStringColumns = [
  "name",
  "occurrenceId",
  "prototypeId",
  "semanticId",
  "sourceRef",
] as const;

export type HierarchyStringColumn = (typeof hierarchyStringColumns)[number];

export interface HierarchySection {
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface PackageHierarchyDocument {
  readonly schemaVersion: typeof packageHierarchySchema;
  readonly status: "experimental-not-interchange";
  readonly sceneId: string;
  readonly revisionId: string;
  readonly sourceDigest: string;
  /** Every occurrence, relocated or not, in the document's traversal order. */
  readonly entryCount: number;
  /** Entries whose node left the document. */
  readonly relocatedCount: number;
  /** `nodes.length` of the document this sidecar belongs to. */
  readonly documentNodeCount: number;
  /** Distinct tag sets, referenced by index from the `tagSets` column. */
  readonly tagSets: readonly (readonly string[])[];
  /** Distinct local transforms, referenced by index from `transforms`. */
  readonly transformCount: number;
  readonly sections: {
    readonly nodeIndexes: HierarchySection;
    readonly depths: HierarchySection;
    readonly flags: HierarchySection;
    readonly tagSets: HierarchySection;
    readonly transforms: HierarchySection;
    readonly transformMatrices: HierarchySection;
    readonly strings: Readonly<Record<HierarchyStringColumn, HierarchySection>>;
    readonly stringHeaps: Readonly<Record<HierarchyStringColumn, HierarchySection>>;
  };
  readonly columns: {
    readonly uri: string;
    readonly byteLength: number;
    readonly sha256: string;
  };
}

/** One occurrence as the compiler hands it to the encoder. */
export interface HierarchySidecarEntry {
  /** Document node index, or `undefined` when the node is relocated. */
  readonly nodeIndex?: number;
  /** Occurrence nesting depth, matching the runtime's traversal depth. */
  readonly depth: number;
  /** Present only for a relocated entry. */
  readonly relocated?: {
    readonly name: string;
    readonly occurrenceId: string;
    readonly prototypeId: string;
    /**
     * The value the document node would have carried: a string, an explicit
     * `null` for an occurrence that genuinely has none, and `undefined` for an
     * omitted key. Relocation must not decide between them for a reader, so
     * all three states survive.
     */
    readonly semanticId?: string | null;
    readonly sourceRef?: string | null;
    readonly initialVisibility: boolean;
    readonly tags: readonly string[];
    /** The local transform the relocated node carried in the document. */
    readonly localTransform: readonly number[];
  };
}

export interface HierarchySidecar {
  readonly json: string;
  readonly jsonBytes: Uint8Array;
  readonly jsonDigest: string;
  readonly binary: Uint8Array;
  readonly binaryDigest: string;
  readonly document: PackageHierarchyDocument;
}

/** Section starts stay eight-byte aligned so the f64 matrix table is a view. */
const sectionAlignment = 8;

function alignUp(value: number): number {
  const remainder = value % sectionAlignment;
  return remainder === 0 ? value : value + (sectionAlignment - remainder);
}

class SectionWriter {
  private readonly parts: { readonly at: number; readonly bytes: Uint8Array }[] = [];
  private cursor = 0;

  /** Reserves an aligned run and returns the section that describes it. */
  claim(byteLength: number): HierarchySection {
    const byteOffset = alignUp(this.cursor);
    this.cursor = byteOffset + byteLength;
    return { byteOffset, byteLength };
  }

  put(section: HierarchySection, bytes: Uint8Array): void {
    if (bytes.byteLength !== section.byteLength) {
      throw new RangeError("Hierarchy sidecar section length does not match its payload.");
    }
    this.parts.push({ at: section.byteOffset, bytes });
  }

  finish(): Uint8Array {
    const buffer = new Uint8Array(alignUp(this.cursor));
    for (const { at, bytes } of this.parts) buffer.set(bytes, at);
    return buffer;
  }
}

const encoder = new TextEncoder();

interface EncodedStrings {
  readonly offsets: Uint32Array;
  readonly heap: Uint8Array;
}

/**
 * Packs one column as a prefix-offset array over a shared heap. The offsets
 * array holds `count + 1` entries so a reader recovers every length without
 * a separate width column, and an empty string is a zero-length run rather
 * than a sentinel.
 */
function encodeStrings(values: readonly string[]): EncodedStrings {
  const parts = values.map((value) => encoder.encode(value));
  const offsets = new Uint32Array(values.length + 1);
  let total = 0;
  for (const [index, part] of parts.entries()) {
    offsets[index] = total;
    total += part.byteLength;
  }
  offsets[values.length] = total;
  const heap = new Uint8Array(total);
  for (const [index, part] of parts.entries()) heap.set(part, offsets[index]);
  return { offsets, heap };
}

function bytesOf(view: Uint32Array | Float64Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Interns values by a caller-supplied key, preserving first-seen order. */
class Interner<T> {
  private readonly indexes = new Map<string, number>();
  readonly values: T[] = [];

  intern(key: string, value: T): number {
    const existing = this.indexes.get(key);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.indexes.set(key, index);
    this.values.push(value);
    return index;
  }
}

/**
 * Encodes which of the three identity states a relocated field carried: an
 * explicit string, an omitted key, or an explicit `null`.
 */
function identityFlags(
  value: string | null | undefined,
  presentBit: number,
  omittedBit: number,
): number {
  if (typeof value === "string") return presentBit;
  return value === undefined ? omittedBit : 0;
}

/** Distinguishes -0 from 0 so an interned transform is exact, not merely equal. */
function transformKey(values: readonly number[]): string {
  return values.map((value) => (Object.is(value, -0) ? "-0" : String(value))).join(",");
}

export interface BuildHierarchySidecarInput {
  readonly sceneId: string;
  readonly revisionId: string;
  readonly sourceDigest: string;
  readonly documentNodeCount: number;
  readonly columnsUri: string;
  readonly entries: readonly HierarchySidecarEntry[];
}

/**
 * Encodes the occurrence tree of a package whose mesh-less nodes were
 * relocated out of the document.
 *
 * Entries arrive in the order the runtime's traversal would have produced, so
 * a reader replays them without sorting: relocated entries are rebuilt from
 * the columns below, and the rest are read from the document node the
 * `nodeIndexes` column names.
 */
export function buildHierarchySidecar(
  input: BuildHierarchySidecarInput,
): HierarchySidecar {
  const { entries } = input;
  const nodeIndexes = new Uint32Array(entries.length);
  const depths = new Uint32Array(entries.length);
  const relocated = entries.filter(
    (entry): entry is HierarchySidecarEntry & { relocated: NonNullable<HierarchySidecarEntry["relocated"]> } =>
      entry.relocated !== undefined,
  );
  const flags = new Uint8Array(relocated.length);
  const tagSetIndexes = new Uint32Array(relocated.length);
  const transformIndexes = new Uint32Array(relocated.length);
  const tagSets = new Interner<readonly string[]>();
  const transforms = new Interner<readonly number[]>();
  const columnValues: Record<HierarchyStringColumn, string[]> = {
    name: [],
    occurrenceId: [],
    prototypeId: [],
    semanticId: [],
    sourceRef: [],
  };

  for (const [index, entry] of entries.entries()) {
    if (entry.depth < 0 || !Number.isSafeInteger(entry.depth)) {
      throw new RangeError("Hierarchy sidecar entries need a non-negative integer depth.");
    }
    nodeIndexes[index] = entry.relocated ? relocatedNodeIndex : (entry.nodeIndex as number);
    depths[index] = entry.depth;
    if (!entry.relocated && entry.nodeIndex === undefined) {
      throw new TypeError("A retained hierarchy entry must name its document node.");
    }
    if (!entry.relocated && entry.nodeIndex === relocatedNodeIndex) {
      throw new RangeError("A document node index collides with the relocation sentinel.");
    }
  }

  for (const [index, entry] of relocated.entries()) {
    const { relocated: payload } = entry;
    if (payload.localTransform.length !== 16) {
      throw new RangeError("A relocated hierarchy entry needs a sixteen-element transform.");
    }
    const nameIsOccurrenceId = payload.name === payload.occurrenceId;
    flags[index] =
      (payload.initialVisibility ? hierarchyEntryFlags.visible : 0) |
      identityFlags(
        payload.semanticId,
        hierarchyEntryFlags.semanticId,
        hierarchyEntryFlags.semanticIdOmitted,
      ) |
      identityFlags(
        payload.sourceRef,
        hierarchyEntryFlags.sourceRef,
        hierarchyEntryFlags.sourceRefOmitted,
      ) |
      (nameIsOccurrenceId ? hierarchyEntryFlags.nameIsOccurrenceId : 0);
    tagSetIndexes[index] = tagSets.intern(JSON.stringify(payload.tags), [...payload.tags]);
    transformIndexes[index] = transforms.intern(
      transformKey(payload.localTransform),
      payload.localTransform,
    );
    columnValues.name.push(nameIsOccurrenceId ? "" : payload.name);
    columnValues.occurrenceId.push(payload.occurrenceId);
    columnValues.prototypeId.push(payload.prototypeId);
    columnValues.semanticId.push(payload.semanticId ?? "");
    columnValues.sourceRef.push(payload.sourceRef ?? "");
  }

  const matrices = new Float64Array(transforms.values.length * 16);
  for (const [index, matrix] of transforms.values.entries()) {
    matrices.set(matrix, index * 16);
  }
  const encodedColumns = Object.fromEntries(
    hierarchyStringColumns.map((column) => [column, encodeStrings(columnValues[column])]),
  ) as Record<HierarchyStringColumn, EncodedStrings>;

  const writer = new SectionWriter();
  const sections = {
    nodeIndexes: writer.claim(nodeIndexes.byteLength),
    depths: writer.claim(depths.byteLength),
    flags: writer.claim(flags.byteLength),
    tagSets: writer.claim(tagSetIndexes.byteLength),
    transforms: writer.claim(transformIndexes.byteLength),
    transformMatrices: writer.claim(matrices.byteLength),
    strings: Object.fromEntries(
      hierarchyStringColumns.map((column) => [
        column,
        writer.claim(encodedColumns[column].offsets.byteLength),
      ]),
    ) as Record<HierarchyStringColumn, HierarchySection>,
    stringHeaps: {} as Record<HierarchyStringColumn, HierarchySection>,
  };
  sections.stringHeaps = Object.fromEntries(
    hierarchyStringColumns.map((column) => [
      column,
      writer.claim(encodedColumns[column].heap.byteLength),
    ]),
  ) as Record<HierarchyStringColumn, HierarchySection>;

  writer.put(sections.nodeIndexes, bytesOf(nodeIndexes));
  writer.put(sections.depths, bytesOf(depths));
  writer.put(sections.flags, flags);
  writer.put(sections.tagSets, bytesOf(tagSetIndexes));
  writer.put(sections.transforms, bytesOf(transformIndexes));
  writer.put(sections.transformMatrices, bytesOf(matrices));
  for (const column of hierarchyStringColumns) {
    writer.put(sections.strings[column], bytesOf(encodedColumns[column].offsets));
    writer.put(sections.stringHeaps[column], encodedColumns[column].heap);
  }
  const binary = writer.finish();

  const document: PackageHierarchyDocument = {
    schemaVersion: packageHierarchySchema,
    status: "experimental-not-interchange",
    sceneId: input.sceneId,
    revisionId: input.revisionId,
    sourceDigest: input.sourceDigest,
    entryCount: entries.length,
    relocatedCount: relocated.length,
    documentNodeCount: input.documentNodeCount,
    tagSets: tagSets.values,
    transformCount: transforms.values.length,
    sections,
    columns: {
      uri: input.columnsUri,
      byteLength: binary.byteLength,
      sha256: createHash("sha256").update(binary).digest("hex"),
    },
  };
  // Compact on purpose, for the same reason the property sidecar is: the tag
  // table is the only variable part and a federation's document is already
  // the size this whole sidecar exists to cut.
  const json = `${JSON.stringify(document)}\n`;
  const jsonBytes = encoder.encode(json);
  return {
    json,
    jsonBytes,
    jsonDigest: createHash("sha256").update(jsonBytes).digest("hex"),
    binary,
    binaryDigest: document.columns.sha256,
    document,
  };
}
