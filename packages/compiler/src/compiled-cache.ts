import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const compiledCacheEntrySchema = "naru.compiled-cache-entry.1" as const;

export interface CompiledCacheSourceInput {
  readonly scope: string;
  readonly sha256: string;
}

export interface CompiledCacheToolInput {
  readonly name: string;
  readonly version: string;
}

export interface CompiledCacheKeyInput {
  readonly sources: readonly CompiledCacheSourceInput[];
  readonly adapter: CompiledCacheToolInput;
  readonly compiler: CompiledCacheToolInput;
  readonly options: Readonly<Record<string, string | number | boolean>>;
}

export interface CompiledCacheResource {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CompiledCacheEntry {
  readonly schemaVersion: typeof compiledCacheEntrySchema;
  readonly key: string;
  readonly input: CompiledCacheKeyInput;
  readonly packageDigest: string;
  readonly resources: readonly CompiledCacheResource[];
}

export interface PublishCompiledCacheEntryOptions {
  readonly cacheDirectory: string;
  readonly packageDirectory: string;
  readonly input: CompiledCacheKeyInput;
  readonly packageDigest: string;
  readonly resourcePaths: readonly string[];
}

export interface RestoreCompiledCacheEntryOptions {
  readonly cacheDirectory: string;
  readonly key: string;
  readonly outputDirectory: string;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const resourcePathPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function requireText(value: string, label: string): string {
  if (value.trim() === "") throw new TypeError(`${label} must not be empty.`);
  return value;
}

function requireSha256(value: string, label: string): string {
  if (!sha256Pattern.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256.`);
  return value;
}

function normalizeInput(input: CompiledCacheKeyInput): CompiledCacheKeyInput {
  if (input.sources.length === 0) {
    throw new TypeError("A compiled cache key requires at least one source.");
  }
  const sources = input.sources
    .map(({ scope, sha256 }) => ({
      scope: requireText(scope, "Cache source scope"),
      sha256: requireSha256(sha256, "Cache source digest"),
    }))
    .sort((left, right) => left.scope.localeCompare(right.scope, "en"));
  if (new Set(sources.map(({ scope }) => scope)).size !== sources.length) {
    throw new TypeError("Compiled cache source scopes must be unique.");
  }
  const options = Object.fromEntries(
    Object.entries(input.options)
      .map(([key, value]) => {
        requireText(key, "Cache option name");
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new TypeError(`Cache option ${key} must be finite.`);
        }
        return [key, value] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right, "en")),
  );
  return {
    sources,
    adapter: {
      name: requireText(input.adapter.name, "Cache adapter name"),
      version: requireText(input.adapter.version, "Cache adapter version"),
    },
    compiler: {
      name: requireText(input.compiler.name, "Cache compiler name"),
      version: requireText(input.compiler.version, "Cache compiler version"),
    },
    options,
  };
}

export function createCompiledCacheKey(input: CompiledCacheKeyInput): string {
  const normalized = normalizeInput(input);
  return createHash("sha256")
    .update(JSON.stringify({ schemaVersion: compiledCacheEntrySchema, input: normalized }))
    .digest("hex");
}

function requireResourcePath(path: string): string {
  if (!resourcePathPattern.test(path)) {
    throw new TypeError(`Cache resource path ${path} must be one portable file name.`);
  }
  return path;
}

async function identifyFile(path: string): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const [bytes, metadata] = await Promise.all([readFile(path), lstat(path)]);
  if (!metadata.isFile()) throw new TypeError(`Cache resource ${path} must be a file.`);
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

function cacheEntryDirectory(cacheDirectory: string, key: string): string {
  requireSha256(key, "Compiled cache key");
  return resolve(cacheDirectory, key);
}

function parseEntry(serialized: string, expectedKey: string): CompiledCacheEntry {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new TypeError("Compiled cache manifest is not valid JSON.", { cause: error });
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Compiled cache manifest must be an object.");
  }
  const entry = value as Partial<CompiledCacheEntry>;
  if (entry.schemaVersion !== compiledCacheEntrySchema || entry.key !== expectedKey) {
    throw new TypeError("Compiled cache manifest identity changed.");
  }
  requireSha256(entry.packageDigest ?? "", "Compiled package digest");
  if (entry.input === undefined || createCompiledCacheKey(entry.input) !== expectedKey) {
    throw new TypeError("Compiled cache input does not reproduce its key.");
  }
  if (!Array.isArray(entry.resources) || entry.resources.length === 0) {
    throw new TypeError("Compiled cache manifest requires resources.");
  }
  const paths = new Set<string>();
  for (const resource of entry.resources) {
    requireResourcePath(resource.path);
    if (paths.has(resource.path)) throw new TypeError(`Duplicate cache resource ${resource.path}.`);
    paths.add(resource.path);
    if (!Number.isSafeInteger(resource.bytes) || resource.bytes < 0) {
      throw new TypeError(`Cache resource ${resource.path} has an invalid byte count.`);
    }
    requireSha256(resource.sha256, `Cache resource ${resource.path} digest`);
  }
  return entry as CompiledCacheEntry;
}

export async function readCompiledCacheEntry(
  cacheDirectory: string,
  key: string,
): Promise<CompiledCacheEntry | undefined> {
  const directory = cacheEntryDirectory(cacheDirectory, key);
  try {
    return parseEntry(await readFile(join(directory, "cache-entry.json"), "utf8"), key);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function verifyResources(
  directory: string,
  resources: readonly CompiledCacheResource[],
): Promise<void> {
  await Promise.all(
    resources.map(async (resource) => {
      const identity = await identifyFile(join(directory, resource.path));
      if (identity.bytes !== resource.bytes || identity.sha256 !== resource.sha256) {
        throw new TypeError(`Compiled cache resource ${resource.path} failed integrity verification.`);
      }
    }),
  );
}

export async function publishCompiledCacheEntry(
  options: PublishCompiledCacheEntryOptions,
): Promise<CompiledCacheEntry> {
  const input = normalizeInput(options.input);
  const key = createCompiledCacheKey(input);
  const packageDigest = requireSha256(options.packageDigest, "Compiled package digest");
  const resourcePaths = [...options.resourcePaths].sort((left, right) => left.localeCompare(right, "en"));
  if (resourcePaths.length === 0) throw new TypeError("A compiled cache entry requires resources.");
  if (new Set(resourcePaths).size !== resourcePaths.length) {
    throw new TypeError("Compiled cache resource paths must be unique.");
  }
  resourcePaths.forEach(requireResourcePath);
  const packageDirectory = resolve(options.packageDirectory);
  const resources = await Promise.all(
    resourcePaths.map(async (path) => ({ path, ...(await identifyFile(join(packageDirectory, path))) })),
  );
  const entry: CompiledCacheEntry = {
    schemaVersion: compiledCacheEntrySchema,
    key,
    input,
    packageDigest,
    resources,
  };
  const cacheDirectory = resolve(options.cacheDirectory);
  const entryDirectory = cacheEntryDirectory(cacheDirectory, key);
  await mkdir(cacheDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(join(cacheDirectory, ".publish-"));
  try {
    await Promise.all(
      resources.map(({ path }) =>
        copyFile(join(packageDirectory, path), join(stagingDirectory, path)),
      ),
    );
    await writeFile(
      join(stagingDirectory, "cache-entry.json"),
      `${JSON.stringify(entry, null, 2)}\n`,
      "utf8",
    );
    try {
      await rename(stagingDirectory, entryDirectory);
    } catch (error) {
      if (!new Set(["EEXIST", "ENOTEMPTY"]).has(errorCode(error) ?? "")) throw error;
      const existing = await readCompiledCacheEntry(cacheDirectory, key);
      if (!existing) throw error;
      await verifyResources(entryDirectory, existing.resources);
      if (
        existing.packageDigest !== entry.packageDigest ||
        JSON.stringify(existing.resources) !== JSON.stringify(entry.resources)
      ) {
        throw new TypeError(
          "Compiled cache key produced different package output; bump the compiler/cache identity.",
          { cause: error },
        );
      }
      return existing;
    }
    return entry;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function restoreCompiledCacheEntry(
  options: RestoreCompiledCacheEntryOptions,
): Promise<CompiledCacheEntry | undefined> {
  const entry = await readCompiledCacheEntry(options.cacheDirectory, options.key);
  if (!entry) return undefined;
  const entryDirectory = cacheEntryDirectory(options.cacheDirectory, options.key);
  await verifyResources(entryDirectory, entry.resources);
  const outputDirectory = resolve(options.outputDirectory);
  try {
    const outputMetadata = await lstat(outputDirectory);
    if (!outputMetadata.isDirectory()) {
      throw new TypeError(`Compiled cache restore output must be a directory: ${outputDirectory}.`);
    }
    await verifyResources(outputDirectory, entry.resources);
    return entry;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  await mkdir(dirname(outputDirectory), { recursive: true });
  const stagingDirectory = await mkdtemp(join(dirname(outputDirectory), ".naru-restore-"));
  try {
    await Promise.all(
      entry.resources.map(({ path }) =>
        copyFile(join(entryDirectory, path), join(stagingDirectory, path)),
      ),
    );
    await rename(stagingDirectory, outputDirectory);
    return entry;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
