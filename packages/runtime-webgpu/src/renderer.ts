import {
  decodeObjectId,
  instanceStride,
  packInstanceData,
  packInstanceDataInto,
  validateGpuScene,
} from "./layout.js";
import type { GpuOccurrenceInstance, GpuPrototypeBatch, GpuScene } from "./layout.js";

const surfaceShader = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) model0: vec4<f32>,
  @location(3) model1: vec4<f32>,
  @location(4) model2: vec4<f32>,
  @location(5) model3: vec4<f32>,
  @location(6) objectId: u32,
  @location(7) baseColor: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) @interpolate(flat) objectId: u32,
  @location(2) @interpolate(flat) baseColor: vec4<f32>,
};

@vertex
fn vsMain(input: VertexInput) -> VertexOutput {
  let model = mat4x4<f32>(input.model0, input.model1, input.model2, input.model3);
  var output: VertexOutput;
  output.position = camera.viewProjection * model * vec4<f32>(input.position, 1.0);
  output.normal = normalize(mat3x3<f32>(input.model0.xyz, input.model1.xyz, input.model2.xyz) * input.normal);
  output.objectId = input.objectId;
  output.baseColor = input.baseColor;
  return output;
}

@fragment
fn fsSurface(input: VertexOutput) -> @location(0) vec4<f32> {
  let light = 0.35 + 0.65 * max(dot(normalize(input.normal), normalize(vec3<f32>(0.3, 0.5, 1.0))), 0.0);
  return vec4<f32>(input.baseColor.rgb * light, input.baseColor.a);
}

@fragment
fn fsPick(input: VertexOutput) -> @location(0) vec4<u32> {
  let id = input.objectId;
  return vec4<u32>(id & 255u, (id >> 8u) & 255u, (id >> 16u) & 255u, (id >> 24u) & 255u);
}
`;

const edgeShader = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(2) model0: vec4<f32>,
  @location(3) model1: vec4<f32>,
  @location(4) model2: vec4<f32>,
  @location(5) model3: vec4<f32>,
  @location(6) objectId: u32,
  @location(7) baseColor: vec4<f32>,
};

@vertex
fn vsMain(input: VertexInput) -> @builtin(position) vec4<f32> {
  let model = mat4x4<f32>(input.model0, input.model1, input.model2, input.model3);
  return camera.viewProjection * model * vec4<f32>(input.position, 1.0);
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.015, 0.035, 0.055, 1.0);
}
`;

const instanceBufferLayout: GPUVertexBufferLayout = {
  arrayStride: instanceStride,
  stepMode: "instance",
  attributes: [
    { shaderLocation: 2, offset: 0, format: "float32x4" },
    { shaderLocation: 3, offset: 16, format: "float32x4" },
    { shaderLocation: 4, offset: 32, format: "float32x4" },
    { shaderLocation: 5, offset: 48, format: "float32x4" },
    { shaderLocation: 6, offset: 64, format: "uint32" },
    { shaderLocation: 7, offset: 80, format: "float32x4" },
  ],
};

export type MadiWebGpuErrorCode =
  | "WEBGPU_UNAVAILABLE"
  | "ADAPTER_UNAVAILABLE"
  | "CONTEXT_UNAVAILABLE"
  | "SCENE_NOT_SET";

export class MadiWebGpuError extends Error {
  readonly code: MadiWebGpuErrorCode;

  constructor(code: MadiWebGpuErrorCode, message: string) {
    super(message);
    this.name = "MadiWebGpuError";
    this.code = code;
  }
}

export interface Phase0RendererOptions {
  readonly onDeviceLost?: (message: string) => void;
  /** Override the browser device pixel ratio for reproducible benchmark profiles. */
  readonly pixelRatio?: number;
}

export interface SetSceneOptions {
  /** Upload explicit CAD edge streams. Defaults to true. */
  readonly includeEdges?: boolean;
}

