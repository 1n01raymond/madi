/**
 * Serializes a JSON document as bounded chunks instead of one string.
 *
 * `JSON.stringify` has to materialize its whole result, so a document larger
 * than V8's maximum string length cannot be produced at all: the sixty5
 * federation throws `RangeError: Invalid string length` after the compiler has
 * already done every expensive part of the work. Streaming removes that wall
 * and the several-hundred-megabyte copies the single string cost.
 *
 * The output is defined to be exactly what `JSON.stringify(value, null,
 * indent)` would have produced, so every committed digest keeps its meaning.
 * Three rules keep that promise cheap to verify: strings are handed to
 * `JSON.stringify` itself rather than escaped here, numbers are formatted by
 * `String`, which is the same specification operation the serializer applies,
 * and object keys are taken from `Object.keys`, which enumerates in the order
 * the specification gives `JSON.stringify` (integer-like keys ascending, then
 * insertion order).
 */

/** Receives each chunk in order. Chunks concatenate to the whole document. */
export type JsonChunkSink = (chunk: string) => void;

export interface StreamJsonOptions {
  /** Spaces per level, as the third `JSON.stringify` argument. 0 is compact. */
  readonly indent?: number;
  /** Soft lower bound on chunk size; the last chunk may be smaller. */
  readonly chunkCharacters?: number;
}

const DEFAULT_CHUNK_CHARACTERS = 1 << 20;
const MAXIMUM_INDENT = 10;

interface JsonSerializable {
  toJSON(key: string): unknown;
}

/** Applies the `toJSON` step `JSON.stringify` performs before inspecting a value. */
function resolveValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return value;
  const candidate = (value as Partial<JsonSerializable>).toJSON;
  return typeof candidate === "function"
    ? (value as JsonSerializable).toJSON(key)
    : value;
}

/** True for the arrays and objects this walks; boxed primitives are delegated. */
function isContainer(value: object): boolean {
  return !(value instanceof Number || value instanceof String || value instanceof Boolean);
}

