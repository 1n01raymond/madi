import { createHash } from "node:crypto";

import { streamJsonInto } from "./json-stream.js";

/** Receives the document's UTF-8 bytes, in order. */
export type JsonByteSink = (chunk: Uint8Array) => void;

/**
 * A compiled JSON document that is produced on demand instead of held.
 *
 * The compiler needs the document's digest and byte length for its build
 * report before the packager writes the file, and a real-large federation
 * exceeds the runtime's maximum string length, so the document cannot be the
 * string it used to be. It is a recipe: measured once, written again on
 * request, never resident.
 */
export interface StreamedJsonDocument {
  /** UTF-8 bytes of the whole document, including its trailing newline. */
  readonly bytes: number;
  readonly sha256: string;
  /** Writes the document to `sink` in bounded chunks. */
  write(sink: JsonByteSink): void;
  /**
   * The whole document as one string. Only for tests and documents already
   * known to be small: this is precisely the allocation streaming avoids, and
   * it throws for a document past the runtime's maximum string length.
   */
  text(): string;
}

/** Every compiled document ends with a newline, as the packager has always written it. */
const TRAILING_NEWLINE = "\n";

/**
 * Chunks arrive on whole tokens -- a complete escaped string, number, or
 * punctuation run -- so a surrogate pair is never split across two of them and
 * each chunk encodes to UTF-8 on its own.
 */
function writeDocument(value: unknown, indent: number, sink: JsonByteSink): void {
  streamJsonInto(value, (chunk) => sink(Buffer.from(chunk, "utf8")), { indent });
  sink(Buffer.from(TRAILING_NEWLINE, "utf8"));
}

/**
 * Serializes `value` once to learn its digest and length, and keeps the recipe
 * for writing it again.
 *
 * `observe` sees the same bytes during that first pass, which lets a caller
 * fold the document into a package digest without serializing it a third time.
 */
export function measureJsonDocument(
  value: unknown,
  indent: number,
  observe?: JsonByteSink,
): StreamedJsonDocument {
  const hash = createHash("sha256");
  let bytes = 0;
  writeDocument(value, indent, (chunk) => {
    bytes += chunk.byteLength;
    hash.update(chunk);
    observe?.(chunk);
  });
  const sha256 = hash.digest("hex");
  return {
    bytes,
    sha256,
    write: (sink) => writeDocument(value, indent, sink),
    text: () => {
      const parts: string[] = [];
      streamJsonInto(value, (chunk) => parts.push(chunk), { indent });
      parts.push(TRAILING_NEWLINE);
      return parts.join("");
    },
  };
}
