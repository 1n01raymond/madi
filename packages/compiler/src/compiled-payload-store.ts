import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ids } from "@naru3d/scene-ir";

import {
  canonicalJson,
  digestBytes,
  errorCode,
  idempotentPublishCodes,
  identifyFile,
  identifyFileSync,
  normalizeCacheOptions,
  requireSha256,
  requireTool,
} from "./cache-primitives.js";
import type { CacheOptionValue, CacheToolInput } from "./cache-primitives.js";
import type {
  CompiledPayload,
  CompiledPayloadAccessor,
  CompiledPayloadShape,
} from "./compiled-payload.js";
import type { GltfAccessor, GltfBufferView } from "./types.js";

export const compiledPayloadEntrySchema = "naru.compiled-payload-entry.1" as const;

const binaryResourcePath = "payload.bin";
const manifestResourcePath = "payload.json";

/**
 * What a payload is addressed by. `content` is the representation's own content
 * digest; everything else is what could change the bytes without the
 * representation changing. Placement inputs -- byte offsets, chunk membership,
 * material and node indices -- are absent by construction, which is what lets
 * one entry serve every package that contains the prototype.
 */
export interface CompiledPayloadKeyInput {
  readonly compiler: CacheToolInput;
  readonly adapter: CacheToolInput;
  readonly content: string;
  readonly scaleToMeters: number;
  readonly options: Readonly<Record<string, CacheOptionValue>>;
}

/** One accessor's metadata plus its slice of `payload.bin`. */
export interface CompiledPayloadEntryAccessor {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly componentType: GltfAccessor["componentType"];
  readonly count: number;
  readonly type: GltfAccessor["type"];
  readonly target?: GltfBufferView["target"];
  readonly name?: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

export interface CompiledPayloadEntry {
  readonly schemaVersion: typeof compiledPayloadEntrySchema;
  readonly key: string;
  readonly input: CompiledPayloadKeyInput;
  readonly accessors: readonly CompiledPayloadEntryAccessor[];
  readonly shape: CompiledPayloadShape;
  readonly triangles: number;
  readonly edges: number;
  readonly binary: { readonly path: string; readonly bytes: number; readonly sha256: string };
}

export class CompiledPayloadStoreError extends Error {
  readonly code: "AMBIGUOUS_PAYLOAD" | "INVALID_PAYLOAD_ENTRY";

  constructor(code: CompiledPayloadStoreError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CompiledPayloadStoreError";
    this.code = code;
  }
}

function invalid(message: string, cause?: unknown): CompiledPayloadStoreError {
  return new CompiledPayloadStoreError(
    "INVALID_PAYLOAD_ENTRY",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function normalizeInput(input: CompiledPayloadKeyInput): CompiledPayloadKeyInput {
  if (!Number.isFinite(input.scaleToMeters) || input.scaleToMeters <= 0) {
    throw new TypeError("Compiled payload scale must be a positive finite number.");
  }
  return {
    compiler: requireTool(input.compiler, "Payload compiler"),
    adapter: requireTool(input.adapter, "Payload adapter"),
    content: requireSha256(input.content, "Payload content digest"),
    scaleToMeters: input.scaleToMeters,
    options: normalizeCacheOptions(input.options),
  };
}

export function createCompiledPayloadKey(input: CompiledPayloadKeyInput): string {
  const normalized = normalizeInput(input);
  return createHash("sha256")
    .update(JSON.stringify({ schemaVersion: compiledPayloadEntrySchema, input: normalized }))
    .digest("hex");
}

/**
 * Entries live under a directory named for the schema, so a schema bump opens a
 * cold namespace beside the old one instead of migrating entries in place.
 */
function namespaceDirectory(storeDirectory: string): string {
  return resolve(storeDirectory, compiledPayloadEntrySchema);
}

function entryDirectory(storeDirectory: string, key: string): string {
  requireSha256(key, "Compiled payload key");
  return resolve(namespaceDirectory(storeDirectory), key);
}

const componentBytes = new Map<number, number>([[5121, 1], [5125, 4], [5126, 4]]);
const typeComponents = new Map<string, number>([["SCALAR", 1], ["VEC3", 3]]);

function requireCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requireBounds(value: unknown, label: string): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid(`${label} must be a non-empty array.`);
  }
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw invalid(`${label} must hold finite numbers.`);
    }
  }
  return value as readonly number[];
}

/**
 * Reads one accessor's metadata back. The declared byte length is recomputed
 * from the component type, the element type, and the count, so a manifest can
 * never make the reader carve a slice the accessor does not describe.
 */
