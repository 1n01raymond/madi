import {
  compiledSceneTransferables,
  decodeCompiledGltf,
} from "@madi/runtime-webgpu";
import type {
  CompiledGltfDocument,
  DecodedCompiledScene,
  GeometryRepresentation,
} from "@madi/runtime-webgpu";
import type { GeometryBinarySource } from "./scene-source.js";

interface GeometryDecodeRequest {
  readonly type: "decode";
  readonly document: CompiledGltfDocument;
  readonly binary: GeometryBinarySource;
  readonly representation: GeometryRepresentation;
  readonly targetChunkId?: string;
}

export type GeometryDecodeResponse =
  | {
      readonly type: "ready";
      readonly scene: DecodedCompiledScene;
      readonly decodeMilliseconds: number;
    }
  | {
      readonly type: "error";
      readonly message: string;
    };

interface WorkerHost {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GeometryDecodeRequest>) => void,
  ): void;
  postMessage(message: GeometryDecodeResponse, transfer?: readonly Transferable[]): void;
}

const worker = globalThis as unknown as WorkerHost;

worker.addEventListener("message", (event) => {
  if (event.data.type !== "decode") return;
  void decode(event.data);
});

async function decode(request: GeometryDecodeRequest): Promise<void> {
  try {
    const startedAt = performance.now();
    let binary: ArrayBuffer;
    if (request.binary.kind === "url") {
      const range = request.binary.byteOffset === undefined || request.binary.byteLength === undefined
        ? undefined
        : `bytes=${request.binary.byteOffset}-${request.binary.byteOffset + request.binary.byteLength - 1}`;
      const response = await fetch(request.binary.href, {
        cache: "no-store",
        ...(range ? { headers: { Range: range } } : {}),
      });
      if (!response.ok) {
        throw new Error(`Failed to load compiled geometry (${response.status}).`);
      }
      binary = await response.arrayBuffer();
      if (range && request.binary.byteOffset !== undefined && request.binary.byteLength !== undefined) {
        if (response.status === 206) {
          const expectedEnd = request.binary.byteOffset + request.binary.byteLength - 1;
          const contentRange = response.headers.get("Content-Range");
          const parsedRange = contentRange
            ? /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(contentRange)
            : undefined;
          if (
            binary.byteLength !== request.binary.byteLength ||
            !parsedRange ||
            Number(parsedRange[1]) !== request.binary.byteOffset ||
            Number(parsedRange[2]) !== expectedEnd ||
            Number(parsedRange[3]) <= expectedEnd
          ) {
            throw new Error("Partial geometry response does not match the requested range.");
          }
        } else if (
          response.status === 200 &&
          binary.byteLength >= request.binary.byteOffset + request.binary.byteLength
        ) {
          binary = binary.slice(
            request.binary.byteOffset,
            request.binary.byteOffset + request.binary.byteLength,
          );
        } else if (binary.byteLength !== request.binary.byteLength) {
          throw new Error("Geometry host ignored Range without returning the complete buffer.");
        }
      }
    } else {
      binary = request.binary.byteOffset === undefined || request.binary.byteLength === undefined
        ? await request.binary.file.arrayBuffer()
        : await request.binary.file
            .slice(
              request.binary.byteOffset,
              request.binary.byteOffset + request.binary.byteLength,
            )
            .arrayBuffer();
    }
    const scene = decodeCompiledGltf(request.document, binary, {
      representation: request.representation,
      ...(request.targetChunkId ? { targetChunkId: request.targetChunkId } : {}),
    });
    worker.postMessage(
      {
        type: "ready",
        scene,
        decodeMilliseconds: performance.now() - startedAt,
      },
      compiledSceneTransferables(scene),
    );
  } catch (error) {
    worker.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