export interface RenderOptions {
  /** Draw uploaded explicit CAD edge streams. Defaults to true. */
  readonly edges?: boolean;
}

interface GpuBatchResources {
  readonly surfaceVertex: GPUBuffer;
  readonly surfaceIndex: GPUBuffer;
  readonly edgeVertex: GPUBuffer;
  readonly instance: GPUBuffer;
  readonly instances: readonly GpuOccurrenceInstance[];
  readonly instanceStaging: ArrayBuffer;
  readonly instanceStagingView: DataView;
  readonly indexCount: number;
  readonly edgeVertexCount: number;
  instanceCount: number;
}

function createBuffer(
  device: GPUDevice,
  label: string,
  source: ArrayBufferView<ArrayBufferLike> | ArrayBuffer,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const byteLength = source.byteLength;
  const buffer = device.createBuffer({
    label,
    size: Math.max(4, Math.ceil(byteLength / 4) * 4),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  if (byteLength > 0) {
    const sourceBytes =
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const upload = new Uint8Array(sourceBytes);
    device.queue.writeBuffer(buffer, 0, upload);
  }
  return buffer;
}

export class Phase0Renderer {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly cameraBuffer: GPUBuffer;
  private readonly cameraBindGroup: GPUBindGroup;
  private readonly surfacePipeline: GPURenderPipeline;
  private readonly edgePipeline: GPURenderPipeline;
  private readonly pickPipeline: GPURenderPipeline;
  private readonly pixelRatio?: number;
  private readonly lastViewProjection = new Float32Array(16);
  private batches: GpuBatchResources[] = [];
  private hasRendered = false;
  private depthTexture?: GPUTexture;
  private pickTexture?: GPUTexture;
  private targetWidth = 0;
  private targetHeight = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    context: GPUCanvasContext,
    adapter: GPUAdapter,
    device: GPUDevice,
    options: Phase0RendererOptions,
  ) {
    this.canvas = canvas;
    this.context = context;
    this.adapter = adapter;
    this.device = device;
    this.pixelRatio = options.pixelRatio;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      alphaMode: "opaque",
    });

    const surfaceModule = device.createShaderModule({
      label: "MADI surface + picking shader",
      code: surfaceShader,
    });
    const edgeModule = device.createShaderModule({
      label: "MADI explicit edge shader",
      code: edgeShader,
    });
    this.cameraBuffer = device.createBuffer({
      label: "MADI camera",
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      label: "MADI camera bind-group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      label: "MADI pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    });
    this.cameraBindGroup = device.createBindGroup({
      label: "MADI camera bind group",
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });

    const surfaceBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 24,
        stepMode: "vertex",
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
        ],
      },
      instanceBufferLayout,
    ];
    this.surfacePipeline = device.createRenderPipeline({
      label: "MADI shaded surface pipeline",
      layout: pipelineLayout,
      vertex: { module: surfaceModule, entryPoint: "vsMain", buffers: surfaceBuffers },
      fragment: {
        module: surfaceModule,
        entryPoint: "fsSurface",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
    this.pickPipeline = device.createRenderPipeline({
      label: "MADI object ID pipeline",
      layout: pipelineLayout,
      vertex: { module: surfaceModule, entryPoint: "vsMain", buffers: surfaceBuffers },
      fragment: {
        module: surfaceModule,
        entryPoint: "fsPick",
        targets: [{ format: "rgba8uint" }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
    this.edgePipeline = device.createRenderPipeline({
      label: "MADI explicit edge pipeline",
      layout: pipelineLayout,
      vertex: {
        module: edgeModule,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 12,
            stepMode: "vertex",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
          instanceBufferLayout,
        ],
      },
      fragment: {
        module: edgeModule,
        entryPoint: "fsMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "line-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
    });

    void device.lost.then((info) => {
      options.onDeviceLost?.(info.message || info.reason);
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: Phase0RendererOptions = {},
  ): Promise<Phase0Renderer> {
    if (
      options.pixelRatio !== undefined &&
      (!Number.isFinite(options.pixelRatio) || options.pixelRatio <= 0)
    ) {
      throw new RangeError("pixelRatio must be a positive finite number.");
    }
    if (!navigator.gpu) {
      throw new MadiWebGpuError(
        "WEBGPU_UNAVAILABLE",
        "WebGPU is unavailable in this browser.",
      );
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new MadiWebGpuError(
        "ADAPTER_UNAVAILABLE",
        "No compatible WebGPU adapter was found.",
      );
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) {
      device.destroy();
      throw new MadiWebGpuError(
        "CONTEXT_UNAVAILABLE",
        "The canvas could not create a WebGPU context.",
      );
    }
    return new Phase0Renderer(canvas, context, adapter, device, options);
  }

  setScene(
    sceneOrBatch: GpuScene | GpuPrototypeBatch,
    options: SetSceneOptions = {},
  ): void {
    const scene: GpuScene =
      "batches" in sceneOrBatch ? sceneOrBatch : { batches: [sceneOrBatch] };
    validateGpuScene(scene);
    const includeEdges = options.includeEdges ?? true;
    this.destroyBatches();
    this.batches = scene.batches.map((batch, index) => {
      const instanceStaging = new ArrayBuffer(batch.instances.length * instanceStride);
      return {
        surfaceVertex: createBuffer(
          this.device,
          `MADI prototype ${index} surface vertices`,
          batch.surfaceVertices,
          GPUBufferUsage.VERTEX,
        ),
        surfaceIndex: createBuffer(
          this.device,
          `MADI prototype ${index} surface indices`,
          batch.surfaceIndices,
          GPUBufferUsage.INDEX,
        ),
        edgeVertex: createBuffer(
          this.device,
          `MADI prototype ${index} explicit edges`,
          includeEdges ? batch.edgeVertices : new Float32Array(),
          GPUBufferUsage.VERTEX,
        ),
        instance: createBuffer(
          this.device,
          `MADI prototype ${index} occurrences`,
          packInstanceData(batch.instances),
          GPUBufferUsage.VERTEX,
        ),
        instances: batch.instances,
        instanceStaging,
        instanceStagingView: new DataView(instanceStaging),
        indexCount: batch.surfaceIndices.length,
        edgeVertexCount: includeEdges ? batch.edgeVertices.length / 3 : 0,
        instanceCount: batch.instances.length,
      };
    });
  }

  /** Re-packs visible occurrences from dense per-prototype index tables. */
  updateVisibleInstances(
    indicesByBatch: readonly Int32Array[],
    counts: Uint32Array,
  ): void {
    if (indicesByBatch.length !== this.batches.length || counts.length !== this.batches.length) {
      throw new RangeError("Visibility tables must match the uploaded prototype count.");
    }
    this.batches.forEach((batch, batchIndex) => {
      const indices = indicesByBatch[batchIndex];
      const count = counts[batchIndex] ?? 0;
      if (!indices || count > indices.length || count > batch.instances.length) {
        throw new RangeError(`Invalid visibility count for prototype ${batchIndex}.`);
      }
      const byteLength = packInstanceDataInto(
        batch.instances,
        batch.instanceStagingView,
        indices,
        count,
      );
      if (byteLength > 0) {
        this.device.queue.writeBuffer(batch.instance, 0, batch.instanceStaging, 0, byteLength);
      }
      batch.instanceCount = count;
    });
  }

  render(viewProjection: Float32Array, options: RenderOptions = {}): void {
    if (this.batches.length === 0) {
      throw new MadiWebGpuError("SCENE_NOT_SET", "Call setScene before render.");
    }
    if (viewProjection.length !== 16) {
      throw new TypeError("viewProjection must contain 16 float32 values.");
    }
    this.lastViewProjection.set(viewProjection);
    this.hasRendered = true;
    this.ensureTargets();
    if (!this.depthTexture) return;

    this.device.queue.writeBuffer(this.cameraBuffer, 0, viewProjection);
    const encoder = this.device.createCommandEncoder({ label: "MADI frame" });
    const colorView = this.context.getCurrentTexture().createView();
    const depthView = this.depthTexture.createView();

    const surfacePass = encoder.beginRenderPass({
      label: "MADI surfaces and explicit edges",
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.94, g: 0.96, b: 0.98, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    for (const batch of this.batches) {
      if (batch.instanceCount === 0) continue;
      this.bindBatch(surfacePass, this.surfacePipeline, batch);
      surfacePass.drawIndexed(batch.indexCount, batch.instanceCount);
    }
    if (options.edges ?? true) {
      for (const batch of this.batches) {
        if (batch.edgeVertexCount === 0) continue;
        surfacePass.setPipeline(this.edgePipeline);
        surfacePass.setBindGroup(0, this.cameraBindGroup);
        surfacePass.setVertexBuffer(0, batch.edgeVertex);
        surfacePass.setVertexBuffer(1, batch.instance);
        surfacePass.draw(batch.edgeVertexCount, batch.instanceCount);
      }
    }
    surfacePass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  async pick(clientX: number, clientY: number): Promise<number> {
    if (
      !this.pickTexture ||
      !this.depthTexture ||
      !this.hasRendered ||
      this.targetWidth === 0 ||
      this.targetHeight === 0
    ) {
      return 0;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;
    const x = Math.max(
      0,
      Math.min(this.targetWidth - 1, Math.floor(((clientX - rect.left) / rect.width) * this.targetWidth)),
    );
    const y = Math.max(
      0,
      Math.min(this.targetHeight - 1, Math.floor(((clientY - rect.top) / rect.height) * this.targetHeight)),
    );
    this.device.queue.writeBuffer(this.cameraBuffer, 0, this.lastViewProjection);
    const readback = this.device.createBuffer({
      label: "MADI pick readback",
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder({ label: "MADI on-demand pick" });
    const pickPass = encoder.beginRenderPass({
      label: "MADI object ID pass",
      colorAttachments: [
        {
          view: this.pickTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    for (const batch of this.batches) {
      this.bindBatch(pickPass, this.pickPipeline, batch);
      pickPass.drawIndexed(batch.indexCount, batch.instanceCount);
    }
    pickPass.end();
    encoder.copyTextureToBuffer(
      { texture: this.pickTexture, origin: { x, y } },
      { buffer: readback, bytesPerRow: 256 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const id = decodeObjectId(new Uint8Array(readback.getMappedRange(), 0, 4));
    readback.unmap();
    readback.destroy();
    return id;
  }

  destroy(): void {
    this.destroyBatches();
    this.depthTexture?.destroy();
    this.pickTexture?.destroy();
    this.cameraBuffer.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  private bindBatch(
    pass: GPURenderPassEncoder,
    pipeline: GPURenderPipeline,
    batch: GpuBatchResources,
  ): void {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.cameraBindGroup);
    pass.setVertexBuffer(0, batch.surfaceVertex);
    pass.setVertexBuffer(1, batch.instance);
    pass.setIndexBuffer(batch.surfaceIndex, "uint32");
  }

  private ensureTargets(): void {
    const ratio = this.pixelRatio ?? Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (width === this.targetWidth && height === this.targetHeight) return;

    this.canvas.width = width;
    this.canvas.height = height;
    this.targetWidth = width;
    this.targetHeight = height;
    this.depthTexture?.destroy();
    this.pickTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: "MADI depth target",
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.pickTexture = this.device.createTexture({
      label: "MADI object ID target",
      size: [width, height],
      format: "rgba8uint",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  private destroyBatches(): void {
    for (const batch of this.batches) {
      batch.surfaceVertex.destroy();
      batch.surfaceIndex.destroy();
      batch.edgeVertex.destroy();
      batch.instance.destroy();
    }
    this.batches = [];
  }
}
