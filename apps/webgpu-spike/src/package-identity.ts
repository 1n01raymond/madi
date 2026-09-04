/**
 * A saved workspace names a compiled package and the sources it was built
 * from. Both identities already exist: `build-report.json` states
 * `output.packageDigest` and every resource, and `adapter-report.json` states
 * each source's byte length and digest. This module reads those two reports
 * and nothing else, so a workspace never asserts an identity the import
 * pipeline did not compute (ADR-0022).
 *
 * Everything here is defensive. The reports travel over the same bounded
 * transport the package does (ADR-0011) and are parsed by shape: a field that
 * is missing, mistyped, or malformed makes the report unusable rather than
 * producing a workspace that claims an identity it cannot support.
 */

import type { PackageTransport } from "@naru3d/runtime-webgpu";
import type { WorkspacePackageResource, WorkspaceSource } from "@naru3d/workspace";

/**
 * A ceiling for the two reports, well above anything this repository has
 * recorded: the largest committed build report is 141,405 bytes and the
 * largest adapter report is 34,180 bytes.
 */
export const maximumReportBytes = 8 * 1024 * 1024;

export const buildReportName = "build-report.json";
export const adapterReportName = "adapter-report.json";

/**
 * Where the two reports are read from. The URL variant carries the transport
 * the scene was already loaded through, so one policy governs the whole
 * package instead of a second one being opened here.
 */
export type PackageReportSource =
  | { readonly kind: "url"; readonly transport: PackageTransport }
  | { readonly kind: "local"; readonly files: readonly File[] };

/** What a workspace may record about the package currently open. */
export interface PackageIdentity {
  readonly packageDigest: string;
  readonly resources: readonly WorkspacePackageResource[];
  /** Absent when the import's source identity could not be read. */
  readonly sources: readonly WorkspaceSource[] | undefined;
  /** Why `sources` is absent, in a sentence the Studio can show. */
  readonly sourcesUnavailableReason: string | undefined;
}

const digestPattern = /^[0-9a-f]{64}$/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asDigest(value: unknown): string | undefined {
  return typeof value === "string" && digestPattern.test(value) ? value : undefined;
}

