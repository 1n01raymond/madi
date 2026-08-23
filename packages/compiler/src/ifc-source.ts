import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type SupportedIfcSchema = "IFC2X3" | "IFC4" | "IFC4X3";

export interface IfcSourceInspection {
  readonly sourcePath: string;
  readonly displayName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly schema: SupportedIfcSchema;
  readonly schemaIdentifiers: readonly string[];
}

function identifySchema(identifiers: readonly string[]): SupportedIfcSchema {
  const normalized = identifiers.join(" ").toUpperCase();
  if (/\bIFC4X3(?:_|\b)/u.test(normalized)) return "IFC4X3";
  if (/\bIFC4(?:_|\b)/u.test(normalized)) return "IFC4";
  if (/\bIFC2X3(?:_|\b)/u.test(normalized)) return "IFC2X3";
  throw new TypeError(
    `Unsupported IFC schema ${identifiers.join(", ") || "(empty)"}; ` +
      "the IFC adapter currently accepts IFC2X3, IFC4, and IFC4X3.",
  );
}

export function inspectIfcBytes(
  bytes: Uint8Array,
  sourcePath = "source.ifc",
): IfcSourceInspection {
  if (extname(sourcePath).toLocaleLowerCase("en-US") !== ".ifc") {
    throw new TypeError("IFC compiler inputs must use an .ifc extension.");
  }
  const header = Buffer.from(
    bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024)),
  ).toString("latin1");
  if (!header.trimStart().startsWith("ISO-10303-21;")) {
    throw new TypeError("The IFC source is not a STEP Part 21 exchange file.");
  }
  const declaration = /FILE_SCHEMA\s*\(\s*\((?<identifiers>.*?)\)\s*\)/isu.exec(header);
  if (!declaration?.groups?.identifiers) {
    throw new TypeError("The IFC header does not declare FILE_SCHEMA.");
  }
  const schemaIdentifiers = [
    ...declaration.groups.identifiers.matchAll(/'([^']+)'/gu),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  if (schemaIdentifiers.length === 0) {
    throw new TypeError("The IFC FILE_SCHEMA declaration is empty.");
  }
  return {
    sourcePath: resolve(sourcePath),
    displayName: sourcePath.replace(/^.*[\\/]/u, ""),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    schema: identifySchema(schemaIdentifiers),
    schemaIdentifiers,
  };
}

export async function inspectIfcFile(sourcePath: string): Promise<IfcSourceInspection> {
  const resolved = resolve(sourcePath);
  return inspectIfcBytes(await readFile(resolved), resolved);
}
