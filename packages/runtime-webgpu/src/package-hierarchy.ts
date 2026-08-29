/**
 * Reader for the compiled-package hierarchy sidecar (`naru.package-hierarchy.1`).
 *
 * A package compiled with relocated hierarchy nodes keeps only what it draws in
 * the glTF document; every occurrence that carried no mesh -- 163,665 of the
 * engineering baseline's 268,002 nodes -- moves into the columnar sidecar this
 * module reads. The encoder is `packages/compiler/src/hierarchy-sidecar.ts`;
 * the two files share a format, not a dependency, so the layout constants below
 * are deliberately restated rather than imported across the package boundary.
 *
 * The bytes are untrusted (ADR-0011): every section is checked against the file
 * it claims to sit in, and every index against the table it names, before any
 * of it is read.
 */
export const supportedPackageHierarchySchema = "naru.package-hierarchy.1";

/** `nodeIndexes` value for an entry whose node left the document. */
const relocatedNodeIndex = 0xff_ff_ff_ff;

const entryFlags = {
  visible: 1,
  semanticId: 2,
  sourceRef: 4,
  nameIsOccurrenceId: 8,
  semanticIdOmitted: 16,
  sourceRefOmitted: 32,
} as const;

const stringColumns = [
  "name",
  "occurrenceId",
  "prototypeId",
  "semanticId",
  "sourceRef",
] as const;

type StringColumn = (typeof stringColumns)[number];

export type PackageHierarchyErrorCode = "INVALID_HIERARCHY" | "UNSUPPORTED_HIERARCHY";

export class PackageHierarchyError extends Error {
  readonly code: PackageHierarchyErrorCode;

  constructor(code: PackageHierarchyErrorCode, message: string) {
    super(message);
    this.name = "PackageHierarchyError";
    this.code = code;
  }
}

/**
 * One occurrence the document no longer carries, in the shape the document
 * node would have had. `semanticId` and `sourceRef` keep all three states the
 * node could serialize: a string, an explicit `null` for an occurrence with no
 * identity, and `undefined` for a key the document omitted.
 */
export interface RelocatedHierarchyNode {
  readonly name: string;
  readonly occurrenceId: string;
  readonly prototypeId: string;
  readonly semanticId?: string | null;
  readonly sourceRef?: string | null;
  readonly initialVisibility: boolean;
  readonly tags: readonly string[];
  /** The node's own transform, relative to its parent, in metres. */
  readonly localTransform: Float64Array;
}

/** One occurrence in the order the un-relocated document would have traversed. */
export interface PackageHierarchyEntry {
  readonly depth: number;
  /** Document node index, or `undefined` when `relocated` carries the node. */
  readonly nodeIndex?: number;
  readonly relocated?: RelocatedHierarchyNode;
}

export interface DecodedPackageHierarchy {
  readonly schemaVersion: typeof supportedPackageHierarchySchema;
  readonly sceneId: string;
  readonly revisionId: string;
  readonly sourceDigest: string;
  /** `nodes.length` of the document this sidecar was compiled with. */
  readonly documentNodeCount: number;
  readonly relocatedCount: number;
  readonly entries: readonly PackageHierarchyEntry[];
}

export interface DecodePackageHierarchyOptions {
  /** Ceiling on `entryCount`; every entry was a document node before relocation. */
  readonly maxEntries: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new PackageHierarchyError("INVALID_HIERARCHY", message);
}

/** Ceiling for a count the header bounds only against the delivered bytes. */
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

function countAt(value: unknown, label: string, ceiling: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > ceiling) {
    invalid(`${label} must be an integer between 0 and ${ceiling}.`);
  }
  return value as number;
}

function textAt(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return value;
}

interface Section {
  readonly byteOffset: number;
  readonly byteLength: number;
}

/**
 * Reads one declared section and holds it to the bytes actually delivered.
 *
 * `expectedLength` comes from a count the header already declared, so a
 * mismatch means the header disagrees with itself -- the cheapest place to
 * catch a truncated or rewritten sidecar. A string heap passes `undefined`,
 * because its length is whatever its own offset table accounts for.
 */
function sectionAt(
  sections: unknown,
  key: string,
  expectedLength: number | undefined,
  alignment: number,
  available: number,
): Section {
  if (!isRecord(sections)) invalid("sections must be an object.");
  const section = sections[key];
  if (!isRecord(section)) invalid(`sections.${key} must be an object.`);
  const byteOffset = countAt(section.byteOffset, `sections.${key}.byteOffset`, available);
  const byteLength = countAt(section.byteLength, `sections.${key}.byteLength`, available);
  if (expectedLength !== undefined && byteLength !== expectedLength) {
    invalid(`sections.${key} must hold ${expectedLength} bytes; it declares ${byteLength}.`);
  }
  if (byteOffset + byteLength > available) {
    invalid(`sections.${key} runs past the end of the hierarchy columns.`);
  }
  if (byteOffset % alignment !== 0) {
    invalid(`sections.${key} must start on a ${alignment}-byte boundary.`);
  }
  return { byteOffset, byteLength };
}

