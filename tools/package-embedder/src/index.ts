import {
  decodeCompiledGltf,
  inspectCompiledHierarchy,
  openPackageTransport,
} from "@naru3d/runtime-webgpu";
import type {
  CompiledPackageLimitOverrides,
  DeclaredPackageResource,
  GeometryRepresentation,
  PackageFetch,
  PackageTransportDescriptor,
  PackageTransportPolicy,
} from "@naru3d/runtime-webgpu";

/**
 * A second consumer of the compiled-package loader, independent of the Studio.
 *
 * It exists to exercise the embedder-facing surface ADR-0011 describes: it
 * imports only the published `@naru3d/runtime-webgpu` entry point, chooses its
 * own transfer policy rather than inheriting the Studio's, and reports what
 * that policy admitted. Nothing here is browser-specific -- it runs on Node's
 * `fetch` -- so a host that is neither the Studio nor a browser is what the
 * override surface is measured against.
 */

/** One resource the opened document declared, as the policy resolved it. */
export interface OpenedPackageResource {
  readonly uri: string;
  readonly url: string;
  readonly origin: string;
  readonly byteLength: number;
}

export interface OpenedPackage {
  readonly documentUrl: string;
  /** The resolved policy, exactly as it would cross a Worker boundary. */
  readonly transport: PackageTransportDescriptor;
  readonly documentByteLength: number;
  readonly representation: GeometryRepresentation;
  readonly resources: readonly OpenedPackageResource[];
  readonly prototypeBatches: number;
  readonly partOccurrences: number;
  readonly triangles: number;
  readonly edgeSegments: number;
  readonly binaryByteLength: number;
  /** Every URL this open actually transferred, in request order. */
  readonly transfers: readonly string[];
}

export interface OpenPackageOptions {
  readonly documentUrl: string;
  /** Transfer policy: ceilings, announced origins, and the transfer itself. */
  readonly policy?: PackageTransportPolicy;
  /** Structural ceilings the document is parsed under. */
  readonly packageLimits?: CompiledPackageLimitOverrides;
  readonly representation?: GeometryRepresentation;
}

function declaredResources(hierarchy: {
  readonly binaryUri: string;
  readonly binaryByteLength: number;
  readonly coarseBinaryUri?: string;
  readonly coarseBinaryByteLength?: number;
  readonly properties?: DeclaredPackageResource;
  readonly spatialIndex?: DeclaredPackageResource;
  readonly relocatedHierarchy?: DeclaredPackageResource;
}): DeclaredPackageResource[] {
  const resources: DeclaredPackageResource[] = [
    { uri: hierarchy.binaryUri, byteLength: hierarchy.binaryByteLength },
  ];
  if (hierarchy.coarseBinaryUri && hierarchy.coarseBinaryByteLength !== undefined) {
    resources.push({
      uri: hierarchy.coarseBinaryUri,
      byteLength: hierarchy.coarseBinaryByteLength,
    });
  }
  if (hierarchy.properties) resources.push(hierarchy.properties);
  if (hierarchy.spatialIndex) resources.push(hierarchy.spatialIndex);
  if (hierarchy.relocatedHierarchy) resources.push(hierarchy.relocatedHierarchy);
  return resources;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer;
}

/**
 * Opens one compiled package over HTTP and decodes a whole representation.
 *
 * The policy is settled once and then carried: the document, every resource it
 * declares, and the binary are read through the same `PackageTransport`, so a
 * ceiling or an origin the embedder chose applies to all of them.
 */
export async function openCompiledPackage(
  options: OpenPackageOptions,
): Promise<OpenedPackage> {
  const transfers: string[] = [];
  const policy = options.policy ?? {};
  const underlying: PackageFetch = policy.fetch
    ?? ((url, init) => fetch(url, init));
  // Counting through the injected-transfer axis, rather than around it: what
  // the record reports is what the policy's own transfer was asked for.
  const counted: PackageFetch = (url, init) => {
    transfers.push(url.href);
    return underlying(url, init);
  };
  const transport = openPackageTransport(options.documentUrl, {
    ...policy,
    fetch: counted,
  });
  const representation = options.representation ?? "target";

  const documentBytes = await transport.fetchResource(transport.documentUrl, {
    kind: "gltf",
    label: transport.documentUrl.href,
    limitBytes: transport.limits.documentBytes,
  });
  const document: unknown = JSON.parse(new TextDecoder().decode(documentBytes));
  const parseOptions = options.packageLimits ? { limits: options.packageLimits } : {};
  const { hierarchy } = inspectCompiledHierarchy(document, parseOptions);

  const declared = declaredResources(hierarchy);
  const resources = declared.map((resource) => {
    const url = transport.resolveResourceUrl(resource.uri, transport.documentUrl, resource.uri);
    return {
      uri: resource.uri,
      url: url.href,
      origin: url.origin,
      byteLength: resource.byteLength,
    };
  });
  transport.assertBudget(documentBytes.byteLength, declared);

  const binaryUri = representation === "coarse" ? hierarchy.coarseBinaryUri : hierarchy.binaryUri;
  const binaryByteLength = representation === "coarse"
    ? hierarchy.coarseBinaryByteLength
    : hierarchy.binaryByteLength;
  if (binaryUri === undefined || binaryByteLength === undefined) {
    throw new TypeError(`The package declares no ${representation} binary resource.`);
  }
  const binaryBytes = await transport.fetchResource(
    transport.resolveResourceUrl(binaryUri, transport.documentUrl, binaryUri),
    {
      kind: "binary",
      label: binaryUri,
      limitBytes: transport.resourceLimit(binaryByteLength),
    },
  );
  const scene = decodeCompiledGltf(document, bufferOf(binaryBytes), {
    representation,
    ...parseOptions,
  });

  return {
    documentUrl: transport.documentUrl.href,
    transport: transport.describe(),
    documentByteLength: documentBytes.byteLength,
    representation,
    resources,
    prototypeBatches: scene.summary.prototypeBatches,
    partOccurrences: scene.summary.partOccurrences,
    triangles: scene.summary.triangles,
    edgeSegments: scene.summary.edgeSegments,
    binaryByteLength: scene.summary.binaryBytes,
    transfers,
  };
}
