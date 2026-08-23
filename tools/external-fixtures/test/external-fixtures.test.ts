import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectPart21,
  readZipMember,
  resolveInside,
} from "../../../scripts/lib/external-fixtures.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function storedZip(name: string, contents: Buffer): Buffer {
  const fileName = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt32LE(contents.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(fileName.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt32LE(contents.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(fileName.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(local.length + fileName.length + contents.length, 16);

  return Buffer.concat([local, fileName, contents, central, fileName, end]);
}

describe("external fixture paths", () => {
  it("rejects traversal and absolute paths", () => {
    const base = join(tmpdir(), "madi-fixture-root");
    expect(() => resolveInside(base, "../escape.ifc")).toThrow(/parent traversal/u);
    expect(() => resolveInside(base, join(tmpdir(), "escape.ifc"))).toThrow(/relative/u);
  });

  it("resolves a nested cache path", () => {
    const base = join(tmpdir(), "madi-fixture-root");
    expect(resolveInside(base, "selected/model.ifc")).toBe(
      join(base, "selected", "model.ifc"),
    );
  });
});

describe("external fixture ZIP selection", () => {
  it("extracts only the exact registered member", () => {
    const archive = storedZip("models/reference.step", Buffer.from("STEP payload"));
    expect(readZipMember(archive, "models/reference.step").toString("utf8")).toBe(
      "STEP payload",
    );
    expect(() => readZipMember(archive, "models/other.step")).toThrow(/not found/u);
  });
});

describe("Part 21 inspection", () => {
  it("records schemas, entities, and IFC semantic indicators", async () => {
    const directory = await mkdtemp(join(tmpdir(), "madi-part21-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "model.ifc");
    await writeFile(
      path,
      [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_SCHEMA(('IFC4'));",
        "ENDSEC;",
        "DATA;",
        "#1=IFCPROJECT('id',$,$,$,$,$,$,$,$);",
        "#2=IFCBUILDINGSTOREY('id',$,$,$,$,$,$,$,$,$);",
        "#3=IFCRELAGGREGATES('id',$,$,$,#1,(#2));",
        "ENDSEC;",
        "END-ISO-10303-21;",
        "",
      ].join("\n"),
      "utf8",
    );

    const inspection = await inspectPart21(path);
    expect(inspection.envelopeValid).toBe(true);
    expect(inspection.schemas).toEqual(["IFC4"]);
    expect(inspection.entityCount).toBe(3);
    expect(inspection.indicators.projects).toBe(1);
    expect(inspection.indicators.storeys).toBe(1);
    expect(inspection.indicators.relationships).toBe(1);
  });
});