function parseAccessor(
  value: unknown,
  index: number,
  expectedOffset: number,
): CompiledPayloadEntryAccessor {
  if (typeof value !== "object" || value === null) {
    throw invalid(`Payload accessor ${index} must be an object.`);
  }
  const declared = value as Partial<CompiledPayloadEntryAccessor>;
  const componentSize = componentBytes.get(declared.componentType as number);
  const components = typeComponents.get(declared.type as string);
  if (componentSize === undefined || components === undefined) {
    throw invalid(`Payload accessor ${index} declares an unsupported element type.`);
  }
  const count = requireCount(declared.count, `Payload accessor ${index} count`);
  const byteLength = requireCount(declared.byteLength, `Payload accessor ${index} byte length`);
  if (byteLength !== count * components * componentSize) {
    throw invalid(`Payload accessor ${index} byte length does not match its element count.`);
  }
  if (declared.byteOffset !== expectedOffset) {
    throw invalid(`Payload accessor ${index} is not contiguous with the accessor before it.`);
  }
  if (declared.target !== undefined && declared.target !== 34962 && declared.target !== 34963) {
    throw invalid(`Payload accessor ${index} declares an unsupported buffer target.`);
  }
  if (declared.name !== undefined && typeof declared.name !== "string") {
    throw invalid(`Payload accessor ${index} name must be a string.`);
  }
  const min = requireBounds(declared.min, `Payload accessor ${index} min`);
  const max = requireBounds(declared.max, `Payload accessor ${index} max`);
  return {
    byteOffset: expectedOffset,
    byteLength,
    componentType: declared.componentType as GltfAccessor["componentType"],
    count,
    type: declared.type as GltfAccessor["type"],
    ...(declared.target === undefined ? {} : { target: declared.target }),
    ...(declared.name === undefined ? {} : { name: declared.name }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

function requireRole(value: unknown, accessorCount: number, label: string): number | undefined {
  if (value === undefined) return undefined;
  const role = requireCount(value, label);
  if (role >= accessorCount) throw invalid(`${label} points past the payload.`);
  return role;
}

function parseShape(value: unknown, accessorCount: number): CompiledPayloadShape {
  if (typeof value !== "object" || value === null) {
    throw invalid("Payload shape must be an object.");
  }
  const declared = value as Partial<CompiledPayloadShape>;
  const groups: unknown = declared.surfaceGroups;
  if (!Array.isArray(groups)) throw invalid("Payload shape requires surface groups.");
  const surfaceGroups = (groups as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw invalid(`Payload surface group ${index} must be an object.`);
    }
    const group = entry as { readonly [key: string]: unknown };
    const accessor = requireRole(group.accessor, accessorCount, `Payload surface group ${index}`);
    if (accessor === undefined) throw invalid(`Payload surface group ${index} has no accessor.`);
    if (group.materialId !== undefined && typeof group.materialId !== "string") {
      throw invalid(`Payload surface group ${index} material must be a string.`);
    }
    return {
      accessor,
      ...(group.materialId === undefined ? {} : { materialId: ids.material(group.materialId) }),
      firstIndex: requireCount(group.firstIndex, `Payload surface group ${index} first index`),
      indexCount: requireCount(group.indexCount, `Payload surface group ${index} index count`),
    };
  });
  const role = (key: keyof CompiledPayloadShape): number | undefined =>
    requireRole(declared[key], accessorCount, `Payload ${String(key)} accessor`);
  // Roles are rebuilt in the order `buildCompiledPayload` writes them, so
  // republishing an entry serializes the manifest it read back byte for byte.
  const named = (...keys: readonly (keyof CompiledPayloadShape)[]): Record<string, number> =>
    Object.fromEntries(
      keys.map((key) => [key, role(key)] as const).filter(([, at]) => at !== undefined),
    ) as Record<string, number>;
  return {
    ...named("position", "normal", "faceSource"),
    surfaceGroups,
    ...named("edgePosition", "edgeIndex", "edgeClass", "edgeSource"),
  };
}

function parseEntry(serialized: string, expectedKey: string): CompiledPayloadEntry {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw invalid("Compiled payload manifest is not valid JSON.", error);
  }
  if (typeof value !== "object" || value === null) {
    throw invalid("Compiled payload manifest must be an object.");
  }
  const entry = value as Partial<CompiledPayloadEntry>;
  if (entry.schemaVersion !== compiledPayloadEntrySchema || entry.key !== expectedKey) {
    throw invalid("Compiled payload manifest identity changed.");
  }
  // The key is recomputed rather than trusted: a manifest that does not
  // reproduce the name it is filed under is a miss, not a payload.
  if (entry.input === undefined || createCompiledPayloadKey(entry.input) !== expectedKey) {
    throw invalid("Compiled payload input does not reproduce its key.");
  }
  const declaredAccessors: unknown = entry.accessors;
  if (!Array.isArray(declaredAccessors)) {
    throw invalid("Compiled payload manifest requires accessors.");
  }
  let offset = 0;
  const accessors = (declaredAccessors as readonly unknown[]).map((declared, index) => {
    const accessor = parseAccessor(declared, index, offset);
    offset += accessor.byteLength;
    return accessor;
  });
  const binary = entry.binary;
  if (typeof binary !== "object" || binary === null || binary.path !== binaryResourcePath) {
    throw invalid(`Compiled payload manifest must describe ${binaryResourcePath}.`);
  }
  if (binary.bytes !== offset) {
    throw invalid("Compiled payload accessors do not cover the payload binary exactly.");
  }
  requireSha256(binary.sha256, "Compiled payload binary digest");
  return {
    schemaVersion: compiledPayloadEntrySchema,
    key: expectedKey,
    input: normalizeInput(entry.input),
    accessors,
    shape: parseShape(entry.shape, accessors.length),
    triangles: requireCount(entry.triangles, "Compiled payload triangle count"),
    edges: requireCount(entry.edges, "Compiled payload edge count"),
    binary: { path: binaryResourcePath, bytes: binary.bytes, sha256: binary.sha256 },
  };
}

