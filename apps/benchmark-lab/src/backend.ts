import { Phase0Renderer } from "@madi/runtime-webgpu";

import type { BenchmarkCamera } from "./camera.js";
import type { IndustrialWorkload } from "./workload.js";

export type BenchmarkBackendId = "madi" | "three";

export interface BenchmarkBackend {
  readonly id: BenchmarkBackendId;
  render(camera: BenchmarkCamera): Promise<void>;
  stats(): { readonly logicalDrawCalls: number; readonly submittedTriangles: number };
  dispose(): void;
}

async function createMadiBackend(
  canvas: HTMLCanvasElement,
  workload: IndustrialWorkload,
): Promise<BenchmarkBackend> {
  const renderer = await Phase0Renderer.create(canvas, { pixelRatio: 1 });
  renderer.setScene(workload.scene, { includeEdges: false });
  return {
    id: "madi",
    render(camera) {
      renderer.render(camera.viewProjection, { edges: false });
      return Promise.resolve();
    },
    stats: () => ({
      logicalDrawCalls: workload.stats.prototypeCount,
      submittedTriangles: workload.stats.submittedTriangleCount,
    }),
    dispose: () => renderer.destroy(),
  };
}

async function createThreeBackend(
  canvas: HTMLCanvasElement,
  workload: IndustrialWorkload,
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

  for (const batch of workload.scene.batches) {
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
    geometries.push(geometry);

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

  return {
    id: "three",
    async render(state) {
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
    stats: () => ({
      logicalDrawCalls: workload.stats.prototypeCount,
      submittedTriangles: workload.stats.submittedTriangleCount,
    }),
    dispose() {
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
): Promise<BenchmarkBackend> {
  return id === "madi"
    ? createMadiBackend(canvas, workload)
    : createThreeBackend(canvas, workload);
}
