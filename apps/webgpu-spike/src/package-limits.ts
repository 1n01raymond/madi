/**
 * Transport policy for compiled packages loaded over the network.
 *
 * A remote package is untrusted input (SECURITY.md, ADR-0011): its glTF
 * document, its byte-range buffers, and its sidecars all arrive before
 * anything about them has been verified. Every fetch in the Studio goes
 * through this module so one reviewed policy -- same origin, no redirects, an
 * allowed content type, and a byte ceiling enforced while the body streams --
 * decides what the rest of the app is allowed to see.
 */

/** Byte and count ceilings a remote package may not exceed. */
export interface PackageTransferLimits {
  /** Largest glTF document the loader will read. */
  readonly documentBytes: number;
  /** Largest single external resource (or Range response) the loader will read. */
  readonly resourceBytes: number;
  /** Largest total the document plus its declared resources may reach. */
  readonly packageBytes: number;
  /** Most external resources one package may declare. */
  readonly resourceCount: number;
}

/**
 * Deliberately far above what this repository compiles. These are backstops
 * against a hostile declaration, not a size policy: a limit set near the
 * largest real model buys no safety a limit an order of magnitude above it
 * lacks, and only turns a legitimate larger federation into a load failure.
 * The largest recorded package is sixty5 at 657,116,508 bytes, whose glTF
 * document is 448,823,852 bytes and whose largest buffer is 120,707,064 bytes
 * across 4 resources (artifacts/ifc/sixty5-first-frame).
 *
 * `documentBytes` is the exception, and is generous for a different reason:
 * both readers decode the document to a string before parsing it, so V8's
 * maximum string length (536,870,888 bytes) is a wall no ceiling here can
 * move. One GiB sits above it, so this limit never causes a rejection an
 * engine would not; raising it further would only allocate more before the
 * parse fails.
 */
export const defaultPackageTransferLimits: PackageTransferLimits = {
  documentBytes: 1_073_741_824,
  resourceBytes: 2_147_483_648,
  /** The package is never fully resident -- residency is budgeted separately. */
  packageBytes: 8_589_934_592,
  resourceCount: 256,
};

export type PackageTransferLimitOverrides = Partial<PackageTransferLimits>;

export function resolvePackageTransferLimits(
  overrides?: PackageTransferLimitOverrides,
): PackageTransferLimits {
  const resolved = { ...defaultPackageTransferLimits, ...overrides };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`The ${key} limit must be a positive safe integer.`);
    }
  }
  return resolved;
}

export type PackageResourceKind = "gltf" | "json" | "binary";

/**
 * What each resource kind may be served as. `application/octet-stream` is
 * accepted everywhere because it claims nothing beyond "bytes"; the point of
 * the list is to reject typed documents -- a dev server's `text/html` SPA
 * fallback for a missing resource, or an error page from a host that answers
 * 200 -- before they reach a parser. The deployed demo's own types are
 * asserted by scripts/check-public-demo.mjs.
 */
const allowedContentTypes: Readonly<Record<PackageResourceKind, readonly string[]>> = {
  gltf: ["model/gltf+json", "application/json", "application/octet-stream"],
  json: ["application/json", "application/octet-stream"],
  binary: ["application/octet-stream"],
};

/**
 * Accepts only an absolute HTTP(S) URL on the document's own origin and
 * without embedded credentials, so a package cannot direct the loader at
 * another host, at a non-HTTP scheme, or at an authenticated endpoint.
 */
export function resolvePackageResourceUrl(uri: string, documentUrl: URL, label: string): URL {
  let resolved: URL;
  try {
    resolved = new URL(uri, documentUrl);
  } catch {
    throw new TypeError(`${label} declares an unusable resource URI.`);
  }
  assertPackageUrl(resolved, label);
  if (resolved.origin !== documentUrl.origin) {
    throw new TypeError(
      `${label} points at ${resolved.origin}; package resources must stay on ${documentUrl.origin}.`,
    );
  }
  return resolved;
}

export function assertPackageUrl(url: URL, label: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new TypeError(`${label} must not carry credentials.`);
  }
}

/** One external resource a compiled glTF declares, for the aggregate ceiling. */
export interface DeclaredPackageResource {
  readonly uri: string;
  readonly byteLength: number;
}

/**
 * Rejects a package whose declared size or resource count is beyond policy
 * before any of it is fetched. The sum is computed over safe integers, so an
 * overflowing or negative declaration fails here instead of wrapping into a
 * plausible-looking total.
 */
