import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Streaming reader for the IFC Scene IR structure document.
 *
 * The split transport (`madi.ifc-scene-ir-split.*`) keeps geometry — and
 * since split.3 the property values — out of the structure JSON, but a
 * real-large federation's structure document can still
 * exceed the runtime's maximum string length (sixty5 is 631,943,761 B against
 * a 536,870,888 code-unit ceiling — `packages/compiler/src/ifc-federation.ts`
 * used to report this as a hard boundary). This reader never holds the whole
 * document as one string or Buffer: it walks the file in 32 MB chunks with a
 * byte-level state machine (depth, in-string, escape) that recognises
 * top-level keys and, for every top-level array, the record boundaries one
 * level inside it. Each record is parsed individually with `JSON.parse` on a
 * bounded slice (sixty5's largest record is 18,883,997 B), so only one record
 * is ever buffered whole, not the section or the document.
 *
 * The result is exactly what `JSON.parse(document)` would have produced: the
 * same object graph, with duplicate top-level keys resolved the same way
 * (last write wins). No top-level key list is hardcoded, so the reader does
 * not need to change when the structure schema gains or removes a member —
 * only array-valued members stream section by section; every other member is
 * buffered whole and parsed in one call, the same way `JSON.parse` would.
 */

export interface IfcStructureRead {
  /** The parsed document, identical to what `JSON.parse` would return. */
  readonly value: unknown;
  readonly byteLength: number;
  readonly sha256: string;
}

const DEFAULT_CHUNK_BYTES = 32 * 1024 * 1024;

const OPEN_BRACE = 0x7b; // {
const CLOSE_BRACE = 0x7d; // }
const OPEN_BRACKET = 0x5b; // [
const CLOSE_BRACKET = 0x5d; // ]
const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \
const COLON = 0x3a; // :
const COMMA = 0x2c; // ,

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function isValueDelimiter(byte: number): boolean {
  return (
    byte === COMMA ||
    byte === CLOSE_BRACE ||
    byte === CLOSE_BRACKET ||
    byte === COLON ||
    isWhitespace(byte)
  );
}

/**
 * A resumable cursor over an async byte stream. Bytes are only retained
 * between the most recent `markStart()` and the current position, so memory
 * is bounded by the largest single JSON value being scanned (one record),
 * not the file. Hashes every byte as it is pulled, in file order.
 */
class ByteCursor {
  private carry: Buffer = Buffer.alloc(0);
  private pos = 0;
  private markIndex = 0;
  private totalBytes = 0;
  private ended = false;
  private readonly hash = createHash("sha256");
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return false;
    const { value, done } = await this.iterator.next();
    if (done || value === undefined) {
      this.ended = true;
      return false;
    }
    this.hash.update(value);
    this.totalBytes += value.byteLength;
    const kept = this.carry.subarray(this.markIndex);
    this.carry = kept.byteLength === 0 ? value : Buffer.concat([kept, value]);
    this.pos -= this.markIndex;
    this.markIndex = 0;
    return true;
  }

  private async ensureByte(): Promise<boolean> {
    while (this.pos >= this.carry.byteLength) {
      if (!(await this.fill())) return false;
    }
    return true;
  }

  async peek(): Promise<number | null> {
    return (await this.ensureByte()) ? this.carry[this.pos]! : null;
  }

  async next(): Promise<number> {
    if (!(await this.ensureByte())) {
      throw new Error(
        `Unexpected end of the IFC Scene IR structure document at byte ${String(this.bytesRead)}.`,
      );
    }
    return this.carry[this.pos++]!;
  }

  /** Marks the current position as the start of the value being scanned. */
  markStart(): void {
    this.markIndex = this.pos;
  }

  /** Bytes from the last `markStart()` up to (not including) the current position. */
  sliceFromMark(): Buffer {
    return this.carry.subarray(this.markIndex, this.pos);
  }

  /** Absolute byte offset into the file at the current position. */
  get bytesRead(): number {
    return this.totalBytes - (this.carry.byteLength - this.pos);
  }

  digest(): string {
    return this.hash.digest("hex");
  }
}

async function skipWhitespace(cursor: ByteCursor): Promise<void> {
  for (;;) {
    const byte = await cursor.peek();
    if (byte === null || !isWhitespace(byte)) return;
    await cursor.next();
  }
}

async function expectByte(cursor: ByteCursor, expected: number, context: string): Promise<void> {
  const byte = await cursor.next();
  if (byte !== expected) {
    throw new Error(
      `Malformed IFC Scene IR structure document: expected '${String.fromCharCode(expected)}' ${context}, ` +
        `found byte 0x${byte.toString(16)} at offset ${String(cursor.bytesRead - 1)}.`,
    );
  }
}

/** Scans a JSON string value (the cursor must be positioned at the opening quote). */
async function scanString(cursor: ByteCursor): Promise<void> {
  await cursor.next(); // opening quote
  for (;;) {
    const byte = await cursor.next();
    if (byte === BACKSLASH) {
      await cursor.next(); // consume the escaped byte unconditionally
      continue;
    }
    if (byte === QUOTE) return;
  }
}

/** Scans a JSON object or array value (the cursor must be positioned at `{` or `[`). */
async function scanBracketed(cursor: ByteCursor): Promise<void> {
  let depth = 0;
  for (;;) {
    const byte = await cursor.next();
    if (byte === QUOTE) {
      for (;;) {
        const inner = await cursor.next();
        if (inner === BACKSLASH) {
          await cursor.next();
          continue;
        }
        if (inner === QUOTE) break;
      }
      continue;
    }
    if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
      depth += 1;
      continue;
    }
    if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
      depth -= 1;
      if (depth === 0) return;
    }
  }
}

