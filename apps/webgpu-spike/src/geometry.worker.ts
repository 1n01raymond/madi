import {
  compiledSceneTransferables,
  decodeCompiledGltf,
  parseCompiledGltf,
} from "@naru3d/runtime-webgpu";
import type {
  CompiledGltfDocument,
  DecodedCompiledScene,
  GeometryRepresentation,
} from "@naru3d/runtime-webgpu";

import { aggregateCoarseScene } from "./coarse-aggregation.js";
import type { GeometryBinarySource, GeometryDocumentSource } from "./scene-source.js";

export type GeometryWorkerRequest =
  | {
      readonly type: "initialize";
      readonly requestId: number;
      readonly source: GeometryDocumentSource;
    }
  | {
      readonly type: "decode";
      readonly requestId: number;
      readonly binary: GeometryBinarySource;
      readonly representation: GeometryRepresentation;
      readonly targetChunkId?: string;
    };

export type GeometryWorkerResponse =
  | { readonly type: "initialized"; readonly requestId: number }
  | {
      readonly type: "ready";
      readonly requestId: number;
      readonly scene: DecodedCompiledScene;
      readonly coarseInstanceTargetMeshIndexes?: Uint32Array;
      readonly decodeMilliseconds: number;
    }
  | {
      readonly type: "error";
      readonly requestId: number;
      readonly message: string;
    };

interface WorkerHost {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GeometryWorkerRequest>) => void,
  ): void;
  postMessage(message: GeometryWorkerResponse, transfer?: readonly Transferable[]): void;
}

const worker = globalThis as unknown as WorkerHost;
let compiledDocument: CompiledGltfDocument | undefined;

worker.addEventListener("message", (event) => {
  void handleRequest(event.data);
});

async function handleRequest(request: GeometryWorkerRequest): Promise<void> {
  try {
    if (request.type === "initialize") {
      const text = request.source.kind === "bytes"
        ? new TextDecoder().decode(request.source.bytes)
        : await request.source.file.text();
      compiledDocument = parseCompiledGltf(JSON.parse(text) as unknown);
      worker.postMessage({ type: "initialized", requestId: request.requestId });
      return;
    }
    await decode(request);
  } catch (error) {
    worker.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadBinary(source: GeometryBinarySource): Promise<ArrayBuffer> {
  if (source.kind === "file") {
    return source.byteOffset === undefined || source.byteLength === undefined
      ? source.file.arrayBuffer()
      : source.file
          .slice(source.byteOffset, source.byteOffset + source.byteLength)
          .arrayBuffer();
  }

  const range = source.byteOffset === undefined || source.byteLength === undefined
    ? undefined
    : `bytes=${source.byteOffset}-${source.byteOffset + source.byteLength - 1}`;
  const response = await fetch(source.href, {
    cache: "no-store",
    ...(range ? { headers: { Range: range } } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to load compiled geometry (${response.status}).`);
  }
  let binary = await response.arrayBuffer();
  if (!range || source.byteOffset === undefined || source.byteLength === undefined) {
    return binary;
  }
  if (response.status === 206) {
    const expectedEnd = source.byteOffset + source.byteLength - 1;
    const contentRange = response.headers.get("Content-Range");
    const parsedRange = contentRange
      ? /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(contentRange)
      : undefined;
    if (
      binary.byteLength !== source.byteLength ||
      !parsedRange ||
      Number(parsedRange[1]) !== source.byteOffset ||
      Number(parsedRange[2]) !== expectedEnd ||
      Number(parsedRange[3]) <= expectedEnd
    ) {
      throw new Error("Partial geometry response does not match the requested range.");
    }
  } else if (
    response.status === 200 &&
    binary.byteLength >= source.byteOffset + source.byteLength
  ) {
    binary = binary.slice(source.byteOffset, source.byteOffset + source.byteLength);
  } else if (binary.byteLength !== source.byteLength) {
    throw new Error("Geometry host ignored Range without returning the complete buffer.");
  }
  return binary;
}

async function decode(
  request: Extract<GeometryWorkerRequest, { readonly type: "decode" }>,
): Promise<void> {
  if (!compiledDocument) throw new Error("The geometry Worker is not initialized.");
  const startedAt = performance.now();
  const binary = await loadBinary(request.binary);
  const decoded = decodeCompiledGltf(compiledDocument, binary, {
    representation: request.representation,
    ...(request.targetChunkId ? { targetChunkId: request.targetChunkId } : {}),
  });
  const aggregated = request.representation === "coarse"
    ? aggregateCoarseScene(decoded)
    : undefined;
  const scene = aggregated ?? decoded;
  const transferables = compiledSceneTransferables(scene);
  const coarseInstanceTargetMeshIndexes = aggregated?.coarseInstanceTargetMeshIndexes;
  if (coarseInstanceTargetMeshIndexes?.buffer instanceof ArrayBuffer) {
    transferables.push(coarseInstanceTargetMeshIndexes.buffer);
  }
  worker.postMessage(
    {
      type: "ready",
      requestId: request.requestId,
      scene,
      ...(coarseInstanceTargetMeshIndexes ? { coarseInstanceTargetMeshIndexes } : {}),
      decodeMilliseconds: performance.now() - startedAt,
    },
    transferables,
  );
}
