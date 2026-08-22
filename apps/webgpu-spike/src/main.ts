import { MadiWebGpuError, Phase0Renderer } from "@madi/runtime-webgpu";

import {
  createIsometricCamera,
  hierarchyEntries,
  hydrateEvidenceScene,
  prepareEvidenceScene,
} from "./evidence.js";

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`The Phase 0 spike page is missing ${selector}.`);
  return element;
}

function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

const canvas = requireElement<HTMLCanvasElement>("#viewport");
const status = requireElement<HTMLElement>("#status");
const selection = requireElement<HTMLElement>("#selection");
const hierarchy = requireElement<HTMLOListElement>("#hierarchy");

async function loadEvidence(): Promise<unknown> {
  const response = await fetch("/repeated-fasteners.scene.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load OCCT evidence (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

async function start(): Promise<void> {
  try {
    status.textContent = "Loading OCCT/XDE Scene IR evidence…";
    const scene = hydrateEvidenceScene(await loadEvidence());
    const prepared = prepareEvidenceScene(scene);
    const renderer = await Phase0Renderer.create(canvas, {
      onDeviceLost: (message) => {
        status.textContent = `WebGPU device lost: ${message}`;
        status.dataset.state = "error";
      },
    });
    renderer.setScene(prepared.gpuScene);

    const render = (): void => {
      const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
      renderer.render(createIsometricCamera(prepared.bounds, aspect));
    };
    render();

    status.textContent =
      `OCCT Scene IR ready · ${prepared.summary.prototypeBatches} geometry prototypes · ` +
      `${prepared.summary.partOccurrences} part occurrences`;
    status.dataset.state = "ready";
    setText("#prototype-count", String(prepared.summary.prototypeBatches));
    setText("#occurrence-count", String(prepared.summary.partOccurrences));
    setText("#triangle-count", prepared.summary.triangles.toLocaleString("en-US"));
    setText("#edge-count", prepared.summary.edgeSegments.toLocaleString("en-US"));
    setText("#source-format", scene.documents[0]?.formatVersion ?? "STEP");
    const adapterInfo = renderer.adapter.info;
    setText(
      "#gpu-adapter",
      adapterInfo.description || adapterInfo.vendor || "WebGPU adapter",
    );

    for (const entry of hierarchyEntries(scene)) {
      const item = document.createElement("li");
      item.style.setProperty("--depth", String(entry.depth));
      item.dataset.renderable = String(entry.renderable);
      item.textContent = entry.name;
      hierarchy.append(item);
    }

    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvas);

    canvas.addEventListener("click", async (event) => {
      const objectId = await renderer.pick(event.clientX, event.clientY);
      const evidence = prepared.objectEvidence.get(objectId);
      selection.textContent = evidence
        ? `Selected ${evidence.label} · ID ${objectId} · ${evidence.edgeSourceRefs.length} OCCT edge refs`
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
      error instanceof MadiWebGpuError || error instanceof Error
        ? error.message
        : String(error);
    status.textContent = message;
    status.dataset.state = "error";
  }
}

await start();
