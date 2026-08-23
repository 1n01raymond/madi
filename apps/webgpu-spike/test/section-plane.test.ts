import { describe, expect, it } from "vitest";

import { AxisSectionPlane } from "../src/section-plane.js";

const bounds = { min: [-10, 2, 100], max: [30, 12, 300] } as const;

describe("axis section plane", () => {
  it("starts disabled at the middle of the Z extent", () => {
    const section = new AxisSectionPlane(bounds);

    expect(section.plane()).toBeUndefined();
    expect(section.state()).toEqual({
      enabled: false,
      axis: "z",
      direction: 1,
      fraction: 0.5,
      minimum: 100,
      maximum: 300,
      offset: 200,
    });
  });

  it("maps normalized slider positions onto each world axis", () => {
    const section = new AxisSectionPlane(bounds);
    section.setEnabled(true);
    section.setAxis("x");
    section.setFraction(0.25);

    expect(section.plane()).toEqual({ normal: [1, 0, 0], offset: 0 });
    expect(section.state().fraction).toBe(0.25);

    section.flip();
    expect(section.plane()).toEqual({ normal: [-1, 0, 0], offset: 0 });
  });

  it("clamps finite slider positions and rejects invalid state", () => {
    const section = new AxisSectionPlane(bounds);

    section.setFraction(2);
    expect(section.state().fraction).toBe(1);
    section.setFraction(-1);
    expect(section.state().fraction).toBe(0);
    expect(() => section.setFraction(Number.NaN)).toThrow(/must be finite/u);
    expect(() => section.setAxis("w" as "x")).toThrow(/Unsupported section axis/u);
  });

  it("rejects unordered bounds", () => {
    expect(
      () => new AxisSectionPlane({ min: [1, 0, 0], max: [-1, 1, 1] }),
    ).toThrow(/ordered finite values/u);
  });
});
