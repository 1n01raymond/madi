import { MadiWebGpuError, Phase0Renderer } from "@madi/runtime-webgpu";
import type { GpuPrototypeBatch } from "@madi/runtime-webgpu";

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`The Phase 0 spike page is missing ${selector}.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#viewport");
const status = requireElement<HTMLElement>("#status");
const selection = requireElement<HTMLElement>("#selection");

const viewProjection = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function transform(x: number, y: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, 0, 1,
  ]);
}

function createBatch(): GpuPrototypeBatch {
  return {
    surfaceVertices: new Float32Array([
      -0.24, -0.22, 0, 0, 0, 1,
       0.24, -0.22, 0, 0, 0, 1,
       0.00,  0.24, 0, 0, 0, 1,
    ]),
    surfaceIndices: new Uint32Array([0, 1, 2]),
    edgeVertices: new Float32Array([
      -0.24, -0.22, 0,  0.24, -0.22, 0,
       0.24, -0.22, 0,  0.00,  0.24, 0,
       0.00,  0.24, 0, -0.24, -0.22, 0,
    ]),
    instances: [
      { transform: transform(-0.34, 0), objectId: 101 },
      { transform: transform(0.34, 0), objectId: 202 },
    ],
  };
}

async function start(): Promise<void> {
  try {
    const renderer = await Phase0Renderer.create(canvas, {
      onDeviceLost: (message) => {
        status.textContent = `WebGPU device lost: ${message}`;
        status.dataset.state = "error";
      },
    });
    renderer.setScene(createBatch());
    renderer.render(viewProjection);
    status.textContent = "WebGPU ready · direct instanced draw";
    status.dataset.state = "ready";

    const resizeObserver = new ResizeObserver(() => renderer.render(viewProjection));
    resizeObserver.observe(canvas);

    canvas.addEventListener("click", async (event) => {
      const objectId = await renderer.pick(event.clientX, event.clientY);
      selection.textContent = objectId
        ? `Selected occurrence object ID ${objectId}`
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
