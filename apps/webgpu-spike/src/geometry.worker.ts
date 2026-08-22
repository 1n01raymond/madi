import {
  compiledSceneTransferables,
  decodeCompiledGltf,
} from "@madi/runtime-webgpu";
import type {
  CompiledGltfDocument,
  DecodedCompiledScene,
} from "@madi/runtime-webgpu";

interface GeometryDecodeRequest {
  readonly type: "decode";
  readonly document: CompiledGltfDocument;
  readonly binaryUrl: string;
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
    const response = await fetch(request.binaryUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load compiled geometry (${response.status}).`);
    }
    const scene = decodeCompiledGltf(request.document, await response.arrayBuffer());
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