export function assertPackageBudget(
  documentByteLength: number,
  resources: readonly DeclaredPackageResource[],
  limits: PackageTransferLimits,
): void {
  if (resources.length > limits.resourceCount) {
    throw new RangeError(
      `The package declares ${resources.length} external resources; the limit is ${limits.resourceCount}.`,
    );
  }
  let total = assertDeclaredLength(documentByteLength, "The glTF document");
  if (total > limits.documentBytes) {
    throw new RangeError(
      `The glTF document declares ${total} bytes; the limit is ${limits.documentBytes}.`,
    );
  }
  for (const resource of resources) {
    const byteLength = assertDeclaredLength(resource.byteLength, resource.uri);
    if (byteLength > limits.resourceBytes) {
      throw new RangeError(
        `${resource.uri} declares ${byteLength} bytes; the limit is ${limits.resourceBytes}.`,
      );
    }
    total += byteLength;
    if (!Number.isSafeInteger(total) || total > limits.packageBytes) {
      throw new RangeError(
        `The package declares more than ${limits.packageBytes} bytes across its resources.`,
      );
    }
  }
}

function assertDeclaredLength(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} declares an unusable byte length.`);
  }
  return value;
}

export interface PackageResponseRequest {
  readonly kind: PackageResourceKind;
  /** Names the resource in every diagnostic this module raises. */
  readonly label: string;
  readonly signal?: AbortSignal;
  /** Requests exactly this range; the caller validates the Content-Range. */
  readonly range?: { readonly byteOffset: number; readonly byteLength: number };
}

/**
 * Issues the one fetch shape package resources are allowed to use: no
 * redirects to follow, no cache to serve a stale or poisoned copy, and a
 * content type the caller expects. The body is left unread so that callers
 * which must inspect status or Content-Range can do so before allocating.
 */
export async function openPackageResponse(
  url: URL,
  request: PackageResponseRequest,
): Promise<Response> {
  assertPackageUrl(url, request.label);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.range
      ? {
          headers: {
            Range: `bytes=${request.range.byteOffset}-${
              request.range.byteOffset + request.range.byteLength - 1
            }`,
          },
        }
      : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to load ${request.label} (${String(response.status)}).`);
  }
  assertContentType(response, request.kind, request.label);
  return response;
}

function assertContentType(
  response: Response,
  kind: PackageResourceKind,
  label: string,
): void {
  const header = response.headers.get("Content-Type");
  // An absent type claims nothing; a wrong one is how an error page or an SPA
  // fallback reaches a parser, so that is what the allowlist rejects.
  if (header === null) return;
  const essence = header.split(";")[0]?.trim().toLocaleLowerCase("en-US") ?? "";
  if (!allowedContentTypes[kind].includes(essence)) {
    throw new TypeError(`${label} was served as ${essence}, which is not a package resource type.`);
  }
}

/**
 * Reads a response body without ever holding more than `limitBytes`.
 *
 * A declared `Content-Length` is checked before anything is allocated and then
 * held to: the reader fills a buffer of exactly that size and fails if the
 * body runs long or short, so a dishonest length cannot grow the allocation
 * and a truncated transfer cannot pass as a complete resource. Without a
 * declared length the body is accumulated against the ceiling and the transfer
 * is cancelled the moment it crosses it.
 */
export async function readBoundedBody(
  response: Response,
  limitBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declared = declaredContentLength(response, label);
  if (declared !== undefined && declared > limitBytes) {
    throw new RangeError(`${label} declares ${declared} bytes; the limit is ${limitBytes}.`);
  }
  const body = response.body;
  if (!body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limitBytes) {
      throw new RangeError(`${label} is larger than ${limitBytes} bytes.`);
    }
    return bytes;
  }
  const reader = body.getReader();
  try {
    return declared === undefined
      ? await readUntilLimit(reader, limitBytes, label)
      : await readDeclaredLength(reader, declared, label);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

function declaredContentLength(response: Response, label: string): number | undefined {
  const header = response.headers.get("Content-Length");
  if (header === null) return undefined;
  const value = Number(header);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} declares an unusable Content-Length.`);
  }
  return value;
}

async function readDeclaredLength(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  declared: number,
  label: string,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(declared);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > declared) {
      throw new RangeError(`${label} sent more than the ${declared} bytes it declared.`);
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== declared) {
    throw new RangeError(`${label} ended after ${offset} of ${declared} declared bytes.`);
  }
  return bytes;
}

async function readUntilLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limitBytes: number,
  label: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      throw new RangeError(`${label} is larger than ${limitBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Applies the URL, fetch, content-type, and byte policy in one call. */
export async function fetchPackageResource(
  url: URL,
  request: PackageResponseRequest & { readonly limitBytes: number },
): Promise<Uint8Array> {
  const response = await openPackageResponse(url, request);
  return readBoundedBody(response, request.limitBytes, request.label);
}
