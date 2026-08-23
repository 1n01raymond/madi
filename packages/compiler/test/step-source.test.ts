import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inspectStepBytes, inspectStepFile } from "../src/step-source.js";

function source(schema: string): Uint8Array {
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\nFILE_SCHEMA((\n'${schema}'\n));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
}

describe("STEP source preflight", () => {
  it("identifies the committed AP242 assembly fixture", async () => {
    const inspection = await inspectStepFile(
      fileURLToPath(
        new URL("../../../fixtures/step/repeated-fasteners-ap242.step", import.meta.url),
      ),
    );

    expect(inspection).toMatchObject({
      displayName: "repeated-fasteners-ap242.step",
      schema: "AP242",
      sha256: "87b7909984c635ffc02c61211b22380252d455ebbf7c8e18ab68a2d2f7ac4da3",
    });
    expect(inspection.schemaIdentifiers[0]).toMatch(/^AP242_MANAGED_MODEL/iu);
  });

  it("keeps AP214 compatibility for the canonical public fixture", () => {
    expect(
      inspectStepBytes(
        source("AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }"),
        "assembly.stp",
      ).schema,
    ).toBe("AP214");
  });

  it("rejects non-Part-21, unsupported-schema, and mislabeled inputs", () => {
    expect(() => inspectStepBytes(new TextEncoder().encode("not STEP"), "part.step")).toThrow(
      /Part 21/u,
    );
    expect(() => inspectStepBytes(source("CONFIG_CONTROL_DESIGN"), "part.step")).toThrow(
      /Unsupported STEP schema/u,
    );
    expect(() => inspectStepBytes(source("AP242_MANAGED_MODEL"), "part.txt")).toThrow(
      /.step or .stp/u,
    );
  });
});
