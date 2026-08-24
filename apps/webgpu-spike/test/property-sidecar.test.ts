import { describe, expect, it } from "vitest";

import { formatPropertyValue, resourceFileName } from "../src/property-sidecar.js";

describe("property sidecar helpers", () => {
  it("formats every property value shape for the inspector panel", () => {
    expect(formatPropertyValue(null)).toBe("null");
    expect(formatPropertyValue(true)).toBe("true");
    expect(formatPropertyValue(21.5)).toBe("21.5");
    expect(formatPropertyValue("Concrete")).toBe("Concrete");
    expect(formatPropertyValue({ type: "quantity", value: 2.4, unit: "m" })).toBe("2.4 m");
    expect(formatPropertyValue({ type: "enum", value: "EXTERNAL", schema: "IFC4" })).toBe(
      "EXTERNAL",
    );
    expect(formatPropertyValue({ type: "uri", value: "https://example.com/spec" })).toBe(
      "https://example.com/spec",
    );
    expect(
      formatPropertyValue({
        type: "array",
        values: [1, { type: "quantity", value: 3, unit: "mm" }],
      }),
    ).toBe("1, 3 mm");
  });

  it("resolves resource file names from relative package URIs", () => {
    expect(resourceFileName("properties.json")).toBe("properties.json");
    expect(resourceFileName("data/properties.bin")).toBe("properties.bin");
    expect(resourceFileName("value%20columns.bin")).toBe("value columns.bin");
  });
});
