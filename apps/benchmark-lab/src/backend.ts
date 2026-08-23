import { Phase0Renderer } from "@madi/runtime-webgpu";

import type { BenchmarkCamera } from "./camera.js";
import { DenseFrustumCuller } from "./culling.js";
import { GpuFrameTimer } from "./gpu-timing.js";
import { adapterTimestampPeriodNs } from "./gpu-timing.js";
import type { GpuFrameTiming } from "./gpu-timing.js";
import type { IndustrialWorkload } from "./workload.js";

export type BenchmarkBackendId = "madi" | "three";
export type BenchmarkCullingMode = "disabled" | "frustum";

export interface BenchmarkRendererStats {
  readonly logicalDrawCalls: number;
  readonly visibleSubdraws: number;
  readonly unculledSubmittedTriangles: number;
  readonly visibleOccurrences: number;
  readonly visibleTriangles: number;
  readonly cullingImplementation: "none" | "dense-cpu-compaction" | "three-batched-mesh";
}

export interface BenchmarkMemoryMeasurement {
  readonly bytes: number | null;
  readonly durationMs: number;
}

export type BenchmarkMemoryProbe = () => Promise<BenchmarkMemoryMeasurement>;

export interface BenchmarkRetainedResources {
  readonly scope: "backend-owned-scene-upload-resources";
  /** CPU typed arrays the backend itself allocated and still retains. */
  readonly cpuBytes: number;
  /** GPU scene-upload buffer bytes. Exact for MADI, a constructed floor for Three.js. */
  readonly gpuBytes: number;
  readonly gpuAttachmentPx: readonly [number, number] | null;
  readonly accounting:
    | "exact-allocator-census"
    | "constructed-floor-three-internals-not-enumerable";
}

export interface BenchmarkBackend {
  readonly id: BenchmarkBackendId;
  readonly coreReadyMemory: BenchmarkMemoryMeasurement | null;
  readonly retainedResources: BenchmarkRetainedResources;
  render(camera: BenchmarkCamera): Promise<void>;
  stats(): BenchmarkRendererStats;
  /** Restarts GPU frame timing, for example between warmup and sampling. */
  resetGpuFrameTiming(): void;
  /** Resolves recorded GPU pass timestamps once sampling has finished. */
  gpuFrameTiming(): Promise<GpuFrameTiming>;
  dispose(): void;
}

function visibleTriangles(workload: IndustrialWorkload, counts: Uint32Array): number {
  return workload.scene.batches.reduce(
    (total, batch, index) =>
      total + (batch.surfaceIndices.length / 3) * (counts[index] ?? 0),
    0,
  );
}

async function createMadiBackend(
  canvas: HTMLCanvasElement,
  workload: IndustrialWorkload,
  culling: BenchmarkCullingMode,
  memoryProbe?: BenchmarkMemoryProbe,
): Promise<BenchmarkBackend> {
  const renderer = await Phase0Renderer.create(canvas, {
    pixelRatio: 1,
    requestTimestampQueries: true,
  });
  const coreReadyMemory = memoryProbe ? await memoryProbe() : null;
  renderer.setScene(workload.scene, { includeEdges: false });
  const gpuTimer = GpuFrameTimer.create(
    renderer.device,
    adapterTimestampPeriodNs(renderer.adapter),
  );
  const culler = culling === "frustum" ? new DenseFrustumCuller(workload) : undefined;
  let currentVisibleOccurrences = workload.stats.occurrenceCount;
  let currentVisibleTriangles = workload.stats.submittedTriangleCount;
  let currentVisibleSubdraws = workload.stats.prototypeCount;
  return {
    id: "madi",
    coreReadyMemory,
    get retainedResources() {
      const stats = renderer.resourceStats();
      return {
        scope: "backend-owned-scene-upload-resources" as const,
        cpuBytes: stats.cpuStagingBytes,
        gpuBytes: stats.gpuBufferBytes,
        gpuAttachmentPx: stats.attachmentSizePx,
        accounting: "exact-allocator-census" as const,
      };
    },
    render(camera) {
      if (culler) {
        const visibility = culler.cull(camera.viewProjection);
        renderer.updateVisibleInstances(visibility.indicesByBatch, visibility.counts);
        currentVisibleOccurrences = visibility.visibleOccurrences;
        currentVisibleTriangles = visibleTriangles(workload, visibility.counts);
        currentVisibleSubdraws = visibility.counts.reduce(
          (count, visible) => count + (visible > 0 ? 1 : 0),
          0,
        );
      }
      const timestampWrites = gpuTimer?.writes() ?? null;
      renderer.render(camera.viewProjection, {
        edges: false,
        ...(timestampWrites ? { timestampWrites } : {}),
      });
      if (timestampWrites && gpuTimer) gpuTimer.markSubmitted();
      return Promise.resolve();
    },
    stats: () => ({
      logicalDrawCalls: workload.stats.prototypeCount,
      visibleSubdraws: currentVisibleSubdraws,
      unculledSubmittedTriangles: workload.stats.submittedTriangleCount,
      visibleOccurrences: currentVisibleOccurrences,
      visibleTriangles: currentVisibleTriangles,
      cullingImplementation: culler ? "dense-cpu-compaction" : "none",
    }),
    resetGpuFrameTiming: () => gpuTimer?.reset(),
    gpuFrameTiming: async () => {
      const resolved = await gpuTimer?.resolve();
      return resolved ?? { supported: false as const, reason: "timestamp-query-unsupported" as const };
    },
    dispose: () => {
      gpuTimer?.dispose();
      renderer.destroy();
    },
  };
}

