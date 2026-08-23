import { Phase0Renderer } from "@madi/runtime-webgpu";

import type { BenchmarkCamera } from "./camera.js";
import { DenseFrustumCuller } from "./culling.js";
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

export interface BenchmarkBackend {
  readonly id: BenchmarkBackendId;
  render(camera: BenchmarkCamera): Promise<void>;
  stats(): BenchmarkRendererStats;
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
): Promise<BenchmarkBackend> {
  const renderer = await Phase0Renderer.create(canvas, { pixelRatio: 1 });
  renderer.setScene(workload.scene, { includeEdges: false });
  const culler = culling === "frustum" ? new DenseFrustumCuller(workload) : undefined;
  let currentVisibleOccurrences = workload.stats.occurrenceCount;
  let currentVisibleTriangles = workload.stats.submittedTriangleCount;
  let currentVisibleSubdraws = workload.stats.prototypeCount;
  return {
    id: "madi",
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
      renderer.render(camera.viewProjection, { edges: false });
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
    dispose: () => renderer.destroy(),
  };
}

async function createThreeBackend(
  canvas: HTMLCanvasElement,
  workload: IndustrialWorkload,
  culling: BenchmarkCullingMode,
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
  let batchedMesh: InstanceType<typeof THREE.BatchedMesh> | undefined;

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
    scene.add(mesh);
  }
  batchedMesh?.computeBoundingSphere();

  let lastCamera: BenchmarkCamera | undefined;
  return {
    id: "three",
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
): Promise<BenchmarkBackend> {
  return id === "madi"
    ? createMadiBackend(canvas, workload, culling)
    : createThreeBackend(canvas, workload, culling);
}
