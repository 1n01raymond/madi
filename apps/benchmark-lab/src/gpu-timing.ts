/**
 * Caller-owned GPU timestamp instrumentation for benchmark passes.
 *
 * The timer owns one timestamp query set sized for `capacity` timed frames.
 * Each frame borrows a consecutive query pair through writes(); the frame loop
 * resolves every recorded pair once after sampling completes, so per-frame
 * readback never stalls the render loop. Timestamps cover only the passes the
 * caller attaches the writes to, not the full frame.
 */

export interface GpuFrameTimingResult {
  readonly supported: true;
  /** Adapter timestamp period in nanoseconds, as reported by the browser. */
  readonly timestampPeriodNs: number;
  /** Per-frame GPU pass duration in milliseconds, in submission order. */
  readonly frameMs: readonly number[];
}

export interface GpuFrameTimingUnsupported {
  readonly supported: false;
  readonly reason: "timestamp-query-unsupported" | "backend-not-instrumented";
}

export type GpuFrameTiming = GpuFrameTimingResult | GpuFrameTimingUnsupported;

/** Converts resolved begin/end ticks into per-frame durations in milliseconds. */
export function frameDurationsMs(
  ticks: Readonly<BigInt64Array>,
  timedFrames: number,
  timestampPeriodNs: number,
): number[] {
  const durations: number[] = [];
  for (let frame = 0; frame < timedFrames; frame += 1) {
    const begin = ticks[frame * 2];
    const end = ticks[frame * 2 + 1];
    if (begin === undefined || end === undefined) break;
    if (end < begin) continue;
    durations.push(Number(end - begin) * (timestampPeriodNs / 1_000_000));
  }
  return durations;
}

export const gpuFrameTimerCapacity = 256;

/**
 * Reads the adapter timestamp period in nanoseconds. The typed WebGPU
 * definitions trail the shipped property, so a missing declaration falls back
 * to a one-nanosecond period and the value is recorded with the results.
 */
export function adapterTimestampPeriodNs(adapter: GPUAdapter): number {
  const period = (adapter as GPUAdapter & { readonly timestampPeriod?: number })
    .timestampPeriod;
  return Number.isFinite(period) && (period as number) > 0 ? (period as number) : 1;
}

export class GpuFrameTimer {
  private cursor = 0;
  private resolved = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly timestampPeriodNs: number,
    private readonly querySet: GPUQuerySet,
    private readonly resolveBuffer: GPUBuffer,
    private readonly readBuffer: GPUBuffer,
    private readonly capacity: number,
  ) {}

  /** Returns null when the device lacks the timestamp-query feature. */
  static create(
    device: GPUDevice,
    timestampPeriodNs: number,
    capacity: number = gpuFrameTimerCapacity,
  ): GpuFrameTimer | null {
    if (!Number.isFinite(timestampPeriodNs) || timestampPeriodNs <= 0) return null;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("GPU frame timer capacity must be a positive integer.");
    }
    if (!device.features.has("timestamp-query")) return null;
    const queryCount = capacity * 2;
    const byteLength = queryCount * 8;
    const querySet = device.createQuerySet({
      label: "MADI benchmark timestamp queries",
      type: "timestamp",
      count: queryCount,
    });
    const resolveBuffer = device.createBuffer({
      label: "MADI benchmark timestamp resolve",
      size: byteLength,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const readBuffer = device.createBuffer({
      label: "MADI benchmark timestamp readback",
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    return new GpuFrameTimer(
      device,
      timestampPeriodNs,
      querySet,
      resolveBuffer,
      readBuffer,
      capacity,
    );
  }

  /** Borrow the timestamp writes for the next rendered frame, or null when saturated. */
  writes(): GPURenderPassTimestampWrites | null {
    if (this.cursor >= this.capacity) return null;
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: this.cursor * 2,
      endOfPassWriteIndex: this.cursor * 2 + 1,
    };
  }

  /** Marks the borrowed writes as submitted and advances the ring. */
  markSubmitted(): void {
    if (this.cursor < this.capacity) this.cursor += 1;
  }

  /** Discards recorded frames so sampling can restart, for example after warmup. */
  reset(): void {
    this.cursor = 0;
  }

  /**
   * Resolves every recorded frame once. The returned durations cover only the
   * frames whose writes the caller attached and marked submitted.
   */
  async resolve(): Promise<GpuFrameTimingResult | null> {
    if (this.resolved || this.cursor === 0) return null;
    this.resolved = true;
    const used = this.cursor * 2;
    const encoder = this.device.createCommandEncoder({
      label: "MADI benchmark timestamp resolve",
    });
    encoder.resolveQuerySet(this.querySet, 0, used, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, used * 8);
    this.device.queue.submit([encoder.finish()]);
    await this.readBuffer.mapAsync(GPUMapMode.READ);
    const ticks = new BigInt64Array(this.readBuffer.getMappedRange(), 0, used);
    const frameMs = frameDurationsMs(ticks, this.cursor, this.timestampPeriodNs);
    this.readBuffer.unmap();
    return { supported: true, timestampPeriodNs: this.timestampPeriodNs, frameMs };
  }

  dispose(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readBuffer.destroy();
  }
}