function asByteLength(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The trailing path segment, so a manifest carries a name and not a layout. */
function baseName(path: string): string {
  const segments = path.split(/[/\\]/u).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

/**
 * Reads one report as text, or reports why it could not be read.
 *
 * A missing report is an ordinary outcome — a package may be served without
 * one — so it is returned as a reason rather than thrown.
 */
async function readReport(
  source: PackageReportSource,
  name: string,
  signal?: AbortSignal,
): Promise<{ text: string } | { reason: string }> {
  try {
    if (source.kind === "local") {
      const file = source.files.find((candidate) => candidate.name === name);
      if (file === undefined) {
        return { reason: `${name} was not among the selected files.` };
      }
      if (file.size > maximumReportBytes) {
        return { reason: `${name} is larger than ${maximumReportBytes} bytes.` };
      }
      return { text: await file.text() };
    }
    const transport = source.transport;
    const url = transport.resolveResourceUrl(name);
    const bytes = await transport.fetchResource(url, {
      kind: "json",
      label: name,
      limitBytes: Math.min(maximumReportBytes, transport.limits.resourceBytes),
      signal,
    });
    return { text: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    return { reason: `${name} could not be read: ${describe(error)}` };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseReport(
  text: string,
  name: string,
): { record: Record<string, unknown> } | { reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { reason: `${name} is not valid JSON: ${describe(error)}` };
  }
  const record = asRecord(parsed);
  return record === undefined
    ? { reason: `${name} is not a JSON object.` }
    : { record };
}

interface PackageHalf {
  readonly packageDigest: string;
  readonly resources: readonly WorkspacePackageResource[];
}

/**
 * The package half of the identity, from `output` in the build report.
 *
 * The report spells a resource's length `bytes`; the manifest spells it
 * `byteLength`. Renaming here keeps the manifest's vocabulary independent of
 * the report's, which is a frozen `madi.*` schema (ADR-0007).
 */
function readPackageHalf(
  report: Record<string, unknown>,
): PackageHalf | { reason: string } {
  const output = asRecord(report["output"]);
  if (output === undefined) {
    return { reason: `${buildReportName} carries no output section.` };
  }
  const packageDigest = asDigest(output["packageDigest"]);
  if (packageDigest === undefined) {
    return { reason: `${buildReportName} carries no package digest.` };
  }
  const declared = output["resources"];
  if (!Array.isArray(declared)) {
    return { reason: `${buildReportName} carries no resource list.` };
  }
  const resources: WorkspacePackageResource[] = [];
  for (const entry of declared) {
    const record = asRecord(entry);
    const path = record === undefined ? undefined : asNonEmptyString(record["path"]);
    const byteLength = record === undefined ? undefined : asByteLength(record["bytes"]);
    const sha256 = record === undefined ? undefined : asDigest(record["sha256"]);
    if (path === undefined || byteLength === undefined || sha256 === undefined) {
      return { reason: `${buildReportName} declares a resource without path, bytes, or digest.` };
    }
    resources.push({ path, byteLength, sha256 });
  }
  return { packageDigest, resources };
}

interface ReadSource {
  readonly preferredKey: string;
  readonly label: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/**
 * Makes the preferred keys unique without inventing identity.
 *
 * A discipline names a source unambiguously in every federation this
 * repository has compiled, so it is the key. Two documents filed under the
 * same discipline would collide, and a colliding manifest is refused by the
 * parser, so the key falls back to discipline plus file name and then to an
 * ordinal — deterministic in the order the report lists its sources.
 */
function assignKeys(sources: readonly ReadSource[]): WorkspaceSource[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    counts.set(source.preferredKey, (counts.get(source.preferredKey) ?? 0) + 1);
  }
  const taken = new Set<string>();
  return sources.map((source, index) => {
    let key = source.preferredKey;
    if ((counts.get(key) ?? 0) > 1) {
      key = `${source.preferredKey}:${source.label}`;
    }
    if (taken.has(key)) {
      key = `${key}#${index}`;
    }
    taken.add(key);
    return { key, label: source.label, byteLength: source.byteLength, sha256: source.sha256 };
  });
}

/**
 * The source half of the identity, from the adapter report.
 *
 * The IFC adapter reports a `sources` array with a byte length per document.
 * The OCCT adapter reports a single `source` and states its digest but not its
 * length, and `byteLength` is required by `naru.workspace.1` — so a STEP
 * package yields a reason here rather than a fabricated length, and the Studio
 * refuses to save rather than write a manifest whose source evidence is
 * invented. Supplying that length is a change to the OCCT report's schema.
 */
function readSourceHalf(
  report: Record<string, unknown>,
): readonly WorkspaceSource[] | { reason: string } {
  const declared = report["sources"];
  if (!Array.isArray(declared)) {
    if (asRecord(report["source"]) !== undefined) {
      return {
        reason:
          `${adapterReportName} states one source without a byte length, which ` +
          "this adapter report schema does not carry.",
      };
    }
    return { reason: `${adapterReportName} carries no source list.` };
  }
  const sources: ReadSource[] = [];
  for (const entry of declared) {
    const record = asRecord(entry);
    if (record === undefined) {
      return { reason: `${adapterReportName} declares a source that is not an object.` };
    }
    const path = asNonEmptyString(record["path"]);
    const byteLength = asByteLength(record["byteLength"]);
    const sha256 = asDigest(record["sha256"]);
    if (path === undefined || byteLength === undefined || sha256 === undefined) {
      return {
        reason: `${adapterReportName} declares a source without path, byte length, or digest.`,
      };
    }
    const label = baseName(path);
    sources.push({
      preferredKey: asNonEmptyString(record["discipline"]) ?? label,
      label,
      byteLength,
      sha256,
    });
  }
  if (sources.length === 0) {
    return { reason: `${adapterReportName} declares no sources.` };
  }
  return assignKeys(sources);
}

/**
 * Reads what a workspace may record about the open package.
 *
 * Returns `undefined` when the package half cannot be read at all, because a
 * workspace with no package identity would name nothing. The source half is
 * separable: a package whose sources cannot be identified still returns an
 * identity, carrying the reason, and it is the caller that decides a manifest
 * without source evidence must not be written.
 */
export async function readPackageIdentity(
  source: PackageReportSource,
  signal?: AbortSignal,
): Promise<PackageIdentity | { reason: string }> {
  const build = await readReport(source, buildReportName, signal);
  if ("reason" in build) {
    return build;
  }
  const buildReport = parseReport(build.text, buildReportName);
  if ("reason" in buildReport) {
    return buildReport;
  }
  const half = readPackageHalf(buildReport.record);
  if ("reason" in half) {
    return half;
  }

  const adapter = await readReport(source, adapterReportName, signal);
  if ("reason" in adapter) {
    return { ...half, sources: undefined, sourcesUnavailableReason: adapter.reason };
  }
  const adapterReport = parseReport(adapter.text, adapterReportName);
  if ("reason" in adapterReport) {
    return { ...half, sources: undefined, sourcesUnavailableReason: adapterReport.reason };
  }
  const sources = readSourceHalf(adapterReport.record);
  if ("reason" in sources) {
    return { ...half, sources: undefined, sourcesUnavailableReason: sources.reason };
  }
  return { ...half, sources, sourcesUnavailableReason: undefined };
}
