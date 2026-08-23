import { inspectCompiledHierarchy } from "@madi/runtime-webgpu";
import type { CompiledGltfDocument, CompiledHierarchy } from "@madi/runtime-webgpu";

export interface UrlSceneSource {
  readonly kind: "url";
  readonly gltfUrl: URL;
}

export interface LocalSceneSource {
  readonly kind: "local";
  readonly gltfFile: File;
  readonly binaryFile: File;
}

export type SceneSource = UrlSceneSource | LocalSceneSource;

export type GeometryBinarySource =
  | { readonly kind: "url"; readonly href: string }
  | { readonly kind: "file"; readonly file: File };

export interface LoadedSceneHierarchy {
  readonly document: CompiledGltfDocument;
  readonly hierarchy: CompiledHierarchy;
  readonly binary: GeometryBinarySource;
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
      !file.name.toLocaleLowerCase("en-US").endsWith(".bin"),
  );
  const gltfFiles = files.filter((file) =>
    file.name.toLocaleLowerCase("en-US").endsWith(".gltf"),
  );
  const binaryFiles = files.filter((file) =>
    file.name.toLocaleLowerCase("en-US").endsWith(".bin"),
  );
  if (unsupported.length > 0 || gltfFiles.length !== 1 || binaryFiles.length !== 1) {
    throw new TypeError("Select exactly one .gltf file and its one .bin resource.");
  }
  const gltfFile = gltfFiles[0];
  const binaryFile = binaryFiles[0];
  if (!gltfFile || !binaryFile) throw new TypeError("The local scene pair is incomplete.");
  return { kind: "local", gltfFile, binaryFile };
}

export function validateLocalBinary(
  hierarchy: CompiledHierarchy,
  binaryFile: Pick<File, "name" | "size">,
): void {
  const binaryUrl = new URL(hierarchy.binaryUri, "https://madi.local/");
  const expectedName = decodeURIComponent(binaryUrl.pathname.split("/").pop() ?? "");
  if (binaryFile.name !== expectedName) {
    throw new TypeError(
      `The glTF expects ${expectedName}; selected binary is ${binaryFile.name}.`,
    );
  }
  if (binaryFile.size !== hierarchy.binaryByteLength) {
    throw new TypeError(
      `${binaryFile.name} must be ${hierarchy.binaryByteLength.toLocaleString("en-US")} bytes; ` +
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

export async function loadSceneHierarchy(source: SceneSource): Promise<LoadedSceneHierarchy> {
  if (source.kind === "url") {
    const response = await fetch(source.gltfUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load compiled hierarchy (${response.status}).`);
    }
    const { document, hierarchy } = inspectCompiledHierarchy(await response.json());
    return {
      document,
      hierarchy,
      binary: { kind: "url", href: new URL(hierarchy.binaryUri, source.gltfUrl).href },
      label: source.gltfUrl.href,
    };
  }

  const { document, hierarchy } = inspectCompiledHierarchy(
    parseJson(await source.gltfFile.text(), source.gltfFile.name),
  );
  validateLocalBinary(hierarchy, source.binaryFile);
  return {
    document,
    hierarchy,
    binary: { kind: "file", file: source.binaryFile },
    label: `${source.gltfFile.name} + ${source.binaryFile.name}`,
  };
}
