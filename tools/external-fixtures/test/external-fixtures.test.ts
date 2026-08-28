import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  fetchDataset,
  inspectDataset,
  inspectPart21,
  loadExternalFixtureManifest,
  readZipMember,
  repositoryRoot,
  resolveInside,
  validateExternalFixtureManifest,
  validateInspectionEvidence,
} from "../../../scripts/lib/external-fixtures.mjs";

const temporaryDirectories: string[] = [];
const fixtureCacheDirectory = `output/external-fixture-provider-tests-${process.pid}`;
const fixtureCachePath = join(repositoryRoot, fixtureCacheDirectory);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  await rm(fixtureCachePath, { recursive: true, force: true });
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
    const base = join(tmpdir(), "naru-fixture-root");
    expect(() => resolveInside(base, "../escape.ifc")).toThrow(/parent traversal/u);
    expect(() => resolveInside(base, join(tmpdir(), "escape.ifc"))).toThrow(/relative/u);
  });

  it("resolves a nested cache path", () => {
    const base = join(tmpdir(), "naru-fixture-root");
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
    const directory = await mkdtemp(join(tmpdir(), "naru-part21-"));
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

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function trimbleDataset() {
  const first = Buffer.from("first IFC payload", "utf8");
  const second = Buffer.from("second IFC payload", "utf8");
  return {
    contents: { first, second },
    manifest: {
      cacheDirectory: fixtureCacheDirectory,
    },
    dataset: {
      id: "trimble-provider-test",
      requiresAllowLarge: false,
      expectedDownloadBytes: first.length + second.length,
      download: {
        provider: "trimble-connect-public-share",
        apiBaseUrl: "https://connect.example/tc/api/2.0",
        projectId: "project-id",
        shareToken: "public-share-token",
        revisionPolicy: "content-digest-only",
      },
      assets: [
        {
          id: "first",
          role: "source",
          format: "ifc",
          path: "first.ifc",
          remoteObjectId: "remote-first",
          remoteName: "First Model.ifc",
          byteLength: first.length,
          sha256: sha256(first),
        },
        {
          id: "second",
          role: "source",
          format: "ifc",
          path: "second.ifc",
          remoteObjectId: "remote-second",
          remoteName: "Second Model.ifc",
          byteLength: second.length,
          sha256: sha256(second),
        },
      ],
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("external fixture manifest 1.1", () => {
  it("accepts a dataset-level Trimble downloader without changing direct URL datasets", async () => {
    const { manifest, sha256: manifestSha256 } = await loadExternalFixtureManifest();
    const next = structuredClone(manifest);
    next.schemaVersion = "1.1";
    const sixty5 = next.datasets.find(
      (dataset: { id: string }) => dataset.id === "ifc-bench-sixty5",
    );
    expect(sixty5).toBeDefined();
    sixty5.download = {
      provider: "trimble-connect-public-share",
      apiBaseUrl: "https://connect.example/tc/api/2.0",
      projectId: "project-id",
      shareToken: "public-share-token",
      revisionPolicy: "content-digest-only",
    };
    sixty5.assets = sixty5.assets.map((asset: Record<string, unknown>, index: number) => {
      const { url: _url, ...unchanged } = asset;
      return {
        ...unchanged,
        remoteObjectId: `remote-${index}`,
        remoteName: `Remote ${index}.ifc`,
      };
    });

    await expect(
      validateExternalFixtureManifest(next, manifestSha256, { validateEvidence: false }),
    ).resolves.toBeUndefined();
    expect(next.datasets[0].assets[0].url).toMatch(/^https:\/\//u);
  });

  it("rejects legacy schema 1.0 manifests after the 1.1 migration", async () => {
    const { manifest, sha256: manifestSha256 } = await loadExternalFixtureManifest();
    const next = structuredClone(manifest);
    next.schemaVersion = "1.0";

    await expect(
      validateExternalFixtureManifest(next, manifestSha256, { validateEvidence: false }),
    ).rejects.toThrow(/unsupported shape/u);
  });
});

describe("Trimble Connect public-share downloads", () => {
  it("resolves one share, authenticates downloadurl calls, and verifies downloaded bytes", async () => {
    const { contents, manifest, dataset } = trimbleDataset();
    const calls: Array<{ init: RequestInit | undefined; url: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      calls.push({ init, url });
      if (url.includes("/shares/token/")) {
        return jsonResponse({
          mode: "PUBLIC",
          permission: "DOWNLOAD",
          projectId: "project-id",
          accessToken: "temporary-access-token",
          objects: dataset.assets.map((asset) => ({
            id: asset.remoteObjectId,
            name: asset.remoteName,
            type: "FILE",
            versionId: null,
            useLatestVersion: true,
          })),
        });
      }
      const downloadUrlMatch = /\/files\/fs\/([^/]+)\/downloadurl/u.exec(url);
      if (downloadUrlMatch) {
        const remoteObjectId = decodeURIComponent(downloadUrlMatch[1] ?? "");
        return jsonResponse({
          id: remoteObjectId,
          versionId: remoteObjectId,
          url: `https://downloads.example/${remoteObjectId}`,
        });
      }
      if (url.endsWith("/remote-first")) return new Response(contents.first);
      if (url.endsWith("/remote-second")) return new Response(contents.second);
      return new Response(null, { status: 404 });
    };

    const results = await fetchDataset(manifest, dataset, { fetchImpl });

    expect(results.map(({ id, downloaded }) => ({ id, downloaded }))).toEqual([
      { id: "first", downloaded: true },
      { id: "second", downloaded: true },
    ]);
    expect(calls.filter(({ url }) => url.includes("/shares/token/"))).toHaveLength(1);
    const downloadUrlCalls = calls.filter(({ url }) => url.includes("/downloadurl?"));
    expect(downloadUrlCalls).toHaveLength(2);
    for (const call of downloadUrlCalls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer temporary-access-token");
      expect(headers.get("x-share-token")).toBe("public-share-token");
      expect(call.init?.redirect).toBe("error");
    }
    const assetCalls = calls.filter(({ url }) => url.startsWith("https://downloads.example/"));
    expect(assetCalls).toHaveLength(2);
    expect(new Headers(assetCalls[0]?.init?.headers).get("authorization")).toBeNull();
    expect(await readFile(join(fixtureCachePath, dataset.id, "first.ifc"))).toEqual(
      contents.first,
    );
    expect(await readFile(join(fixtureCachePath, dataset.id, "second.ifc"))).toEqual(
      contents.second,
    );
  });

  it.each([
    ["mode", "PROJECT_USERS"],
    ["permission", "VIEW"],
    ["projectId", "other-project"],
  ])("rejects mismatched share %s", async (field, value) => {
    const { manifest, dataset } = trimbleDataset();
    const fetchImpl = async () =>
      jsonResponse({
        mode: "PUBLIC",
        permission: "DOWNLOAD",
        projectId: "project-id",
        accessToken: "temporary-access-token",
        objects: dataset.assets.map((asset) => ({
          id: asset.remoteObjectId,
          name: asset.remoteName,
          type: "FILE",
          useLatestVersion: true,
        })),
        [field]: value,
      });

    await expect(fetchDataset(manifest, dataset, { assetIds: ["first"], fetchImpl })).rejects.toThrow(
      /public share/u,
    );
  });

  it.each([
    ["name", "Wrong.ifc"],
    ["useLatestVersion", false],
  ])("rejects mismatched remote object %s", async (field, value) => {
    const { manifest, dataset } = trimbleDataset();
    const fetchImpl = async () =>
      jsonResponse({
        mode: "PUBLIC",
        permission: "DOWNLOAD",
        projectId: "project-id",
        accessToken: "temporary-access-token",
        objects: dataset.assets.map((asset, index) => ({
          id: asset.remoteObjectId,
          name: asset.remoteName,
          type: "FILE",
          useLatestVersion: true,
          ...(index === 0 ? { [field]: value } : {}),
        })),
      });

    await expect(fetchDataset(manifest, dataset, { assetIds: ["first"], fetchImpl })).rejects.toThrow(
      /does not match the manifest/u,
    );
  });

  it.each([
    ["id", "other-object"],
    ["versionId", "other-version"],
  ])("rejects mismatched download %s", async (field, value) => {
    const { manifest, dataset } = trimbleDataset();
    let requestCount = 0;
    const fetchImpl = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse({
          mode: "PUBLIC",
          permission: "DOWNLOAD",
          projectId: "project-id",
          accessToken: "temporary-access-token",
          objects: dataset.assets.map((asset) => ({
            id: asset.remoteObjectId,
            name: asset.remoteName,
            type: "FILE",
            useLatestVersion: true,
          })),
        });
      }
      return jsonResponse({
        id: "remote-first",
        versionId: "remote-first",
        url: "https://downloads.example/remote-first",
        [field]: value,
      });
    };

    await expect(fetchDataset(manifest, dataset, { assetIds: ["first"], fetchImpl })).rejects.toThrow(
      /download identity does not match/u,
    );
  });

  it("rejects a non-HTTPS download URL without exposing tokens", async () => {
    const { manifest, dataset } = trimbleDataset();
    let requestCount = 0;
    const fetchImpl = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse({
          mode: "PUBLIC",
          permission: "DOWNLOAD",
          projectId: "project-id",
          accessToken: "temporary-access-token",
          objects: dataset.assets.map((asset) => ({
            id: asset.remoteObjectId,
            name: asset.remoteName,
            type: "FILE",
            useLatestVersion: true,
          })),
        });
      }
      return jsonResponse({
        id: "remote-first",
        versionId: "remote-first",
        url: "http://downloads.example/remote-first?token=must-not-appear",
      });
    };

    const error = await fetchDataset(manifest, dataset, {
      assetIds: ["first"],
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toMatch(/must use HTTPS/u);
    expect(String(error)).not.toContain("temporary-access-token");
    expect(String(error)).not.toContain("public-share-token");
    expect(String(error)).not.toContain("must-not-appear");
  });

  it("does not cache bytes that fail the pinned content digest", async () => {
    const { manifest, dataset } = trimbleDataset();
    let requestCount = 0;
    const fetchImpl = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse({
          mode: "PUBLIC",
          permission: "DOWNLOAD",
          projectId: "project-id",
          accessToken: "temporary-access-token",
          objects: dataset.assets.map((asset) => ({
            id: asset.remoteObjectId,
            name: asset.remoteName,
            type: "FILE",
            useLatestVersion: true,
          })),
        });
      }
      if (requestCount === 2) {
        return jsonResponse({
          id: "remote-first",
          versionId: "remote-first",
          url: "https://downloads.example/remote-first",
        });
      }
      return new Response(Buffer.from("wrong IFC payload", "utf8"));
    };

    await expect(fetchDataset(manifest, dataset, { assetIds: ["first"], fetchImpl })).rejects.toThrow(
      /failed verification/u,
    );
    await expect(readFile(join(fixtureCachePath, dataset.id, "first.ifc"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops an oversized response before caching it", async () => {
    const { manifest, dataset } = trimbleDataset();
    let requestCount = 0;
    const fetchImpl = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse({
          mode: "PUBLIC",
          permission: "DOWNLOAD",
          projectId: "project-id",
          accessToken: "temporary-access-token",
          objects: dataset.assets.map((asset) => ({
            id: asset.remoteObjectId,
            name: asset.remoteName,
            type: "FILE",
            useLatestVersion: true,
          })),
        });
      }
      if (requestCount === 2) {
        return jsonResponse({
          id: "remote-first",
          versionId: "remote-first",
          url: "https://downloads.example/remote-first",
        });
      }
      return new Response(Buffer.alloc((dataset.assets[0]?.byteLength ?? 0) + 1));
    };

    await expect(fetchDataset(manifest, dataset, { assetIds: ["first"], fetchImpl }))
      .rejects.toThrow(/exceeded the pinned/u);
    await expect(readFile(join(fixtureCachePath, dataset.id, "first.ifc"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("CAD corpus inspection evidence", () => {
  const dataset = {
    id: "cadquarry-1k-step",
    name: "CadQuarry 1k generated STEP corpus",
    kind: "cad-corpus",
    tier: "synthetic-control",
    source: { revision: "b".repeat(40) },
    corpus: {
      recordCount: 1_000,
      payloadColumn: "step_bytes",
      payloadFormat: "step",
      identityColumn: "part_id",
      generatorVersion: "0.6.0",
      licenseValue: "CC0-1.0",
      requiredColumns: [
        "part_id",
        "family",
        "tier",
        "seed",
        "generator_version",
        "license",
        "step_bytes",
      ],
    },
    assets: [
      {
        id: "step-corpus",
        role: "source",
        format: "parquet",
        byteLength: 120_015_344,
        sha256: "a".repeat(64),
      },
    ],
  };

  function inspection() {
    return {
      schemaVersion: "1.1",
      manifestSha256: "c".repeat(64),
      dataset: { id: dataset.id, revision: dataset.source.revision },
      summary: {
        fileCount: 1,
        byteLength: 120_015_344,
        recordCount: 1_000,
        payloadCount: 1_000,
        allPayloadsPresent: true,
        allIdentitiesUnique: true,
      },
      files: [
        {
          id: "step-corpus",
          format: "parquet",
          byteLength: 120_015_344,
          sha256: "a".repeat(64),
          parquet: {
            magicValid: true,
            rowCount: 1_000,
            rowGroupCount: 1,
            columns: [...dataset.corpus.requiredColumns],
          },
          corpus: {
            payloadColumn: "step_bytes",
            payloadFormat: "step",
            payloadNonNullCount: 1_000,
            identityColumn: "part_id",
            identityNonNullCount: 1_000,
            uniqueIdentityCount: 1_000,
            generatorVersionValues: ["0.6.0"],
            licenseValues: ["CC0-1.0"],
          },
        },
      ],
    };
  }

  it("accepts checksum-bound Parquet metadata instead of Part 21 counters", () => {
    expect(() =>
      validateInspectionEvidence(dataset, "c".repeat(64), inspection()),
    ).not.toThrow();
  });

  it("validates the pinned registered corpus without claiming evidence", async () => {
    const { manifest, sha256 } = await loadExternalFixtureManifest();
    await expect(
      validateExternalFixtureManifest(manifest, sha256, { validateEvidence: false }),
    ).resolves.toBeUndefined();

    const driftedManifest = structuredClone(manifest);
    const corpus = driftedManifest.datasets.find(
      (candidate: { id: string }) => candidate.id === dataset.id,
    );
    corpus.corpus.requiredColumns = corpus.corpus.requiredColumns.filter(
      (column: string) => column !== "license",
    );
    await expect(
      validateExternalFixtureManifest(driftedManifest, sha256, { validateEvidence: false }),
    ).rejects.toThrow(/requiredColumns must include license/u);
  });

  it("rejects a corpus record whose declared license values drift", () => {
    const evidence = inspection();
    const [corpusFile] = evidence.files;
    if (!corpusFile) throw new Error("The inspection has no files.");
    corpusFile.corpus.licenseValues = ["UNKNOWN"];
    expect(() => validateInspectionEvidence(dataset, "c".repeat(64), evidence)).toThrow(
      /invalid Parquet corpus inspection/u,
    );
  });

  it("refuses to treat a Parquet container as a Part 21 source", async () => {
    await expect(inspectDataset({}, "c".repeat(64), dataset)).rejects.toThrow(
      /registered only.*ADR-0014/u,
    );
  });
});
