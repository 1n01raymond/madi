import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type SupportedStepSchema = "AP214" | "AP242";

export interface StepSourceInspection {
  readonly sourcePath: string;
  readonly displayName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly schema: SupportedStepSchema;
  readonly schemaIdentifiers: readonly string[];
}

function identifySchema(identifiers: readonly string[]): SupportedStepSchema {
  const normalized = identifiers.join(" ").toUpperCase();
  if (/AP242/u.test(normalized) || /10303\s+242\b/u.test(normalized)) return "AP242";
  if (/AUTOMOTIVE_DESIGN/u.test(normalized) || /10303\s+214\b/u.test(normalized)) {
    return "AP214";
  }
  throw new TypeError(
    `Unsupported STEP schema ${identifiers.join(", ") || "(empty)"}; ` +
      "the OCCT compiler entry point currently accepts AP242 and AP214.",
  );
}

export function inspectStepBytes(
  bytes: Uint8Array,
  sourcePath = "source.step",
): StepSourceInspection {
  const extension = extname(sourcePath).toLocaleLowerCase("en-US");
  if (extension !== ".step" && extension !== ".stp") {
    throw new TypeError("The local compiler input must use a .step or .stp extension.");
  }
  const header = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024))).toString(
    "latin1",
  );
  if (!header.trimStart().startsWith("ISO-10303-21;")) {
    throw new TypeError("The source is not a STEP Part 21 exchange file.");
  }
  const declaration = /FILE_SCHEMA\s*\(\s*\((?<identifiers>.*?)\)\s*\)/isu.exec(header);
  if (!declaration?.groups?.identifiers) {
    throw new TypeError("The STEP header does not declare FILE_SCHEMA.");
  }
  const schemaIdentifiers = [...declaration.groups.identifiers.matchAll(/'([^']+)'/gu)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  );
  if (schemaIdentifiers.length === 0) {
    throw new TypeError("The STEP FILE_SCHEMA declaration is empty.");
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

export async function inspectStepFile(sourcePath: string): Promise<StepSourceInspection> {
  const resolved = resolve(sourcePath);
  return inspectStepBytes(await readFile(resolved), resolved);
}