/** A value `JSON.stringify` drops: omitted as a key, `null` in an array. */
function isDropped(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/**
 * Walks one document, buffering characters until a chunk is worth emitting.
 *
 * The buffer is the only thing that grows during a walk, and it is bounded by
 * the chunk threshold, so peak memory no longer tracks document size. The
 * escaped-key cache lives here rather than at module scope so a compile does
 * not retain the key vocabulary of every document that came before it.
 */
class JsonStreamWriter {
  private readonly parts: string[] = [];
  private pending = 0;
  private readonly escapedKeys = new Map<string, string>();
  private readonly pads: string[] = [""];

  constructor(
    private readonly sink: JsonChunkSink,
    private readonly threshold: number,
    private readonly indentWidth: number,
  ) {}

  /** Takes an already-resolved document, so `toJSON` runs exactly once. */
  write(resolved: unknown): void {
    this.writeResolved(resolved);
    if (this.parts.length > 0) {
      this.sink(this.parts.join(""));
      this.parts.length = 0;
      this.pending = 0;
    }
  }

  private emit(text: string): void {
    this.parts.push(text);
    this.pending += text.length;
    if (this.pending < this.threshold) return;
    this.sink(this.parts.join(""));
    this.parts.length = 0;
    this.pending = 0;
  }

  /** Indentation is one repeated string per depth, built once and reused. */
  private pad(depth: number): string {
    while (this.pads.length <= depth) {
      this.pads.push(" ".repeat(this.indentWidth * this.pads.length));
    }
    return this.pads[depth] as string;
  }

  /**
   * A compiled glTF repeats the same few dozen keys once per node, mesh, and
   * accessor, so escaping each one again was the largest cost of the walk.
   */
  private escapedKey(key: string): string {
    let escaped = this.escapedKeys.get(key);
    if (escaped === undefined) {
      escaped = JSON.stringify(key);
      this.escapedKeys.set(key, escaped);
    }
    return escaped;
  }

  private writeResolved(resolved: unknown, depth = 0): void {
    switch (typeof resolved) {
      case "number":
        // Number::toString is the operation `JSON.stringify` applies, and it
        // renders negative zero as "0" exactly as the serializer does.
        this.emit(Number.isFinite(resolved) ? String(resolved) : "null");
        return;
      case "string":
        // Escaping stays with the engine, so string bytes cannot drift.
        this.emit(JSON.stringify(resolved));
        return;
      case "boolean":
        this.emit(resolved ? "true" : "false");
        return;
      case "object":
        break;
      default:
        this.emit(JSON.stringify(resolved) ?? "null");
        return;
    }
    if (resolved === null) {
      this.emit("null");
      return;
    }
    if (Array.isArray(resolved)) this.writeArray(resolved, depth);
    else if (isContainer(resolved)) this.writeObject(resolved, depth);
    else this.emit(JSON.stringify(resolved));
  }

  private writeArray(value: readonly unknown[], depth: number): void {
    if (value.length === 0) {
      this.emit("[]");
      return;
    }
    const compact = this.indentWidth === 0;
    const separator = compact ? "," : `,\n${this.pad(depth + 1)}`;
    this.emit(compact ? "[" : `[\n${this.pad(depth + 1)}`);
    for (const [at, element] of value.entries()) {
      if (at > 0) this.emit(separator);
      // A hole, `undefined`, a function, and a symbol all serialize as `null`
      // inside an array, unlike in an object where the key disappears.
      this.writeResolved(resolveValue(element, String(at)), depth + 1);
    }
    this.emit(compact ? "]" : `\n${this.pad(depth)}]`);
  }

  private writeObject(value: object, depth: number): void {
    const compact = this.indentWidth === 0;
    const separator = compact ? "," : `,\n${this.pad(depth + 1)}`;
    const opening = compact ? "{" : `{\n${this.pad(depth + 1)}`;
    const colon = compact ? ":" : ": ";
    let written = 0;
    for (const key of Object.keys(value)) {
      const resolved = resolveValue((value as Record<string, unknown>)[key], key);
      if (isDropped(resolved)) continue;
      this.emit((written === 0 ? opening : separator) + this.escapedKey(key) + colon);
      written += 1;
      this.writeResolved(resolved, depth + 1);
    }
    if (written === 0) this.emit("{}");
    else this.emit(compact ? "}" : `\n${this.pad(depth)}}`);
  }
}

/**
 * Writes `value` to `sink` in chunks, byte-identical to
 * `JSON.stringify(value, null, indent)`.
 *
 * A value with no JSON form at the top level (`undefined`, a function, a
 * symbol) throws, as does anything the delegated `JSON.stringify` rejects.
 * Two inputs no compiled document contains are not reproduced: a cycle
 * exhausts the stack instead of reporting a circular structure, and a boxed
 * `BigInt` serializes as an object rather than throwing.
 */
export function streamJsonInto(
  value: unknown,
  sink: JsonChunkSink,
  options: StreamJsonOptions = {},
): void {
  const indent = Math.min(Math.max(Math.floor(options.indent ?? 0), 0), MAXIMUM_INDENT);
  const threshold = Math.max(options.chunkCharacters ?? DEFAULT_CHUNK_CHARACTERS, 1);
  const resolved = resolveValue(value, "");
  if (isDropped(resolved)) {
    throw new TypeError("A JSON document must not be undefined, a function, or a symbol.");
  }
  new JsonStreamWriter(sink, threshold, indent).write(resolved);
}

/** Collects the same chunks into one string; for tests and small documents. */
export function streamJsonToString(value: unknown, options: StreamJsonOptions = {}): string {
  const parts: string[] = [];
  streamJsonInto(value, (chunk) => parts.push(chunk), options);
  return parts.join("");
}