/**
 * Reads one string column as a prefix-offset table over its own heap. The
 * offsets are the only bound on where a value starts and ends, so they are
 * checked for monotonicity and against the heap before any text is decoded.
 */
function readStringColumn(
  bytes: Uint8Array,
  offsets: Section,
  heap: Section,
  count: number,
  decoder: TextDecoder,
  column: StringColumn,
): readonly string[] {
  const table = new Uint32Array(bytes.buffer, bytes.byteOffset + offsets.byteOffset, count + 1);
  const values: string[] = [];
  let previous = 0;
  for (let index = 0; index < count; index += 1) {
    const start = table[index] as number;
    const end = table[index + 1] as number;
    if (start !== previous || end < start || end > heap.byteLength) {
      invalid(`The ${column} column declares an offset outside its heap.`);
    }
    previous = end;
    values.push(
      decoder.decode(bytes.subarray(heap.byteOffset + start, heap.byteOffset + end)),
    );
  }
  if (previous !== heap.byteLength) {
    invalid(`The ${column} column does not cover its heap.`);
  }
  return values;
}

function readTagSets(value: unknown): readonly (readonly string[])[] {
  if (!Array.isArray(value)) invalid("tagSets must be an array.");
  return value.map((tags, index) => {
    if (!Array.isArray(tags)) invalid(`tagSets[${index}] must be an array.`);
    return tags.map((tag, at) => textAt(tag, `tagSets[${index}][${at}]`));
  });
}

/**
 * Rebuilds one identity field from its flag pair: a present string, an omitted
 * key the reader resolves the way it resolves an absent key on a document node,
 * or an explicit `null` for an occurrence that carries no identity at all.
 */
function identityOf(
  flag: number,
  presentBit: number,
  omittedBit: number,
  value: string,
  key: "semanticId" | "sourceRef",
): Record<string, string | null> {
  if ((flag & presentBit) !== 0) return { [key]: value };
  return (flag & omittedBit) !== 0 ? {} : { [key]: null };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalid("The hierarchy sidecar is not valid JSON.");
  }
}

/**
 * Decodes a hierarchy sidecar into the traversal order the document would have
 * had. Nothing here consults the glTF document: the caller matches retained
 * node indexes against it, so a sidecar naming a node the document does not
 * have is refused there rather than silently dropped here.
 */
