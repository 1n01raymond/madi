import { describe, expect, it } from "vitest";

import { hierarchyRowWindow } from "../src/hierarchy-list.js";

/** The sixty5 federation renders this many rows; see artifacts/ifc/sixty5-first-frame. */
const SIXTY5_ROWS = 188_319;

describe("hierarchy row window", () => {
  it("covers the scrollport plus overscan on both sides", () => {
    const window = hierarchyRowWindow(1_000, 270, 390, 27, 6);

    expect(window.start).toBe(4);
    expect(window.end).toBe(32);
    expect(window.leadingRows).toBe(4);
    expect(window.trailingRows).toBe(968);
  });

  it("clamps the leading overscan at the top of the list", () => {
    const window = hierarchyRowWindow(1_000, 0, 390, 27, 6);

    expect(window.start).toBe(0);
    expect(window.leadingRows).toBe(0);
    expect(window.end).toBe(28);
  });

  it("stops at the last row when scrolled to the bottom", () => {
    const window = hierarchyRowWindow(100, 100 * 27, 390, 27, 6);

    expect(window.end).toBe(100);
    expect(window.trailingRows).toBe(0);
    expect(window.start).toBeLessThan(100);
  });

  it("materializes a bounded slice of a federation-sized list", () => {
    const window = hierarchyRowWindow(SIXTY5_ROWS, 1_000_000, 390, 27, 6);

    expect(window.end - window.start).toBe(28);
    expect(window.leadingRows + (window.end - window.start) + window.trailingRows).toBe(
      SIXTY5_ROWS,
    );
  });

  it("renders nothing for an empty list or an unmeasured row height", () => {
    expect(hierarchyRowWindow(0, 0, 390, 27, 6)).toEqual({
      start: 0,
      end: 0,
      leadingRows: 0,
      trailingRows: 0,
    });
    expect(hierarchyRowWindow(1_000, 0, 390, 0, 6).end).toBe(0);
  });

  it("ignores an overscrolled or negative scroll offset", () => {
    expect(hierarchyRowWindow(1_000, -500, 390, 27, 6).start).toBe(0);
    expect(hierarchyRowWindow(10, 10_000, 390, 27, 6).start).toBe(9);
  });
});
