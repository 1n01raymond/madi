import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";

/**
 * Guards shared by the two content-addressed stores in this package: the whole
 * package cache (`compiled-cache.ts`) and the per-prototype payload store
 * (`compiled-payload-store.ts`). They are kept in one module so a hardening fix
 * -- a refused path shape, a stricter digest check -- cannot land in one store
 * and be forgotten in the other.
 */

export interface CacheToolInput {
  readonly name: string;
  readonly version: string;
}

/** Values a cache key may carry for an option, so a key stays JSON-stable. */
export type CacheOptionValue = string | number | boolean;

const sha256Pattern = /^[a-f0-9]{64}$/u;
// One portable file name: no separator, no traversal, no leading dot.
const resourcePathPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function requireText(value: string, label: string): string {
  if (value.trim() === "") throw new TypeError(`${label} must not be empty.`);
  return value;
}

// The validators accept `unknown` because their hottest caller parses an
// on-disk manifest: the field may be absent or the wrong type, and saying so in
// the signature keeps that check inside the function instead of at each site.
export function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

export function requireResourcePath(path: unknown): string {
  if (typeof path !== "string" || !resourcePathPattern.test(path)) {
    throw new TypeError(`Cache resource path ${String(path)} must be one portable file name.`);
  }
  return path;
}

export function requireTool(tool: CacheToolInput, label: string): CacheToolInput {
  return {
    name: requireText(tool.name, `${label} name`),
    version: requireText(tool.version, `${label} version`),
  };
}

/** Sorted, so two callers that build the same options in a different order agree. */
export function normalizeCacheOptions(
  options: Readonly<Record<string, CacheOptionValue>>,
): Readonly<Record<string, CacheOptionValue>> {
  return Object.fromEntries(
    Object.entries(options)
      .map(([key, value]) => {
        requireText(key, "Cache option name");
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new TypeError(`Cache option ${key} must be finite.`);
        }
        return [key, value] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right, "en")),
  );
}

export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function identifyFile(
  path: string,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  // `lstat`, not `stat`: a symlink planted in a cache directory must be refused
  // rather than followed out of it.
  const [bytes, metadata] = await Promise.all([readFile(path), lstat(path)]);
  if (!metadata.isFile()) throw new TypeError(`Cache resource ${path} must be a file.`);
  return { bytes: bytes.byteLength, sha256: digestBytes(bytes) };
}

/**
 * The same check, synchronously, returning the bytes it already hashed.
 *
 * The packager's geometry loop is synchronous, so the payload store reads
 * through this: restoring one payload at a time inside that loop keeps peak
 * memory at the clean build's, where an asynchronous pre-pass would have to
 * hold every payload at once. Handing the bytes back also spares the caller a
 * second read of a file this function has just read in full.
 */
export function identifyFileSync(
  path: string,
): { readonly bytes: Uint8Array; readonly sha256: string } {
  if (!lstatSync(path).isFile()) throw new TypeError(`Cache resource ${path} must be a file.`);
  const bytes = new Uint8Array(readFileSync(path));
  return { bytes, sha256: digestBytes(bytes) };
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

/**
 * Windows reports a rename onto an existing directory as EPERM rather than
 * EEXIST or ENOTEMPTY, so all three mean "another process published first".
 */
export const idempotentPublishCodes: ReadonlySet<string> = new Set([
  "EEXIST",
  "ENOTEMPTY",
  "EPERM",
]);

/**
 * Serializes a value with its object keys in a fixed order, so two records that
 * describe the same thing compare equal even when one of them was written by a
 * version that emitted its fields in another order. Comparing raw
 * `JSON.stringify` output would report that as a disagreement.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
