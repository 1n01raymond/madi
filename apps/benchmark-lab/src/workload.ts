import type {
  GpuOccurrenceInstance,
  GpuPrototypeBatch,
  GpuScene,
} from "@madi/runtime-webgpu";

export const industrialScaleTiers = {
  smoke: 1_000,
  gate: 10_000,
  target: 100_000,
} as const;

export type IndustrialScaleTier = keyof typeof industrialScaleTiers;

interface GeometryData {
  readonly surfaceVertices: Float32Array;
  readonly surfaceIndices: Uint32Array;
  readonly edgeVertices: Float32Array;
}

export interface IndustrialWorkload {
  readonly id: "madi.industrial-pipe-rack.1";
  readonly scale: IndustrialScaleTier;
  readonly scene: GpuScene;
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly stats: {
    readonly prototypeCount: number;
    readonly occurrenceCount: number;
    readonly uniqueTriangleCount: number;
    readonly submittedTriangleCount: number;
    readonly explicitEdgeSegmentCount: number;
    readonly instanceBytes: number;
  };
}

const colors = [
  [0.22, 0.49, 0.7, 1],
  [0.52, 0.57, 0.62, 1],
  [0.88, 0.49, 0.16, 1],
  [0.2, 0.62, 0.44, 1],
] as const;

function pushVertex(
  target: number[],
  position: readonly [number, number, number],
  normal: readonly [number, number, number],
): void {
  target.push(...position, ...normal);
}

function pushLine(
  target: number[],
  start: readonly [number, number, number],
  end: readonly [number, number, number],
): void {
  target.push(...start, ...end);
}

function createCylinderX(length: number, radius: number, segments: number): GeometryData {
  const vertices: number[] = [];
  const indices: number[] = [];
  const edges: number[] = [];
  const half = length / 2;

  for (let segment = 0; segment < segments; segment += 1) {
    const angle0 = (segment / segments) * Math.PI * 2;
    const angle1 = ((segment + 1) / segments) * Math.PI * 2;
    const y0 = Math.cos(angle0) * radius;
    const z0 = Math.sin(angle0) * radius;
    const y1 = Math.cos(angle1) * radius;
    const z1 = Math.sin(angle1) * radius;
    const base = vertices.length / 6;
    pushVertex(vertices, [-half, y0, z0], [0, Math.cos(angle0), Math.sin(angle0)]);
    pushVertex(vertices, [half, y0, z0], [0, Math.cos(angle0), Math.sin(angle0)]);
    pushVertex(vertices, [half, y1, z1], [0, Math.cos(angle1), Math.sin(angle1)]);
    pushVertex(vertices, [-half, y1, z1], [0, Math.cos(angle1), Math.sin(angle1)]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

    for (const x of [-half, half]) {
      const capBase = vertices.length / 6;
      const normal: [number, number, number] = [Math.sign(x), 0, 0];
      pushVertex(vertices, [x, 0, 0], normal);
      if (x > 0) {
        pushVertex(vertices, [x, y0, z0], normal);
        pushVertex(vertices, [x, y1, z1], normal);
      } else {
        pushVertex(vertices, [x, y1, z1], normal);
        pushVertex(vertices, [x, y0, z0], normal);
      }
      indices.push(capBase, capBase + 1, capBase + 2);
    }

    pushLine(edges, [-half, y0, z0], [-half, y1, z1]);
    pushLine(edges, [half, y0, z0], [half, y1, z1]);
    if (segment % Math.max(1, Math.floor(segments / 4)) === 0) {
      pushLine(edges, [-half, y0, z0], [half, y0, z0]);
    }
  }

  return {
    surfaceVertices: new Float32Array(vertices),
    surfaceIndices: new Uint32Array(indices),
    edgeVertices: new Float32Array(edges),
  };
}

function createBox(
  size: readonly [number, number, number],
  center: readonly [number, number, number] = [0, 0, 0],
): GeometryData {
  const [width, height, depth] = size;
  const [cx, cy, cz] = center;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  const faces: readonly [
    readonly [number, number, number],
    readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ],
  ][] = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [normal, corners] of faces) {
    const base = vertices.length / 6;
    for (const corner of corners) pushVertex(vertices, corner, normal);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const corners: readonly [number, number, number][] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const edgeIndices = [
    0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
  ];
  const edges: number[] = [];
  for (let index = 0; index < edgeIndices.length; index += 2) {
    const start = corners[edgeIndices[index] ?? 0];
    const end = corners[edgeIndices[index + 1] ?? 0];
    if (start && end) pushLine(edges, start, end);
  }
  return {
    surfaceVertices: new Float32Array(vertices),
    surfaceIndices: new Uint32Array(indices),
    edgeVertices: new Float32Array(edges),
  };
}

