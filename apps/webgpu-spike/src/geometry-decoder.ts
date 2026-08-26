import type {
  DecodedCompiledScene,
  GeometryRepresentation,
} from "@naru3d/runtime-webgpu";

import type {
  GeometryWorkerRequest,
  GeometryWorkerResponse,
} from "./geometry.worker.js";
import type { GeometryBinarySource, GeometryDocumentSource } from "./scene-source.js";

export interface GeometryDecodeResult {
  readonly scene: DecodedCompiledScene;
  readonly coarseInstanceTargetMeshIndexes?: Uint32Array;
  readonly decodeMilliseconds: number;
}

interface PendingRequest {
  readonly resolve: (response: GeometryWorkerResponse) => void;
  readonly reject: (error: Error) => void;
}

/** Owns one parsed glTF document in one Worker for the full scene session. */
export class GeometryDecoder {
  private readonly worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), {
    type: "module",
    name: "naru-compiled-geometry",
  });
  private readonly pending = new Map<number, PendingRequest>();
  private readonly signal: AbortSignal;
  private readonly initialized: Promise<void>;
  private nextRequestId = 0;
  private disposed = false;

  constructor(source: GeometryDocumentSource, signal: AbortSignal) {
    this.signal = signal;
    this.worker.addEventListener("message", this.receive);
    this.worker.addEventListener("error", this.failWorker);
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) {
      const error = new DOMException("Scene load cancelled.", "AbortError");
      this.dispose(error);
      this.initialized = Promise.reject(error);
      void this.initialized.catch(() => undefined);
      return;
    }
    const transfer = source.kind === "bytes" ? [source.bytes] : [];
    this.initialized = this.request(
      { type: "initialize", requestId: this.requestId(), source },
      transfer,
    ).then((response) => {
      if (response.type !== "initialized") {
        throw new Error("The geometry Worker returned an invalid initialization response.");
      }
    });
    // Initialization starts in parallel with WebGPU adapter/device creation.
    // Keep the rejection observed until decode() forwards it to the load path.
    void this.initialized.catch(() => undefined);
  }

  async decode(
    binary: GeometryBinarySource,
    representation: GeometryRepresentation,
    targetChunkId?: string,
  ): Promise<GeometryDecodeResult> {
    await this.initialized;
    const response = await this.request({
      type: "decode",
      requestId: this.requestId(),
      binary,
      representation,
      ...(targetChunkId ? { targetChunkId } : {}),
    });
    if (response.type !== "ready") {
      throw new Error("The geometry Worker returned an invalid decode response.");
    }
    return {
      scene: response.scene,
      ...(response.coarseInstanceTargetMeshIndexes
        ? { coarseInstanceTargetMeshIndexes: response.coarseInstanceTargetMeshIndexes }
        : {}),
      decodeMilliseconds: response.decodeMilliseconds,
    };
  }

  dispose(reason: Error = new Error("The geometry decoder was disposed.")): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signal.removeEventListener("abort", this.abort);
    this.worker.removeEventListener("message", this.receive);
    this.worker.removeEventListener("error", this.failWorker);
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }

  private readonly abort = (): void => {
    this.dispose(new DOMException("Scene load cancelled.", "AbortError"));
  };

  private readonly receive = (event: MessageEvent<GeometryWorkerResponse>): void => {
    const pending = this.pending.get(event.data.requestId);
    if (!pending) return;
    this.pending.delete(event.data.requestId);
    if (event.data.type === "error") pending.reject(new Error(event.data.message));
    else pending.resolve(event.data);
  };

  private readonly failWorker = (event: ErrorEvent): void => {
    this.dispose(new Error(event.message || "The geometry Worker failed."));
  };

  private request(
    message: GeometryWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<GeometryWorkerResponse> {
    if (this.disposed) {
      return Promise.reject(new DOMException("Scene load cancelled.", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject });
      try {
        this.worker.postMessage(message, transfer);
      } catch (error) {
        this.pending.delete(message.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private requestId(): number {
    this.nextRequestId += 1;
    return this.nextRequestId;
  }
}