async function createThreeBackend(
  canvas: HTMLCanvasElement,
  workload: IndustrialWorkload,
  culling: BenchmarkCullingMode,
  memoryProbe?: BenchmarkMemoryProbe,
): Promise<BenchmarkBackend> {
  const THREE = await import("three/webgpu");
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.94, 0.96, 0.98);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.65);
  keyLight.position.set(0.3, 0.5, 1);
  scene.add(keyLight);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10_000);
  camera.up.set(0, 0, 1);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
  let backendCpuBytes = 0;
  let backendGpuFloorBytes = 0;
  let batchedMeshGpuFloorBytes = 0;
  let batchedMesh = undefined as InstanceType<typeof THREE.BatchedMesh> | undefined;
  const coreReadyMemory = memoryProbe ? await memoryProbe() : null;

  if (culling === "frustum") {
    const maxVertexCount = workload.scene.batches.reduce(
      (total, batch) => total + batch.surfaceVertices.length / 6,
      0,
    );
    const maxIndexCount = workload.scene.batches.reduce(
      (total, batch) => total + batch.surfaceIndices.length,
      0,
    );
    batchedMesh = new THREE.BatchedMesh(
      workload.stats.occurrenceCount,
      maxVertexCount,
      maxIndexCount,
      material,
    );
    // Conservative floor for the batch upload reservation Three.js allocates:
    // 24 bytes per vertex (position + normal), 4 bytes per index, and one
    // 64-byte instance matrix plus 12-byte instance color per occurrence.
    batchedMeshGpuFloorBytes =
      maxVertexCount * 24 + maxIndexCount * 4 + workload.stats.occurrenceCount * (64 + 12);
    batchedMesh.perObjectFrustumCulled = true;
    batchedMesh.sortObjects = true;
    scene.add(batchedMesh);
  }

  for (const [batchIndex, batch] of workload.scene.batches.entries()) {
    const vertexCount = batch.surfaceVertices.length / 6;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const source = vertex * 6;
      const target = vertex * 3;
      positions.set(batch.surfaceVertices.subarray(source, source + 3), target);
      normals.set(batch.surfaceVertices.subarray(source + 3, source + 6), target);
    }
    backendCpuBytes += positions.byteLength + normals.byteLength;
    backendGpuFloorBytes += positions.byteLength + normals.byteLength;
    // The index stream uploads to the GPU even though the CPU array is a
    // shared workload reference rather than a backend-owned copy.
    backendGpuFloorBytes += batch.surfaceIndices.byteLength;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(batch.surfaceIndices, 1));
    geometry.computeBoundingSphere();
    const sharedRadius = workload.instanceBounds[batchIndex]?.[3];
    if (sharedRadius !== undefined) {
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), sharedRadius);
    }
    geometries.push(geometry);

    if (batchedMesh) {
      const geometryId = batchedMesh.addGeometry(geometry);
      for (const instance of batch.instances) {
        const instanceId = batchedMesh.addInstance(geometryId);
        matrix.fromArray(instance.transform);
        batchedMesh.setMatrixAt(instanceId, matrix);
        const baseColor = instance.baseColor ?? [0.16, 0.55, 0.92, 1];
        color.setRGB(baseColor[0], baseColor[1], baseColor[2]);
        batchedMesh.setColorAt(instanceId, color);
      }
      continue;
    }

    const mesh = new THREE.InstancedMesh(geometry, material, batch.instances.length);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    batch.instances.forEach((instance, index) => {
      matrix.fromArray(instance.transform);
      mesh.setMatrixAt(index, matrix);
      const baseColor = instance.baseColor ?? [0.16, 0.55, 0.92, 1];
      color.setRGB(baseColor[0], baseColor[1], baseColor[2]);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    backendCpuBytes += mesh.instanceMatrix.array.byteLength;
    backendGpuFloorBytes += mesh.instanceMatrix.array.byteLength;
    if (mesh.instanceColor) {
      backendCpuBytes += mesh.instanceColor.array.byteLength;
      backendGpuFloorBytes += mesh.instanceColor.array.byteLength;
    }
    scene.add(mesh);
  }
  batchedMesh?.computeBoundingSphere();
  backendGpuFloorBytes += batchedMeshGpuFloorBytes;

  const attachmentPx: readonly [number, number] = [
    Math.max(1, Math.floor(canvas.clientWidth)),
    Math.max(1, Math.floor(canvas.clientHeight)),
  ];

  let lastCamera: BenchmarkCamera | undefined;
  return {
    id: "three",
    coreReadyMemory,
    retainedResources: {
      scope: "backend-owned-scene-upload-resources",
      cpuBytes: backendCpuBytes,
      gpuBytes: backendGpuFloorBytes,
      gpuAttachmentPx: attachmentPx,
      accounting: "constructed-floor-three-internals-not-enumerable",
    },
    async render(state) {
      lastCamera = state;
      camera.aspect = state.aspect;
      camera.fov = (state.fovRadians * 180) / Math.PI;
      camera.near = state.near;
      camera.far = state.far;
      camera.position.set(...state.position);
      camera.up.set(...state.up);
      camera.lookAt(...state.target);
      camera.updateProjectionMatrix();
      await renderer.renderAsync(scene, camera);
    },
    stats: () => {
      const visibility = lastCamera && culling === "frustum"
        ? new DenseFrustumCuller(workload).cull(lastCamera.viewProjection)
        : undefined;
      const inspection = batchedMesh as unknown as
        | { readonly _multiDrawCount: number; readonly _multiDrawCounts: Int32Array }
        | undefined;
      const observedSubdraws = inspection?._multiDrawCount;
      let observedTriangles = 0;
      if (inspection && observedSubdraws !== undefined) {
        for (let index = 0; index < observedSubdraws; index += 1) {
          observedTriangles += (inspection._multiDrawCounts[index] ?? 0) / 3;
        }
      }
      return {
        logicalDrawCalls: batchedMesh ? 1 : workload.stats.prototypeCount,
        visibleSubdraws: observedSubdraws ?? workload.stats.prototypeCount,
        unculledSubmittedTriangles: workload.stats.submittedTriangleCount,
        visibleOccurrences:
          observedSubdraws ?? visibility?.visibleOccurrences ?? workload.stats.occurrenceCount,
        visibleTriangles: inspection
          ? observedTriangles
          : visibility
            ? visibleTriangles(workload, visibility.counts)
            : workload.stats.submittedTriangleCount,
        cullingImplementation: batchedMesh ? "three-batched-mesh" : "none",
      };
    },
    resetGpuFrameTiming: () => undefined,
    gpuFrameTiming: async () => ({
      supported: false as const,
      reason: "backend-not-instrumented" as const,
    }),
    dispose() {
      batchedMesh?.dispose();
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}

export function createBenchmarkBackend(
  id: BenchmarkBackendId,
  canvas: HTMLCanvasElement,
  workload: IndustrialWorkload,
  culling: BenchmarkCullingMode = "disabled",
  memoryProbe?: BenchmarkMemoryProbe,
): Promise<BenchmarkBackend> {
  return id === "madi"
    ? createMadiBackend(canvas, workload, culling, memoryProbe)
    : createThreeBackend(canvas, workload, culling, memoryProbe);
}
