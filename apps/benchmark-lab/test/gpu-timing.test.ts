import { beforeAll, describe, expect, it } from "vitest";

import { frameDurationsMs, GpuFrameTimer, gpuFrameTimerCapacity } from "../src/gpu-timing.js";

beforeAll(() => {
  const globals = globalThis as unknown as {
    GPUBufferUsage?: Record<string, number>;
    GPUMapMode?: Record<string, number>;
  };
  globals.GPUBufferUsage ??= {
    MAP_READ: 0x0001,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    QUERY_RESOLVE: 0x0020,
  };
  globals.GPUMapMode ??= { READ: 0x0001, WRITE: 0x0002 };
});

function fakeTimestampDevice(supported: boolean): GPUDevice {
  return {
    features: new Set(supported ? ["timestamp-query"] : []),
    createQuerySet: () => ({ destroy() {} }),
    createBuffer: () => ({
      destroy() {},
      mapAsync: async () => {},
      getMappedRange: () => new ArrayBuffer(1024),
      unmap() {},
    }),
    createCommandEncoder: () => ({
      resolveQuerySet: () => {},
      copyBufferToBuffer: () => {},
      finish: () => ({}),
    }),
    queue: { submit: () => {} },
  } as unknown as GPUDevice;
}

function created(timer: GpuFrameTimer | null): GpuFrameTimer {
  if (!timer) throw new TypeError("Expected a timer.");
  return timer;
}

describe("frameDurationsMs", () => {
  it("converts tick deltas through the adapter timestamp period", () => {
    const ticks = BigInt64Array.from([0n, 1000n, 5000n, 15000n]);
    const durations = frameDurationsMs(ticks, 2, 1000);
    expect(durations).toEqual([1, 10]);
  });

  it("drops frames whose end tick precedes the begin tick", () => {
    const ticks = BigInt64Array.from([100n, 50n, 0n, 25n]);
    const durations = frameDurationsMs(ticks, 2, 1000);
    expect(durations).toEqual([0.025]);
  });

  it("stops at missing ticks", () => {
    const ticks = BigInt64Array.from([0n, 10n]);
    const durations = frameDurationsMs(ticks, 3, 1000);
    expect(durations).toEqual([0.01]);
  });
});

describe("GpuFrameTimer", () => {
  it("refuses devices without the timestamp-query feature", () => {
    expect(GpuFrameTimer.create(fakeTimestampDevice(false), 1)).toBeNull();
  });

  it("lends consecutive query pairs until the capacity is saturated", () => {
    const timer = created(GpuFrameTimer.create(fakeTimestampDevice(true), 1, gpuFrameTimerCapacity));
    const first = timer.writes();
    expect(first?.beginningOfPassWriteIndex).toBe(0);
    expect(first?.endOfPassWriteIndex).toBe(1);
    timer.markSubmitted();
    const second = timer.writes();
    expect(second?.beginningOfPassWriteIndex).toBe(2);
    timer.markSubmitted();
  });

  it("resolves recorded frames exactly once", async () => {
    const timer = created(GpuFrameTimer.create(fakeTimestampDevice(true), 1, 2));
    timer.markSubmitted();
    timer.markSubmitted();
    const result = await timer.resolve();
    expect(result?.supported).toBe(true);
    expect(result?.frameMs).toHaveLength(2);
    expect(await timer.resolve()).toBeNull();
  });

  it("stops lending writes once saturated", () => {
    const timer = created(GpuFrameTimer.create(fakeTimestampDevice(true), 1, 2));
    timer.markSubmitted();
    timer.markSubmitted();
    expect(timer.writes()).toBeNull();
  });

  it("resets borrowed frames for a fresh sampling window", () => {
    const timer = created(GpuFrameTimer.create(fakeTimestampDevice(true), 1, 2));
    timer.markSubmitted();
    timer.reset();
    expect(timer.writes()?.beginningOfPassWriteIndex).toBe(0);
  });

  it("rejects non-positive timestamp periods", () => {
    expect(GpuFrameTimer.create(fakeTimestampDevice(true), 0)).toBeNull();
  });
});
