import {
  compiledSceneTransferables,
  prepareCompiledGltfDecoder,
} from "@naru3d/runtime-webgpu";
import type {
  DecodedCompiledScene,
  GeometryRepresentation,
  PreparedCompiledGltfDecoder,
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
    }
  | {
      readonly type: "cancel";
      /** Request id of the in-flight decode whose fetch should be aborted. */
      readonly requestId: number;
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
      readonly name?: string;
    };

interface WorkerHost {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GeometryWorkerRequest>) => void,
  ): void;
  postMessage(message: GeometryWorkerResponse, transfer?: readonly Transferable[]): void;
}

const worker = globalThis as unknown as WorkerHost;
let compiledDecoder: PreparedCompiledGltfDecoder | undefined;
const activeDecodes = new Map<number, AbortController>();

worker.addEventListener("message", (event) => {
  if (event.data.type === "cancel") {
    activeDecodes.get(event.data.requestId)?.abort();
    return;
  }
  void handleRequest(event.data);
});

async function handleRequest(
  request: Exclude<GeometryWorkerRequest, { readonly type: "cancel" }>,
): Promise<void> {
  try {
    if (request.type === "initialize") {
      const text = request.source.kind === "bytes"
        ? new TextDecoder().decode(request.source.bytes)
        : await request.source.file.text();
      compiledDecoder = prepareCompiledGltfDecoder(JSON.parse(text) as unknown);
      worker.postMessage({ type: "initialized", requestId: request.requestId });
      return;
    }
    await decode(request);
  } catch (error) {
    worker.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error ? { name: error.name } : {}),
    });
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Obsolete target request.", "AbortError");
}

async function loadBinary(
  source: GeometryBinarySource,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  if (source.kind === "file") {
    const binary = await (source.byteOffset === undefined || source.byteLength === undefined
      ? source.file.arrayBuffer()
      : source.file
          .slice(source.byteOffset, source.byteOffset + source.byteLength)
          .arrayBuffer());
    throwIfAborted(signal);
    return binary;
  }

  const range = source.byteOffset === undefined || source.byteLength === undefined
    ? undefined
    : `bytes=${source.byteOffset}-${source.byteOffset + source.byteLength - 1}`;
  const response = await fetch(source.href, {
    cache: "no-store",
    signal,
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
  if (!compiledDecoder) throw new Error("The geometry Worker is not initialized.");
  const cancellation = new AbortController();
  activeDecodes.set(request.requestId, cancellation);
  try {
    const startedAt = performance.now();
    const binary = await loadBinary(request.binary, cancellation.signal);
    throwIfAborted(cancellation.signal);
    const decoded = compiledDecoder.decode(binary, {
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
  } finally {
    activeDecodes.delete(request.requestId);
  }
}