/** Scans a bare literal (number, `true`, `false`, `null`) up to its delimiter. */
async function scanLiteral(cursor: ByteCursor): Promise<void> {
  await cursor.next(); // the byte already peeked by the caller
  for (;;) {
    const byte = await cursor.peek();
    if (byte === null || isValueDelimiter(byte)) return;
    await cursor.next();
  }
}

/** Scans exactly one JSON value at the cursor and returns its raw bytes. */
async function scanValue(cursor: ByteCursor, context: string): Promise<Buffer> {
  const first = await cursor.peek();
  if (first === null) {
    throw new Error(`Unexpected end of document while reading ${context}.`);
  }
  cursor.markStart();
  if (first === QUOTE) {
    await scanString(cursor);
  } else if (first === OPEN_BRACE || first === OPEN_BRACKET) {
    await scanBracketed(cursor);
  } else {
    await scanLiteral(cursor);
  }
  return cursor.sliceFromMark();
}

function parseValue(bytes: Buffer, describe: () => string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`${describe()}: ${(error as Error).message}`, { cause: error });
  }
}

/** Reads a top-level array section record by record, never buffering the whole array. */
async function readArraySection(cursor: ByteCursor, section: string): Promise<unknown[]> {
  await expectByte(cursor, OPEN_BRACKET, `at the start of "${section}"`);
  const records: unknown[] = [];
  await skipWhitespace(cursor);
  if ((await cursor.peek()) === CLOSE_BRACKET) {
    await cursor.next();
    return records;
  }
  for (;;) {
    const recordBytes = await scanValue(cursor, `${section}[${String(records.length)}]`);
    const index = records.length;
    records.push(
      parseValue(
        recordBytes,
        () => `Malformed record ${section}[${String(index)}] near byte ${String(cursor.bytesRead)}`,
      ),
    );
    await skipWhitespace(cursor);
    const separator = await cursor.next();
    if (separator === CLOSE_BRACKET) return records;
    if (separator !== COMMA) {
      throw new Error(
        `Expected ',' or ']' in "${section}" after record ${String(records.length - 1)}, ` +
          `found byte 0x${separator.toString(16)} at offset ${String(cursor.bytesRead - 1)}.`,
      );
    }
    await skipWhitespace(cursor);
  }
}

/**
 * Parses an IFC Scene IR structure document from any chunked async byte
 * source without ever holding it as one string or Buffer. The returned
 * `value` is identical to what `JSON.parse` would produce on the
 * concatenation of every chunk. Exported (in addition to `readIfcStructure`)
 * so tests can feed arbitrary chunk boundaries — including ones a real
 * `highWaterMark` could never land on exactly — without writing a fixture
 * file per boundary.
 */
export async function parseIfcStructureStream(
  source: AsyncIterable<Buffer>,
): Promise<IfcStructureRead> {
  const cursor = new ByteCursor(source);

  await skipWhitespace(cursor);
  await expectByte(cursor, OPEN_BRACE, "at the start of the document");

  const result: Record<string, unknown> = {};
  let firstMember = true;

  for (;;) {
    await skipWhitespace(cursor);
    const byte = await cursor.peek();
    if (byte === null) {
      throw new Error("Unexpected end of document inside the top-level object.");
    }
    if (byte === CLOSE_BRACE) {
      await cursor.next();
      break;
    }
    if (!firstMember) {
      await expectByte(cursor, COMMA, "between top-level members");
      await skipWhitespace(cursor);
    }
    firstMember = false;

    const keyBytes = await scanValue(cursor, "a top-level key");
    const key = parseValue(
      keyBytes,
      () => `Malformed top-level key near byte ${String(cursor.bytesRead)}`,
    );
    if (typeof key !== "string") {
      throw new Error(`Top-level key near byte ${String(cursor.bytesRead)} is not a string.`);
    }

    await skipWhitespace(cursor);
    await expectByte(cursor, COLON, `after key "${key}"`);
    await skipWhitespace(cursor);

    if ((await cursor.peek()) === OPEN_BRACKET) {
      result[key] = await readArraySection(cursor, key);
    } else {
      const valueBytes = await scanValue(cursor, `the value of "${key}"`);
      result[key] = parseValue(valueBytes, () => `Malformed value for "${key}"`);
    }
  }

  await skipWhitespace(cursor);
  const trailing = await cursor.peek();
  if (trailing !== null) {
    throw new Error(
      `Trailing bytes after the IFC Scene IR structure document at offset ${String(cursor.bytesRead)}.`,
    );
  }

  return {
    value: result,
    byteLength: cursor.bytesRead,
    sha256: cursor.digest(),
  };
}

/**
 * Reads an IFC Scene IR structure document straight off disk in 32 MB
 * chunks, without ever holding it as one string or Buffer. The returned
 * `value` is identical to what `JSON.parse(await readFile(path, "utf8"))`
 * would produce.
 */
export async function readIfcStructure(
  path: string,
  options: { readonly highWaterMark?: number } = {},
): Promise<IfcStructureRead> {
  const stream = createReadStream(path, {
    highWaterMark: options.highWaterMark ?? DEFAULT_CHUNK_BYTES,
  });
  try {
    return await parseIfcStructureStream(stream);
  } finally {
    // A parse error leaves the stream open; destroy releases the descriptor
    // (harmless when the stream already ended).
    stream.destroy();
  }
}
