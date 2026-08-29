import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { measureJsonDocument } from "../src/json-document.js";

function reference(value: unknown, indent: number): Buffer {
  return Buffer.from(`${JSON.stringify(value, undefined, indent)}\n`, "utf8");
}

/** Large enough to cross the writer's internal chunk threshold several times. */
function astralDocument(): unknown {
  return {
    // Astral characters are two UTF-16 units and four UTF-8 bytes, so a chunk
    // boundary that fell inside one would corrupt the document's bytes.
    entries: Array.from({ length: 60_000 }, (_, at) => ({
      name: `\u{1f9f1} block ${at} \u{10437}`,
      tag: "\u2028\u2029\u00e9",
    })),
  };
}

describe("measured JSON document", () => {
  it("reports the digest and length of the bytes JSON.stringify would produce", () => {
    for (const indent of [0, 2]) {
      const value = { b: 1, a: [true, null, "x"], nested: { deep: { value: -0 } } };
      const document = measureJsonDocument(value, indent);
      const expected = reference(value, indent);

      expect(document.bytes).toBe(expected.byteLength);
      expect(document.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
      expect(document.text()).toBe(expected.toString("utf8"));
    }
  });

  it("writes the same bytes it measured, without splitting an astral character", () => {
    const value = astralDocument();
    const document = measureJsonDocument(value, 2);
    const expected = reference(value, 2);
    expect(expected.byteLength).toBeGreaterThan(1 << 20);

    const chunks: Uint8Array[] = [];
    document.write((chunk) => chunks.push(chunk));
    const written = Buffer.concat(chunks);

    expect(chunks.length).toBeGreaterThan(1);
    expect(written.byteLength).toBe(document.bytes);
    expect(written.equals(expected)).toBe(true);
    // A split surrogate pair would survive concatenation but not decoding.
    for (const chunk of chunks) {
      expect(Buffer.from(chunk).toString("utf8")).not.toContain("\ufffd");
    }
  });

  it("feeds the observer exactly the bytes it measures", () => {
    const value = astralDocument();
    const observed: Uint8Array[] = [];
    const document = measureJsonDocument(value, 0, (chunk) => observed.push(chunk));

    const seen = Buffer.concat(observed);
    expect(seen.byteLength).toBe(document.bytes);
    expect(createHash("sha256").update(seen).digest("hex")).toBe(document.sha256);
  });
});
