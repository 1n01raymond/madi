import type { SceneBounds } from "@madi/runtime-webgpu";

function boundsCorners(bounds: SceneBounds): number[][] {
  const corners: number[][] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
    }
  }
  return corners;
}

function dot(axis: readonly number[], point: readonly number[]): number {
  return (
    (axis[0] ?? 0) * (point[0] ?? 0) +
    (axis[1] ?? 0) * (point[1] ?? 0) +
    (axis[2] ?? 0) * (point[2] ?? 0)
  );
}

/** Fits a right-handed, Y-up glTF scene into WebGPU's 0..1 depth range. */
export function createCompiledSceneCamera(
  bounds: SceneBounds,
  aspect: number,
): Float32Array {
  const right = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const up = [1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6)];
  const depth = [-1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const corners = boundsCorners(bounds);
  const projectedX = corners.map((corner) => dot(right, corner));
  const projectedY = corners.map((corner) => dot(up, corner));
  const projectedDepth = corners.map((corner) => dot(depth, corner));
  const minX = Math.min(...projectedX);
  const maxX = Math.max(...projectedX);
  const minY = Math.min(...projectedY);
  const maxY = Math.max(...projectedY);
  const minDepth = Math.min(...projectedDepth);
  const maxDepth = Math.max(...projectedDepth);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  let halfWidth = Math.max((maxX - minX) * 0.58, 0.001);
  let halfHeight = Math.max((maxY - minY) * 0.58, 0.001);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (halfWidth / halfHeight < safeAspect) halfWidth = halfHeight * safeAspect;
  else halfHeight = halfWidth / safeAspect;
  const depthPadding = Math.max((maxDepth - minDepth) * 0.08, 0.001);
  const nearDepth = minDepth - depthPadding;
  const depthRange = Math.max(maxDepth - minDepth + depthPadding * 2, 0.001);

  return new Float32Array([
    (right[0] ?? 0) / halfWidth,
    (up[0] ?? 0) / halfHeight,
    (depth[0] ?? 0) / depthRange,
    0,
    (right[1] ?? 0) / halfWidth,
    (up[1] ?? 0) / halfHeight,
    (depth[1] ?? 0) / depthRange,
    0,
    (right[2] ?? 0) / halfWidth,
    (up[2] ?? 0) / halfHeight,
    (depth[2] ?? 0) / depthRange,
    0,
    -centerX / halfWidth,
    -centerY / halfHeight,
    -nearDepth / depthRange,
    1,
  ]);
}
