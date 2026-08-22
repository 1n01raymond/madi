import {
  CompiledGltfError,
  MadiWebGpuError,
  MadiWebGpuRenderer,
  inspectCompiledHierarchy,
} from "@madi/runtime-webgpu";
import type {
  CompiledGltfDocument,
  CompiledHierarchy,
  DecodedCompiledScene,
} from "@madi/runtime-webgpu";

import type { GeometryDecodeResponse } from "./geometry.worker.js";
import { createCompiledSceneCamera } from "./view.js";

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`The MADI runtime page is missing ${selector}.`);
  return element;
}

function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function loadCompiledHierarchy(gltfUrl: URL): Promise<{
  readonly document: CompiledGltfDocument;
  readonly hierarchy: CompiledHierarchy;
}> {
  const response = await fetch(gltfUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load compiled hierarchy (${response.status}).`);
  return inspectCompiledHierarchy(await response.json());
}

function decodeGeometry(
  document: CompiledGltfDocument,
  binaryUrl: URL,
): Promise<{ readonly scene: DecodedCompiledScene; readonly decodeMilliseconds: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), {
      type: "module",
      name: "madi-compiled-geometry",
    });
    const finish = (): void => worker.terminate();
    worker.addEventListener(
      "message",
      (event: MessageEvent<GeometryDecodeResponse>) => {
        finish();
        if (event.data.type === "ready") resolve(event.data);
        else reject(new Error(event.data.message));
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      (event) => {
        finish();
        reject(new Error(event.message || "The geometry Worker failed."));
      },
      { once: true },
    );
    worker.postMessage({ type: "decode", document, binaryUrl: binaryUrl.href });
  });
}

function renderHierarchy(hierarchy: CompiledHierarchy): void {
  const list = requireElement<HTMLOListElement>("#hierarchy");
  const fragment = document.createDocumentFragment();
  for (const entry of hierarchy.entries) {
    const item = document.createElement("li");
    item.style.setProperty("--depth", String(entry.depth));
    item.dataset.renderable = String(entry.renderable);
    item.dataset.nodeIndex = String(entry.nodeIndex);
    item.title = entry.occurrenceId;

    const label = document.createElement("span");
    label.textContent = entry.name;
    const kind = document.createElement("small");
    kind.textContent = entry.renderable ? `mesh · node ${entry.nodeIndex}` : "assembly";
    item.append(label, kind);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
}

const canvas = requireElement<HTMLCanvasElement>("#viewport");
const status = requireElement<HTMLElement>("#status");
const selection = requireElement<HTMLElement>("#selection");

async function start(): Promise<void> {
  const gltfUrl = new URL("/scene.gltf", window.location.href);
  try {
    status.textContent = "Loading compiled glTF hierarchy…";
    status.dataset.state = "loading";
    const { document: gltf, hierarchy } = await loadCompiledHierarchy(gltfUrl);
    renderHierarchy(hierarchy);
    setText("#prototype-count", String(hierarchy.sharedMeshes));
    setText("#occurrence-count", String(hierarchy.renderableOccurrences));
    setText("#source-format", hierarchy.sourceFormat);
    setText("#binary-size", formatBytes(hierarchy.binaryByteLength));
    setText("#hierarchy-result", `${hierarchy.entries.length} occurrence records ready`);
    requireElement<HTMLElement>("#stage-hierarchy").dataset.state = "ready";
    document.documentElement.dataset.hierarchyReady = "true";
    status.textContent =
      `Hierarchy ready · ${hierarchy.entries.length} occurrences · ` +
      `decoding ${formatBytes(hierarchy.binaryByteLength)} in Worker…`;
    status.dataset.stage = "hierarchy";

    const binaryUrl = new URL(hierarchy.binaryUri, gltfUrl);
    const rendererPromise = MadiWebGpuRenderer.create(canvas, {
      onDeviceLost: (message) => {
        status.textContent = `WebGPU device lost: ${message}`;
        status.dataset.state = "error";
      },
    });
    const [{ scene, decodeMilliseconds }, renderer] = await Promise.all([
      decodeGeometry(gltf, binaryUrl),
      rendererPromise,
    ]);
    renderer.setScene(scene.gpuScene);

    const render = (): void => {
      const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      renderer.render(createCompiledSceneCamera(scene.bounds, aspect));
    };
    render();

    status.textContent =
      `Compiled glTF ready · ${scene.summary.prototypeBatches} shared meshes · ` +
      `${scene.summary.partOccurrences} renderable occurrences`;
    status.dataset.state = "ready";
    status.dataset.stage = "rendered";
    setText("#triangle-count", scene.summary.triangles.toLocaleString("en-US"));
    setText("#edge-count", scene.summary.edgeSegments.toLocaleString("en-US"));
    setText("#decode-time", `${decodeMilliseconds.toFixed(1)} ms`);
    setText("#geometry-result", `${formatBytes(scene.summary.binaryBytes)} decoded off-thread`);
    requireElement<HTMLElement>("#stage-geometry").dataset.state = "ready";
    requireElement<HTMLElement>("#stage-webgpu").dataset.state = "ready";
    const adapterInfo = renderer.adapter.info;
    setText(
      "#gpu-adapter",
      adapterInfo.description || adapterInfo.vendor || "WebGPU adapter",
    );

    const evidence = new Map(scene.objectEvidence.map((entry) => [entry.objectId, entry]));
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvas);

    canvas.addEventListener("click", async (event) => {
      const objectId = await renderer.pick(event.clientX, event.clientY);
      const picked = evidence.get(objectId);
      selection.textContent = picked
        ? `Selected ${picked.label} · node ${picked.nodeIndex} · ID ${objectId} · ` +
          `${picked.edgeSourceRefs.length} CAD edge refs`
        : "No occurrence at that pixel.";
    });

    window.addEventListener(
      "beforeunload",
      () => {
        resizeObserver.disconnect();
        renderer.destroy();
      },
      { once: true },
    );
  } catch (error) {
    const message =
      error instanceof CompiledGltfError ||
      error instanceof MadiWebGpuError ||
      error instanceof Error
        ? error.message
        : String(error);
    status.textContent = message;
    status.dataset.state = "error";
  }
}

await start();
