import type { SceneBounds, SectionPlane } from "@naru3d/runtime-webgpu";

export type SectionAxis = "x" | "y" | "z";

export interface AxisSectionState {
  readonly enabled: boolean;
  readonly axis: SectionAxis;
  readonly direction: 1 | -1;
  readonly fraction: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly offset: number;
}

const axisIndex: Readonly<Record<SectionAxis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };
const axisNormal: Readonly<Record<SectionAxis, readonly [number, number, number]>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function isSectionAxis(value: string): value is SectionAxis {
  return value === "x" || value === "y" || value === "z";
}

/** Bounds-aware Studio state for one axis-aligned section plane. */
export class AxisSectionPlane {
  private enabled = false;
  private axis: SectionAxis = "z";
  private direction: 1 | -1 = 1;
  private fraction = 0.5;

  constructor(private readonly bounds: SceneBounds) {
    const values = [...bounds.min, ...bounds.max];
    if (
      values.some((value) => !Number.isFinite(value)) ||
      bounds.min.some((value, index) => value > (bounds.max[index] ?? -Infinity))
    ) {
      throw new TypeError("Section bounds must contain ordered finite values.");
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  toggle(): void {
    this.enabled = !this.enabled;
  }

  setAxis(axis: SectionAxis): void {
    if (!isSectionAxis(axis)) throw new TypeError(`Unsupported section axis ${axis}.`);
    this.axis = axis;
  }

  flip(): void {
    this.direction = this.direction === 1 ? -1 : 1;
  }

  setFraction(fraction: number): void {
    if (!Number.isFinite(fraction)) throw new TypeError("Section fraction must be finite.");
    this.fraction = Math.min(1, Math.max(0, fraction));
  }

  state(): AxisSectionState {
    const index = axisIndex[this.axis];
    const minimum = this.bounds.min[index];
    const maximum = this.bounds.max[index];
    const offset = minimum + (maximum - minimum) * this.fraction;
    return {
      enabled: this.enabled,
      axis: this.axis,
      direction: this.direction,
      fraction: this.fraction,
      minimum,
      maximum,
      offset,
    };
  }

  plane(): SectionPlane | undefined {
    if (!this.enabled) return undefined;
    const state = this.state();
    const normal = axisNormal[state.axis];
    const signedOffset = state.offset * state.direction;
    return {
      normal: [
        normal[0] === 0 ? 0 : normal[0] * state.direction,
        normal[1] === 0 ? 0 : normal[1] * state.direction,
        normal[2] === 0 ? 0 : normal[2] * state.direction,
      ],
      offset: signedOffset === 0 ? 0 : signedOffset,
    };
  }
}
