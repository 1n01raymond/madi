import { inspectCompiledHierarchy } from "@madi/runtime-webgpu";
import type { CompiledGltfDocument, CompiledHierarchy } from "@madi/runtime-webgpu";

import { resourceFileName } from "./property-sidecar.js";
import type { PropertySidecarSource } from "./property-sidecar.js";

export interface UrlSceneSource {
  readonly kind: "url";
  readonly gltfUrl: URL;
}

export interface LocalSceneSource {
  readonly kind: "local";
  readonly gltfFile: File;
  readonly binaryFiles: readonly File[];
  /** `.json` files selected next to the glTF, e.g. the property sidecar. */
  readonly sidecarFiles: readonly File[];
}

export type SceneSource = UrlSceneSource | LocalSceneSource;

export type GeometryBinarySource =
  | {
      readonly kind: "url";
      readonly href: string;
      readonly byteOffset?: number;
      readonly byteLength?: number;
    }
  | {
      readonly kind: "file";
      readonly file: File;
      readonly byteOffset?: number;
      readonly byteLength?: number;
    };

export interface LoadedSceneHierarchy {
  readonly document: CompiledGltfDocument;
  readonly hierarchy: CompiledHierarchy;
  readonly targetBinary: GeometryBinarySource;
  readonly coarseBinary?: GeometryBinarySource;
  readonly properties?: PropertySidecarSource;
  readonly label: string;
}

export function parseSceneUrl(value: string, baseHref: string): URL {
  const trimmed = value.trim();
  if (trimmed === "") throw new TypeError("Enter a compiled glTF URL.");
  const url = new URL(trimmed, baseHref);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Compiled scene URLs must use HTTP or HTTPS.");
  }
  return url;
}

export function selectLocalSceneFiles(files: readonly File[]): LocalSceneSource {
  const unsupported = files.filter(
    (file) => !file.name.toLocaleLowerCase("en-US").endsWith(".gltf") &&
      !file.name.toLocaleLowerCase("en-US").endsWith(".bin") &&
      !file.name.toLocaleLowerCase("en-US").endsWith(".json"),
  );
  const gltfFiles = files.filter((file) =>
    file.name.toLocaleLowerCase("en-US").endsWith(".gltf"),
  );
  const binaryFiles = files.filter((file) =>
    file.name.toLocaleLowerCase("en-US").endsWith(".bin"),
  );
  const sidecarFiles = files.filter((file) =>
    file.name.toLocaleLowerCase("en-US").endsWith(".json"),
  );
  if (unsupported.length > 0 || gltfFiles.length !== 1 || binaryFiles.length < 1) {
    throw new TypeError(
      "Select exactly one .gltf file and all of its .bin and .json resources.",
    );
  }
  const gltfFile = gltfFiles[0];
  if (!gltfFile) throw new TypeError("The local scene package is incomplete.");
  return { kind: "local", gltfFile, binaryFiles, sidecarFiles };
}

export function validateLocalBinary(
  hierarchy: CompiledHierarchy,
  binaryFile: Pick<File, "name" | "size">,
  representation: "target" | "coarse" = "target",
): void {
  const uri = representation === "coarse" ? hierarchy.coarseBinaryUri : hierarchy.binaryUri;
  const byteLength = representation === "coarse"
    ? hierarchy.coarseBinaryByteLength
    : hierarchy.binaryByteLength;
  if (!uri || byteLength === undefined) {
    throw new TypeError(`The compiled scene has no ${representation} binary resource.`);
  }
  const binaryUrl = new URL(uri, "https://madi.local/");
  const expectedName = decodeURIComponent(binaryUrl.pathname.split("/").pop() ?? "");
  if (binaryFile.name !== expectedName) {
    throw new TypeError(
      `The glTF expects ${expectedName}; selected binary is ${binaryFile.name}.`,
    );
  }
  if (binaryFile.size !== byteLength) {
    throw new TypeError(
      `${binaryFile.name} must be ${byteLength.toLocaleString("en-US")} bytes; ` +
        `received ${binaryFile.size.toLocaleString("en-US")}.`,
    );
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${label} is not valid JSON.`);
  }
}

export async function loadSceneHierarchy(
  source: SceneSource,
  signal?: AbortSignal,
): Promise<LoadedSceneHierarchy> {
  if (source.kind === "url") {
    const response = await fetch(source.gltfUrl, { cache: "no-store", signal });
    if (!response.ok) {
      throw new Error(`Failed to load compiled hierarchy (${response.status}).`);
    }
    const { document, hierarchy } = inspectCompiledHierarchy(await response.json());
    return {
      document,
      hierarchy,
      targetBinary: { kind: "url", href: new URL(hierarchy.binaryUri, source.gltfUrl).href },
      ...(hierarchy.coarseBinaryUri
        ? {
            coarseBinary: {
              kind: "url" as const,
              href: new URL(hierarchy.coarseBinaryUri, source.gltfUrl).href,
            },
          }
        : {}),
      ...(hierarchy.properties
        ? {
            properties: {
              kind: "url" as const,
              ref: hierarchy.properties,
              jsonUrl: new URL(hierarchy.properties.uri, source.gltfUrl),
            },
          }
        : {}),
      label: source.gltfUrl.href,
    };
  }

  const { document, hierarchy } = inspectCompiledHierarchy(
    parseJson(await source.gltfFile.text(), source.gltfFile.name),
  );
  const fileFor = (uri: string): File | undefined => {
    const expectedName = decodeURIComponent(
      new URL(uri, "https://madi.local/").pathname.split("/").pop() ?? "",
    );
    return source.binaryFiles.find(({ name }) => name === expectedName);
  };
  const targetFile = fileFor(hierarchy.binaryUri);
  if (!targetFile) throw new TypeError(`Select ${hierarchy.binaryUri} with the glTF file.`);
  validateLocalBinary(hierarchy, targetFile);
  const coarseFile = hierarchy.coarseBinaryUri
    ? fileFor(hierarchy.coarseBinaryUri)
    : undefined;
  if (hierarchy.coarseBinaryUri && !coarseFile) {
    throw new TypeError(`Select ${hierarchy.coarseBinaryUri} with the glTF file.`);
  }
  if (coarseFile) validateLocalBinary(hierarchy, coarseFile, "coarse");
  const propertiesRef = hierarchy.properties;
  const sidecarJsonFile = propertiesRef
    ? source.sidecarFiles.find(({ name }) => name === resourceFileName(propertiesRef.uri))
    : undefined;
  const geometryFiles = new Set([targetFile, ...(coarseFile ? [coarseFile] : [])]);
  const extraBinaries = source.binaryFiles.filter((file) => !geometryFiles.has(file));
  const allowedExtraBinaries = sidecarJsonFile ? 1 : 0;
  if (extraBinaries.length > allowedExtraBinaries) {
    const expectedResourceCount = geometryFiles.size + allowedExtraBinaries;
    throw new TypeError(
      `The glTF declares ${expectedResourceCount} external binary ` +
        `${expectedResourceCount === 1 ? "resource" : "resources"}.`,
    );
  }
  return {
    document,
    hierarchy,
    targetBinary: { kind: "file", file: targetFile },
    ...(coarseFile ? { coarseBinary: { kind: "file" as const, file: coarseFile } } : {}),
    ...(propertiesRef && sidecarJsonFile
      ? {
          properties: {
            kind: "file" as const,
            ref: propertiesRef,
            jsonFile: sidecarJsonFile,
            resourceFiles: extraBinaries,
          },
        }
      : {}),
    label: [source.gltfFile, ...source.binaryFiles].map(({ name }) => name).join(" + "),
  };
}