export function decodePackageHierarchy(
  json: unknown,
  columns: ArrayBuffer | Uint8Array,
  options: DecodePackageHierarchyOptions,
): DecodedPackageHierarchy {
  const parsed = typeof json === "string" ? parseJson(json) : json;
  if (!isRecord(parsed)) invalid("The hierarchy sidecar must be a JSON object.");
  if (parsed.schemaVersion !== supportedPackageHierarchySchema) {
    throw new PackageHierarchyError(
      "UNSUPPORTED_HIERARCHY",
      `Expected ${supportedPackageHierarchySchema}; received ${JSON.stringify(parsed.schemaVersion)}.`,
    );
  }
  const supplied = columns instanceof Uint8Array ? columns : new Uint8Array(columns);
  // Fixed-width sections are read as typed-array views, which need the
  // underlying buffer -- not just the section -- to be aligned. A caller may
  // hand over a slice of a larger transfer, so an odd base is copied once here
  // instead of being reported as if the package were malformed.
  const bytes = supplied.byteOffset % 8 === 0 ? supplied : new Uint8Array(supplied);
  const declared = isRecord(parsed.columns)
    ? parsed.columns
    : invalid("columns must be an object.");
  if (countAt(declared.byteLength, "columns.byteLength", MAX_COUNT) !== bytes.byteLength) {
    invalid("The hierarchy columns are not the length the sidecar declares.");
  }

  const entryCount = countAt(parsed.entryCount, "entryCount", options.maxEntries);
  const relocatedCount = countAt(parsed.relocatedCount, "relocatedCount", entryCount);
  const transformCount = countAt(parsed.transformCount, "transformCount", relocatedCount);
  const documentNodeCount = countAt(parsed.documentNodeCount, "documentNodeCount", MAX_COUNT);
  const tagSets = readTagSets(parsed.tagSets);
  const available = bytes.byteLength;
  const declaredSections = isRecord(parsed.sections)
    ? parsed.sections
    : invalid("sections must be an object.");
  const at = (key: string, expected: number, alignment: number): Section =>
    sectionAt(declaredSections, key, expected, alignment, available);
  const sections = {
    nodeIndexes: at("nodeIndexes", entryCount * 4, 4),
    depths: at("depths", entryCount * 4, 4),
    flags: at("flags", relocatedCount, 1),
    tagSets: at("tagSets", relocatedCount * 4, 4),
    transforms: at("transforms", relocatedCount * 4, 4),
    transformMatrices: at("transformMatrices", transformCount * 128, 8),
  };
  const stringOffsets = {} as Record<StringColumn, Section>;
  const stringHeaps = {} as Record<StringColumn, Section>;
  for (const column of stringColumns) {
    stringOffsets[column] = sectionAt(
      declaredSections.strings,
      column,
      (relocatedCount + 1) * 4,
      4,
      available,
    );
    stringHeaps[column] = sectionAt(
      declaredSections.stringHeaps,
      column,
      undefined,
      1,
      available,
    );
  }

  const decoder = new TextDecoder();
  const text = {} as Record<StringColumn, readonly string[]>;
  for (const column of stringColumns) {
    text[column] = readStringColumn(
      bytes,
      stringOffsets[column],
      stringHeaps[column],
      relocatedCount,
      decoder,
      column,
    );
  }

  const base = bytes.byteOffset;
  const nodeIndexes = new Uint32Array(bytes.buffer, base + sections.nodeIndexes.byteOffset, entryCount);
  const depths = new Uint32Array(bytes.buffer, base + sections.depths.byteOffset, entryCount);
  const flags = bytes.subarray(
    sections.flags.byteOffset,
    sections.flags.byteOffset + relocatedCount,
  );
  const tagSetIndexes = new Uint32Array(bytes.buffer, base + sections.tagSets.byteOffset, relocatedCount);
  const transformIndexes = new Uint32Array(bytes.buffer, base + sections.transforms.byteOffset, relocatedCount);
  const matrices = new Float64Array(
    bytes.buffer,
    base + sections.transformMatrices.byteOffset,
    transformCount * 16,
  );

  const entries: PackageHierarchyEntry[] = [];
  let relocatedAt = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const depth = depths[index] as number;
    const nodeIndex = nodeIndexes[index] as number;
    if (nodeIndex !== relocatedNodeIndex) {
      if (nodeIndex >= documentNodeCount) {
        invalid("A retained entry names a node outside the document it declares.");
      }
      entries.push({ depth, nodeIndex });
      continue;
    }
    if (relocatedAt >= relocatedCount) {
      invalid("The node column marks more relocated entries than the sidecar declares.");
    }
    const flag = flags[relocatedAt] as number;
    const tags = tagSets[tagSetIndexes[relocatedAt] as number];
    if (!tags) invalid("A relocated entry names a tag set the sidecar does not carry.");
    const transformIndex = transformIndexes[relocatedAt] as number;
    if (transformIndex >= transformCount) {
      invalid("A relocated entry names a transform the sidecar does not carry.");
    }
    const occurrenceId = text.occurrenceId[relocatedAt] as string;
    entries.push({
      depth,
      relocated: {
        name: (flag & entryFlags.nameIsOccurrenceId) === 0
          ? (text.name[relocatedAt] as string)
          : occurrenceId,
        occurrenceId,
        prototypeId: text.prototypeId[relocatedAt] as string,
        ...identityOf(
          flag,
          entryFlags.semanticId,
          entryFlags.semanticIdOmitted,
          text.semanticId[relocatedAt] as string,
          "semanticId",
        ),
        ...identityOf(
          flag,
          entryFlags.sourceRef,
          entryFlags.sourceRefOmitted,
          text.sourceRef[relocatedAt] as string,
          "sourceRef",
        ),
        initialVisibility: (flag & entryFlags.visible) !== 0,
        tags,
        localTransform: matrices.slice(transformIndex * 16, transformIndex * 16 + 16),
      },
    });
    relocatedAt += 1;
  }
  if (relocatedAt !== relocatedCount) {
    invalid("The sidecar declares more relocated entries than its node column marks.");
  }

  return {
    schemaVersion: supportedPackageHierarchySchema,
    sceneId: textAt(parsed.sceneId, "sceneId"),
    revisionId: textAt(parsed.revisionId, "revisionId"),
    sourceDigest: textAt(parsed.sourceDigest, "sourceDigest"),
    documentNodeCount,
    relocatedCount,
    entries,
  };
}
