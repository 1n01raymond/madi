import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseIfcStructureStream,
  readIfcStructure,
} from "../src/ifc-structure-stream.js";

async function* chunked(bytes: Buffer, chunkBytes: number): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    yield bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength));
  }
}

async function parseChunked(text: string, chunkBytes: number) {
  return parseIfcStructureStream(chunked(Buffer.from(text, "utf8"), chunkBytes));
}

/**
 * A document exercising every value shape the structure transport carries:
 * nested arrays/objects inside records, strings containing brackets, braces,
 * commas, escaped quotes and backslashes, non-ASCII text (two-byte Hangul and
 * a four-byte emoji, so multi-byte UTF-8 sequences get split by small
 * chunks), scientific-notation numbers, empty arrays, and scalar members.
 */
const representativeDocument = JSON.stringify({
  schemaVersion: "madi.ifc-scene-ir-split.2",
  sceneId: "scene-🚀-가나다",
  propertyIndex: { keys: ["off", "ok", "가:나"], sets: [[], [0, 1, 2]] },
  revision: { revisionId: "r1", sourceDigest: "sha256:ab", adapter: { name: "x" } },
  units: { scaleToMeters: 1e-3 },
  documents: [],
  occurrences: [
    { id: "a", localTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5, -2e-7, 3] },
    { id: "b\\\"],}", name: "중괄호 } 대괄호 ] 쉼표 , \"quoted\"" },
  ],
  prototypes: [{ id: "p", representations: ["r"] }],
  representations: [
    {
      id: "r",
      surface: {
        primitive: "triangles",
        positions: { encoding: "f64le", byteOffset: 0, byteLength: 24 },
        indices: { encoding: "u32le", byteOffset: 24, byteLength: 12 },
      },
    },
  ],
  semantics: [{ id: "s", properties: { "가:나": null, ok: true, off: false } }],
});

describe("IFC structure streaming reader", () => {
  it.each([1, 3, 7, 64, 1024, representativeDocument.length])(
    "produces the same object graph as JSON.parse at %d-byte chunks",
    async (chunkBytes) => {
      const read = await parseChunked(representativeDocument, chunkBytes);
      expect(read.value).toEqual(JSON.parse(representativeDocument));
    },
  );

  it("reports the byte length and SHA-256 of the exact bytes it consumed", async () => {
    const bytes = Buffer.from(`\n ${representativeDocument} \n`, "utf8");
    const read = await parseIfcStructureStream(chunked(bytes, 5));
    expect(read.byteLength).toBe(bytes.byteLength);
    expect(read.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("parses an empty top-level object and empty sections", async () => {
    expect((await parseChunked("{}", 1)).value).toEqual({});
    expect((await parseChunked('{"occurrences":[]}', 1)).value).toEqual({ occurrences: [] });
  });

  it("resolves duplicate top-level keys the way JSON.parse does (last write wins)", async () => {
    const text = '{"a":[1],"a":[2,3]}';
    const read = await parseChunked(text, 2);
    expect(read.value).toEqual(JSON.parse(text));
  });

  it("names the section and record index when a record contains a NaN token", async () => {
    await expect(
      parseChunked('{"occurrences":[{"m":[1]},{"m":[NaN]}]}', 4),
    ).rejects.toThrow(/Malformed record occurrences\[1\]/u);
  });

  it("names the key when a scalar member is malformed", async () => {
    await expect(parseChunked('{"revision":Infinity}', 4)).rejects.toThrow(
      /Malformed value for "revision"/u,
    );
  });

  it("rejects a document whose top level is not an object", async () => {
    await expect(parseChunked("[1,2]", 4)).rejects.toThrow(/expected '\{'/u);
  });

  it("rejects a non-string top-level key", async () => {
    await expect(parseChunked("{1:2}", 4)).rejects.toThrow(/is not a string/u);
  });

  it("rejects a missing colon with the offending key", async () => {
    await expect(parseChunked('{"a" [1]}', 4)).rejects.toThrow(/expected ':' after key "a"/u);
  });

  it("rejects trailing bytes after the document", async () => {
    await expect(parseChunked('{"a":[]} x', 4)).rejects.toThrow(/Trailing bytes/u);
  });

  it("rejects a truncated document", async () => {
    await expect(parseChunked('{"occurrences":[{"id":"a"}', 4)).rejects.toThrow(
      /Unexpected end/u,
    );
    await expect(parseChunked('{"occurrences":[{"id":"a"},', 4)).rejects.toThrow(
      /Unexpected end/u,
    );
  });

  it("reads a document straight off disk in bounded chunks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "madi-structure-stream-"));
    try {
      const path = join(directory, "scene-ir.json");
      const bytes = Buffer.from(representativeDocument, "utf8");
      await writeFile(path, bytes);
      const read = await readIfcStructure(path, { highWaterMark: 11 });
      expect(read.value).toEqual(JSON.parse(representativeDocument));
      expect(read.byteLength).toBe(bytes.byteLength);
      expect(read.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes the file when the document fails to parse", async () => {
    const directory = await mkdtemp(join(tmpdir(), "madi-structure-stream-"));
    try {
      const path = join(directory, "scene-ir.json");
      await writeFile(path, '{"a":[', "utf8");
      await expect(readIfcStructure(path)).rejects.toThrow(/Unexpected end/u);
      // Windows refuses to remove a directory holding an open descriptor, so
      // the cleanup below doubles as the assertion that the file was closed.
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
