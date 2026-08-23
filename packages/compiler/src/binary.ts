import type { GltfAccessor, GltfBufferView } from "./types.js";

export class GltfBinaryBuilder {
  readonly bufferViews: GltfBufferView[];
  readonly accessors: GltfAccessor[];
  readonly #bufferIndex: number;
  readonly #chunks: { readonly offset: number; readonly bytes: Uint8Array }[] = [];
  #byteLength = 0;

  get byteLength(): number {
    return this.#byteLength;
  }

  constructor(options: {
    readonly bufferIndex?: number;
    readonly bufferViews?: GltfBufferView[];
    readonly accessors?: GltfAccessor[];
  } = {}) {
    this.#bufferIndex = options.bufferIndex ?? 0;
    this.bufferViews = options.bufferViews ?? [];
    this.accessors = options.accessors ?? [];
  }

  append(
    bytes: Uint8Array,
    options: {
      readonly componentType: GltfAccessor["componentType"];
      readonly count: number;
      readonly type: GltfAccessor["type"];
      readonly target?: GltfBufferView["target"];
      readonly name?: string;
      readonly min?: readonly number[];
      readonly max?: readonly number[];
    },
  ): number {
    if (bytes.byteLength === 0) throw new RangeError("glTF buffer views may not be empty.");
    const padding = (4 - (this.#byteLength % 4)) % 4;
    this.#byteLength += padding;
    const bufferView = this.bufferViews.length;
    this.bufferViews.push({
      buffer: this.#bufferIndex,
      byteOffset: this.#byteLength,
      byteLength: bytes.byteLength,
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.name === undefined ? {} : { name: options.name }),
    });
    this.#chunks.push({ offset: this.#byteLength, bytes });
    this.#byteLength += bytes.byteLength;

    const accessor = this.accessors.length;
    this.accessors.push({
      bufferView,
      componentType: options.componentType,
      count: options.count,
      type: options.type,
      ...(options.min === undefined ? {} : { min: options.min }),
      ...(options.max === undefined ? {} : { max: options.max }),
      ...(options.name === undefined ? {} : { name: options.name }),
    });
    return accessor;
  }

  finish(): Uint8Array {
    const result = new Uint8Array(this.#byteLength);
    for (const chunk of this.#chunks) result.set(chunk.bytes, chunk.offset);
    return result;
  }
}

export function encodeFloat32(values: Iterable<number>, scale = 1): Uint8Array {
  const source = Array.from(values, (value) => Math.fround(value * scale));
  const bytes = new Uint8Array(source.length * 4);
  const view = new DataView(bytes.buffer);
  source.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

export function encodeUint32(values: Iterable<number>): Uint8Array {
  const source = Array.from(values);
  const bytes = new Uint8Array(source.length * 4);
  const view = new DataView(bytes.buffer);
  source.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

export function encodeUint8(values: Iterable<number>): Uint8Array {
  return Uint8Array.from(values);
}

export function scaledPositionBounds(
  values: ArrayLike<number>,
  scale: number,
): { readonly min: readonly number[]; readonly max: readonly number[] } {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = Math.fround((values[index + axis] ?? 0) * scale);
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    }
  }
  return { min, max };
}