export async function readCompiledPayloadEntry(
  storeDirectory: string,
  key: string,
): Promise<CompiledPayloadEntry | undefined> {
  const directory = entryDirectory(storeDirectory, key);
  try {
    return parseEntry(await readFile(join(directory, manifestResourcePath), "utf8"), key);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export function readCompiledPayloadEntrySync(
  storeDirectory: string,
  key: string,
): CompiledPayloadEntry | undefined {
  const directory = entryDirectory(storeDirectory, key);
  try {
    return parseEntry(readFileSync(join(directory, manifestResourcePath), "utf8"), key);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function describeEntry(
  key: string,
  input: CompiledPayloadKeyInput,
  payload: CompiledPayload,
  binary: { readonly bytes: number; readonly sha256: string },
): CompiledPayloadEntry {
  let byteOffset = 0;
  const accessors = payload.accessors.map(({ bytes, ...meta }) => {
    const accessor: CompiledPayloadEntryAccessor = { byteOffset, byteLength: bytes.byteLength, ...meta };
    byteOffset += bytes.byteLength;
    return accessor;
  });
  return {
    schemaVersion: compiledPayloadEntrySchema,
    key,
    input,
    accessors,
    shape: payload.shape,
    triangles: payload.triangles,
    edges: payload.edges,
    binary: { path: binaryResourcePath, ...binary },
  };
}

function concatenatePayload(payload: CompiledPayload): Uint8Array {
  const total = payload.accessors.reduce((sum, { bytes }) => sum + bytes.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const { bytes } of payload.accessors) {
    joined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return joined;
}

export interface PublishCompiledPayloadOptions {
  readonly storeDirectory: string;
  readonly input: CompiledPayloadKeyInput;
  readonly payload: CompiledPayload;
}

interface Publication {
  readonly storeDirectory: string;
  readonly namespace: string;
  readonly directory: string;
  readonly key: string;
  readonly entry: CompiledPayloadEntry;
  readonly joined: Uint8Array;
  readonly manifest: string;
}

/**
 * Everything a publish decides before it touches the filesystem, so the
 * asynchronous and synchronous publishes below file byte-identical entries and
 * only their I/O differs.
 */
function preparePublication(options: PublishCompiledPayloadOptions): Publication {
  const input = normalizeInput(options.input);
  const key = createCompiledPayloadKey(input);
  const joined = concatenatePayload(options.payload);
  const entry = describeEntry(key, input, options.payload, {
    bytes: joined.byteLength,
    sha256: digestBytes(joined),
  });
  const storeDirectory = resolve(options.storeDirectory);
  return {
    storeDirectory,
    namespace: namespaceDirectory(storeDirectory),
    directory: entryDirectory(storeDirectory, key),
    key,
    entry,
    joined,
    manifest: `${JSON.stringify(entry, null, 2)}\n`,
  };
}

/**
 * Settles a lost publish race. The entry already in place is read back and
 * compared, and only a genuine disagreement -- the same key describing
 * different bytes -- is refused, because that would mean the key is missing an
 * input.
 */
function reconcilePublished(
  published: CompiledPayloadEntry | undefined,
  publication: Publication,
  cause: unknown,
): CompiledPayloadEntry {
  if (!published) throw cause;
  if (canonicalJson(published) !== canonicalJson(publication.entry)) {
    throw new CompiledPayloadStoreError(
      "AMBIGUOUS_PAYLOAD",
      `Compiled payload key ${publication.key} already describes different bytes; the key is missing an input.`,
      { cause },
    );
  }
  return published;
}

/**
 * Publishes a payload under its content key.
 *
 * The entry is staged in a sibling directory and renamed into place, so a
 * concurrent compilation either sees no entry or a complete one.
 */
export async function publishCompiledPayload(
  options: PublishCompiledPayloadOptions,
): Promise<CompiledPayloadEntry> {
  const publication = preparePublication(options);
  await mkdir(publication.namespace, { recursive: true });
  const staging = await mkdtemp(join(publication.namespace, ".publish-"));
  try {
    await writeFile(join(staging, binaryResourcePath), publication.joined);
    await writeFile(join(staging, manifestResourcePath), publication.manifest, "utf8");
    try {
      await rename(staging, publication.directory);
    } catch (error) {
      if (!idempotentPublishCodes.has(errorCode(error) ?? "")) throw error;
      const published = await readCompiledPayloadEntry(publication.storeDirectory, publication.key);
      if (published) await verifyBinary(publication.directory, published);
      return reconcilePublished(published, publication, error);
    }
    return publication.entry;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * The same publish, synchronously, for the packaging loop: see
 * `restoreCompiledPayloadSync` for why that loop cannot await.
 */
export function publishCompiledPayloadSync(
  options: PublishCompiledPayloadOptions,
): CompiledPayloadEntry {
  const publication = preparePublication(options);
  mkdirSync(publication.namespace, { recursive: true });
  const staging = mkdtempSync(join(publication.namespace, ".publish-"));
  try {
    writeFileSync(join(staging, binaryResourcePath), publication.joined);
    writeFileSync(join(staging, manifestResourcePath), publication.manifest, "utf8");
    try {
      renameSync(staging, publication.directory);
    } catch (error) {
      if (!idempotentPublishCodes.has(errorCode(error) ?? "")) throw error;
      const published = readCompiledPayloadEntrySync(publication.storeDirectory, publication.key);
      if (published) verifyBinarySync(publication.directory, published);
      return reconcilePublished(published, publication, error);
    }
    return publication.entry;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function requireVerified(
  entry: CompiledPayloadEntry,
  identity: { readonly bytes: number; readonly sha256: string },
): void {
  if (identity.bytes !== entry.binary.bytes || identity.sha256 !== entry.binary.sha256) {
    throw invalid("Compiled payload binary failed integrity verification.");
  }
}

async function verifyBinary(directory: string, entry: CompiledPayloadEntry): Promise<Uint8Array> {
  const path = join(directory, entry.binary.path);
  const identity = await identifyFile(path);
  requireVerified(entry, identity);
  return new Uint8Array(await readFile(path));
}

function verifyBinarySync(directory: string, entry: CompiledPayloadEntry): Uint8Array {
  const identity = identifyFileSync(join(directory, entry.binary.path));
  requireVerified(entry, { bytes: identity.bytes.byteLength, sha256: identity.sha256 });
  return identity.bytes;
}

/** Carves the verified binary into the accessors the manifest describes. */
function hydratePayload(entry: CompiledPayloadEntry, joined: Uint8Array): CompiledPayload {
  const accessors: CompiledPayloadAccessor[] = entry.accessors.map(
    ({ byteOffset, byteLength, ...meta }) => ({
      bytes: joined.subarray(byteOffset, byteOffset + byteLength),
      ...meta,
    }),
  );
  return {
    accessors,
    shape: entry.shape,
    triangles: entry.triangles,
    edges: entry.edges,
  };
}

export interface RestoreCompiledPayloadOptions {
  readonly storeDirectory: string;
  readonly key: string;
}

/**
 * Reads a payload back, or resolves to `undefined` when no entry is filed under
 * the key. A stored entry that fails any check throws: the caller decides
 * whether to warn and rebuild, exactly as the package cache does.
 */
export async function restoreCompiledPayload(
  options: RestoreCompiledPayloadOptions,
): Promise<CompiledPayload | undefined> {
  const storeDirectory = resolve(options.storeDirectory);
  const entry = await readCompiledPayloadEntry(storeDirectory, options.key);
  if (!entry) return undefined;
  return hydratePayload(entry, await verifyBinary(entryDirectory(storeDirectory, options.key), entry));
}

/**
 * The same restore, synchronously.
 *
 * `compileSceneToGltf` is synchronous and its geometry loop places one payload
 * at a time; restoring inside that loop keeps exactly one payload live, where
 * an asynchronous pre-pass would have to hold every payload of the model at
 * once. On the largest recorded federation that difference is the whole
 * geometry buffer, so the store reads through this path.
 */
export function restoreCompiledPayloadSync(
  options: RestoreCompiledPayloadOptions,
): CompiledPayload | undefined {
  const storeDirectory = resolve(options.storeDirectory);
  const entry = readCompiledPayloadEntrySync(storeDirectory, options.key);
  if (!entry) return undefined;
  return hydratePayload(entry, verifyBinarySync(entryDirectory(storeDirectory, options.key), entry));
}
