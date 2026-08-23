export interface BenchmarkCamera {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly aspect: number;
  readonly fovRadians: number;
  readonly near: number;
  readonly far: number;
  readonly viewProjection: Float32Array;
}

type Vector3 = readonly [number, number, number];
export type BenchmarkCameraTrace = "overview-orbit" | "local-review";

function subtract(left: Vector3, right: Vector3): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3, right: Vector3): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector: Vector3): [number, number, number] {
  const length = Math.hypot(...vector);
  if (length <= Number.EPSILON) throw new RangeError("Cannot normalize a zero vector.");
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function multiply(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += (left[inner * 4 + row] ?? 0) * (right[column * 4 + inner] ?? 0);
      }
      result[column * 4 + row] = value;
    }
  }
  return result;
}

function createView(position: Vector3, target: Vector3, up: Vector3): Float32Array {
  const backward = normalize(subtract(position, target));
  const right = normalize(cross(up, backward));
  const cameraUp = cross(backward, right);
  return new Float32Array([
    right[0], cameraUp[0], backward[0], 0,
    right[1], cameraUp[1], backward[1], 0,
    right[2], cameraUp[2], backward[2], 0,
    -dot(right, position), -dot(cameraUp, position), -dot(backward, position), 1,
  ]);
}

function createWebGpuPerspective(
  fovRadians: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const focal = 1 / Math.tan(fovRadians / 2);
  return new Float32Array([
    focal / aspect, 0, 0, 0,
    0, focal, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ]);
}

export function createBenchmarkCamera(
  bounds: { readonly min: Vector3; readonly max: Vector3 },
  aspect: number,
  progress: number,
  trace: BenchmarkCameraTrace = "overview-orbit",
): BenchmarkCamera {
  const sceneCenter: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const diagonal = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  const center: [number, number, number] = trace === "local-review"
    ? [
        bounds.min[0] + (bounds.max[0] - bounds.min[0]) * (0.15 + progress * 0.7),
        sceneCenter[1] + Math.sin(progress * Math.PI * 2) * (bounds.max[1] - bounds.min[1]) * 0.2,
        sceneCenter[2],
      ]
    : sceneCenter;
  const angle = progress * Math.PI * 2;
  const distance = trace === "local-review"
    ? Math.max(180, Math.min(340, diagonal * 0.28))
    : Math.max(diagonal * 0.72, 20);
  const position: [number, number, number] = [
    center[0] + Math.cos(angle) * distance,
    center[1] + Math.sin(angle) * distance,
    center[2] + (trace === "local-review" ? distance * 0.45 : diagonal * 0.32),
  ];
  const up: [number, number, number] = [0, 0, 1];
  const fovRadians = Math.PI / 4;
  const near = Math.max(0.1, diagonal / 10_000);
  const far = Math.max(100, diagonal * 4);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const view = createView(position, center, up);
  const projection = createWebGpuPerspective(fovRadians, safeAspect, near, far);
  return {
    position,
    target: center,
    up,
    aspect: safeAspect,
    fovRadians,
    near,
    far,
    viewProjection: multiply(projection, view),
  };
}
