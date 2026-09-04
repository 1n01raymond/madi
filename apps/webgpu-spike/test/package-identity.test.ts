import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  adapterReportName,
  buildReportName,
  maximumReportBytes,
  readPackageIdentity,
} from "../src/package-identity.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function reportFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}

/** The shape `build-report.json` actually carries, trimmed to what is read. */
function buildReport(overrides: Record<string, unknown> = {}): File {
  return reportFile(buildReportName, {
    schemaVersion: "madi.build-report.1",
    output: {
      packageDigest: sha256("package"),
      resources: [
        {
          path: "scene.gltf",
          mediaType: "model/gltf+json",
          bytes: 34_184_035,
          sha256: sha256("scene.gltf"),
        },
        {
          path: "scene.bin",
          mediaType: "application/octet-stream",
          bytes: 22_410_360,
          sha256: sha256("scene.bin"),
        },
      ],
      ...overrides,
    },
  });
}

/** The shape the IFC `adapter-report.json` carries for a federation. */
function adapterReport(sources: readonly unknown[]): File {
  return reportFile(adapterReportName, {
    schemaVersion: "madi.ifc-adapter-report.5",
    sources,
  });
}

const ifcSources = [
  {
    byteLength: 9_022_255,
    discipline: "architecture",
    path: "projects/digital_hub/arc.ifc",
    schema: "IFC4",
    sha256: sha256("arc.ifc"),
    unitScaleToMeters: 1,
  },
  {
    byteLength: 4_103_991,
    discipline: "structure",
    path: "projects/digital_hub/str.ifc",
    schema: "IFC4",
    sha256: sha256("str.ifc"),
    unitScaleToMeters: 1,
  },
];

describe("readPackageIdentity", () => {
  it("reads both halves from the reports beside a local package", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [buildReport(), adapterReport(ifcSources)],
    });
    expect("reason" in identity).toBe(false);
    if ("reason" in identity) return;

    expect(identity.packageDigest).toBe(sha256("package"));
    expect(identity.resources).toEqual([
      { path: "scene.gltf", byteLength: 34_184_035, sha256: sha256("scene.gltf") },
      { path: "scene.bin", byteLength: 22_410_360, sha256: sha256("scene.bin") },
    ]);
    expect(identity.sources).toEqual([
      {
        key: "architecture",
        label: "arc.ifc",
        byteLength: 9_022_255,
        sha256: sha256("arc.ifc"),
      },
      {
        key: "structure",
        label: "str.ifc",
        byteLength: 4_103_991,
        sha256: sha256("str.ifc"),
      },
    ]);
    expect(identity.sourcesUnavailableReason).toBeUndefined();
  });

  it("disambiguates two documents filed under one discipline", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [
        buildReport(),
        adapterReport([
          { ...ifcSources[0], path: "a/arc.ifc" },
          { ...ifcSources[0], path: "b/arc-2.ifc" },
        ]),
      ],
    });
    if ("reason" in identity) throw new Error(identity.reason);
    expect(identity.sources?.map((source) => source.key)).toEqual([
      "architecture:arc.ifc",
      "architecture:arc-2.ifc",
    ]);
  });
});

describe("readPackageIdentity refusals", () => {
  it("returns a reason instead of an identity when the build report is absent", async () => {
    const identity = await readPackageIdentity({ kind: "local", files: [] });
    expect(identity).toEqual({
      reason: `${buildReportName} was not among the selected files.`,
    });
  });

  it("returns a reason when the build report carries no output section", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [reportFile(buildReportName, { schemaVersion: "madi.build-report.1" })],
    });
    expect(identity).toEqual({ reason: `${buildReportName} carries no output section.` });
  });

  it("keeps the package half when the source half cannot be read", async () => {
    const identity = await readPackageIdentity({ kind: "local", files: [buildReport()] });
    if ("reason" in identity) throw new Error(identity.reason);
    expect(identity.packageDigest).toBe(sha256("package"));
    expect(identity.sources).toBeUndefined();
    expect(identity.sourcesUnavailableReason).toBe(
      `${adapterReportName} was not among the selected files.`,
    );
  });

  it("refuses the OCCT report's single source rather than inventing a byte length", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [
        buildReport(),
        reportFile(adapterReportName, {
          schemaVersion: "madi.occt-adapter-report.3",
          source: { path: "fixtures/step/pygamer.step", sha256: sha256("pygamer.step") },
        }),
      ],
    });
    if ("reason" in identity) throw new Error(identity.reason);
    expect(identity.sources).toBeUndefined();
    expect(identity.sourcesUnavailableReason).toContain("without a byte length");
  });

  it("refuses a report larger than the ceiling without reading it", async () => {
    const oversized = new File(
      [new Uint8Array(maximumReportBytes + 1)],
      buildReportName,
      { type: "application/json" },
    );
    const identity = await readPackageIdentity({ kind: "local", files: [oversized] });
    expect(identity).toEqual({
      reason: `${buildReportName} is larger than ${maximumReportBytes} bytes.`,
    });
  });

  it("refuses a resource declared without a digest", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [buildReport({ resources: [{ path: "scene.gltf", bytes: 1 }] })],
    });
    expect(identity).toEqual({
      reason: `${buildReportName} declares a resource without path, bytes, or digest.`,
    });
  });

  it("reports a report that is not valid JSON", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [new File(["{"], buildReportName, { type: "application/json" })],
    });
    expect("reason" in identity).toBe(true);
    if (!("reason" in identity)) return;
    expect(identity.reason).toContain(`${buildReportName} is not valid JSON`);
  });

  it("refuses an adapter report that declares no source", async () => {
    const identity = await readPackageIdentity({
      kind: "local",
      files: [buildReport(), adapterReport([])],
    });
    if ("reason" in identity) throw new Error(identity.reason);
    expect(identity.sourcesUnavailableReason).toBe(
      `${adapterReportName} declares no sources.`,
    );
  });
});