function combineGeometry(parts: readonly GeometryData[]): GeometryData {
  const vertices: number[] = [];
  const indices: number[] = [];
  const edges: number[] = [];
  for (const part of parts) {
    const vertexOffset = vertices.length / 6;
    vertices.push(...part.surfaceVertices);
    for (const index of part.surfaceIndices) indices.push(index + vertexOffset);
    edges.push(...part.edgeVertices);
  }
  return {
    surfaceVertices: new Float32Array(vertices),
    surfaceIndices: new Uint32Array(indices),
    edgeVertices: new Float32Array(edges),
  };
}

function createTransform(
  x: number,
  y: number,
  z: number,
  orientation: number,
): Float32Array {
  const quarterTurn = orientation % 3;
  if (quarterTurn === 1) {
    return new Float32Array([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  }
  if (quarterTurn === 2) {
    return new Float32Array([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, x, y, z, 1]);
  }
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function prototypeForOccurrence(index: number): number {
  const slot = index % 20;
  if (slot < 12) return 0;
  if (slot < 16) return 1;
  if (slot < 19) return 2;
  return 3;
}

export function createIndustrialWorkload(scale: IndustrialScaleTier): IndustrialWorkload {
  const occurrenceCount = industrialScaleTiers[scale];
  const geometries = [
    createCylinderX(3, 0.18, 28),
    createCylinderX(0.32, 0.5, 32),
    combineGeometry([
      createBox([0.9, 0.75, 0.75]),
      createBox([0.18, 0.18, 0.75], [0, 0, 0.65]),
      createBox([0.9, 0.14, 0.14], [0, 0, 1.02]),
    ]),
    createCylinderX(2.4, 0.7, 32),
  ];
  const instances = geometries.map(() => [] as GpuOccurrenceInstance[]);
  const rackSize = 100;
  const columns = 20;
  const levels = 5;
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;

  for (let index = 0; index < occurrenceCount; index += 1) {
    const prototype = prototypeForOccurrence(index);
    const rack = Math.floor(index / rackSize);
    const local = index % rackSize;
    const module = Math.floor(rack / 100);
    const rackInModule = rack % 100;
    const moduleX = module % 4;
    const moduleY = Math.floor(module / 4);
    const rackColumn = Math.floor(rackInModule / 10);
    const rackRow = rackInModule % 10;
    const column = local % columns;
    const level = Math.floor(local / columns) % levels;
    const x = moduleX * 700 + rackColumn * 70 + column * 3.2;
    const y = moduleY * 100 + rackRow * 8 + (prototype === 3 ? 2.2 : 0);
    const z = level * 2.5 + (prototype === 2 ? 0.3 : 0);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    instances[prototype]?.push({
      transform: createTransform(x, y, z, index + prototype),
      objectId: index + 1,
      baseColor: colors[prototype],
    });
  }

  const batches: GpuPrototypeBatch[] = geometries.map((geometry, index) => ({
    ...geometry,
    instances: instances[index] ?? [],
  }));
  const uniqueTriangleCount = geometries.reduce(
    (total, geometry) => total + geometry.surfaceIndices.length / 3,
    0,
  );
  const submittedTriangleCount = batches.reduce(
    (total, batch) => total + (batch.surfaceIndices.length / 3) * batch.instances.length,
    0,
  );
  const explicitEdgeSegmentCount = batches.reduce(
    (total, batch) => total + (batch.edgeVertices.length / 6) * batch.instances.length,
    0,
  );
  return {
    id: "madi.industrial-pipe-rack.1",
    scale,
    scene: { batches },
    bounds: {
      min: [-2, -2, -2],
      max: [maxX + 2, maxY + 2, maxZ + 2],
    },
    stats: {
      prototypeCount: batches.length,
      occurrenceCount,
      uniqueTriangleCount,
      submittedTriangleCount,
      explicitEdgeSegmentCount,
      instanceBytes: occurrenceCount * 96,
    },
  };
}
