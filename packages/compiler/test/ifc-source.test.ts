import { describe, expect, it } from "vitest";

import { inspectIfcBytes } from "../src/ifc-source.js";

function source(schema: string): Uint8Array {
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('${schema}'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
}

describe("IFC source preflight", () => {
  it.each([
    ["IFC2X3", "IFC2X3"],
    ["IFC4", "IFC4"],
    ["IFC4X3_ADD2", "IFC4X3"],
  ] as const)("identifies %s", (schema, expected) => {
    expect(inspectIfcBytes(source(schema), "model.ifc")).toMatchObject({
      displayName: "model.ifc",
      schema: expected,
      schemaIdentifiers: [schema],
    });
  });

  it("rejects mislabeled, non-Part-21, and unsupported IFC sources", () => {
    expect(() => inspectIfcBytes(source("IFC4"), "model.step")).toThrow(/.ifc/u);
    expect(() => inspectIfcBytes(new TextEncoder().encode("not IFC"), "model.ifc")).toThrow(
      /Part 21/u,
    );
    expect(() => inspectIfcBytes(source("IFC5"), "model.ifc")).toThrow(
      /Unsupported IFC schema/u,
    );
  });
});
