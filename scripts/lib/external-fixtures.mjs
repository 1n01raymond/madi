import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const externalFixtureDirectory = resolve(repositoryRoot, "fixtures/external");
export const externalFixtureManifestPath = resolve(
  externalFixtureDirectory,
  "manifest.json",
);

const datasetKinds = new Set(["step-conformance", "federated-bim"]);
const datasetStatuses = new Set(["qualified", "registered"]);
const datasetTiers = new Set(["smoke", "real-medium", "real-large"]);
const assetFormats = new Set(["ifc", "step", "zip"]);
const assetRoles = new Set(["archive", "source"]);
const manifestSchemaVersions = new Set(["1.1"]);
const trimbleConnectProvider = "trimble-connect-public-share";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertCanonicalId(value, label) {
  assertNonEmptyString(value, label);
  if (!idPattern.test(value)) throw new TypeError(`${label} is not canonical.`);
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertHttpsUrl(value, label) {
  assertNonEmptyString(value, label);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid URL.`);
  }
  if (url.protocol !== "https:") throw new TypeError(`${label} must use HTTPS.`);
}

function assertTrimbleConnectDownload(download, label) {
  if (typeof download !== "object" || download === null) {
    throw new TypeError(`${label} must be an object.`);
  }
  if (download.provider !== trimbleConnectProvider) {
    throw new TypeError(`${label}.provider is unsupported.`);
  }
  assertHttpsUrl(download.apiBaseUrl, `${label}.apiBaseUrl`);
  assertNonEmptyString(download.projectId, `${label}.projectId`);
  assertNonEmptyString(download.shareToken, `${label}.shareToken`);
  if (download.revisionPolicy !== "content-digest-only") {
    throw new TypeError(`${label}.revisionPolicy is unsupported.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
}

function assertStringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }
  const values = new Set();
  for (const [index, item] of value.entries()) {
    assertCanonicalId(item, `${label}[${index}]`);
    if (values.has(item)) throw new TypeError(`${label} contains duplicate ${item}.`);
    values.add(item);
  }
}

export function resolveInside(baseDirectory, relativePath, label = "path") {
  assertNonEmptyString(relativePath, label);
  if (isAbsolute(relativePath)) throw new TypeError(`${label} must be relative.`);

  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.split("/").some((component) => component === "..")) {
    throw new TypeError(`${label} must not contain parent traversal.`);
  }

  const absolutePath = resolve(baseDirectory, relativePath);
  const fromBase = relative(baseDirectory, absolutePath);
  if (
    fromBase === "" ||
    fromBase === ".." ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  ) {
    throw new TypeError(`${label} escapes its base directory.`);
  }
  return absolutePath;
}

export function resolveRepositoryOutput(relativePath, label = "output path") {
  return resolveInside(repositoryRoot, relativePath, label);
}

export async function loadExternalFixtureManifest() {
  const bytes = await readFile(externalFixtureManifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  return {
    manifest,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function assertRegularFile(path, label) {
  const details = await stat(path);
  if (!details.isFile()) throw new TypeError(`${label} is not a regular file.`);
}

function expectedDatasetFiles(dataset) {
  const files = [];
  for (const asset of dataset.assets) {
    if (asset.role === "source") {
      files.push({
        id: asset.id,
        format: asset.format,
        byteLength: asset.byteLength,
        sha256: asset.sha256,
      });
      continue;
    }
    for (const member of asset.archiveMembers) {
      files.push({
        id: member.id,
        format: member.format,
        byteLength: member.byteLength,
        sha256: member.sha256,
      });
    }
  }
  return files;
}

async function validateEvidence(dataset, manifestSha256) {
  const label = `Dataset ${dataset.id} evidence`;
  const evidencePath = resolveRepositoryOutput(dataset.evidenceFile, `${label} file`);
  await assertRegularFile(evidencePath, `${label} file`);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));

  if (evidence.schemaVersion !== "1.0") {
    throw new TypeError(`${label} has an unsupported schema version.`);
  }
  if (evidence.manifestSha256 !== manifestSha256) {
    throw new TypeError(`${label} was not generated from the current manifest.`);
  }
  if (evidence.dataset?.id !== dataset.id || evidence.dataset?.revision !== dataset.source.revision) {
    throw new TypeError(`${label} does not match the registered dataset identity.`);
  }

  const expectedFiles = expectedDatasetFiles(dataset);
  if (!Array.isArray(evidence.files) || evidence.files.length !== expectedFiles.length) {
    throw new TypeError(`${label} does not cover every selected source file.`);
  }
  const evidenceById = new Map(evidence.files.map((file) => [file.id, file]));
  if (evidenceById.size !== evidence.files.length) {
    throw new TypeError(`${label} contains duplicate file IDs.`);
  }
  for (const expected of expectedFiles) {
    const actual = evidenceById.get(expected.id);
    if (
      actual?.format !== expected.format ||
      actual?.byteLength !== expected.byteLength ||
      actual?.sha256 !== expected.sha256 ||
      !Number.isSafeInteger(actual?.part21?.entityCount) ||
      actual.part21.entityCount < 1 ||
      !Array.isArray(actual.part21.schemas) ||
      actual.part21.schemas.length === 0 ||
      actual?.part21?.envelopeValid !== true
    ) {
      throw new TypeError(`${label} has invalid inspection data for ${expected.id}.`);
    }
  }
  const byteLength = evidence.files.reduce((total, file) => total + file.byteLength, 0);
  const entityCount = evidence.files.reduce(
    (total, file) => total + file.part21.entityCount,
    0,
  );
  if (
    evidence.summary?.fileCount !== evidence.files.length ||
    evidence.summary?.byteLength !== byteLength ||
    evidence.summary?.entityCount !== entityCount ||
    evidence.summary?.allEnvelopesValid !== true
  ) {
    throw new TypeError(`${label} summary is inconsistent with its file records.`);
  }
}

export async function validateExternalFixtureManifest(
  manifest,
  manifestSha256,
  options = {},
) {
  if (
    !manifestSchemaVersions.has(manifest?.schemaVersion) ||
    manifest.storagePolicy !== "external-cache-only" ||
    typeof manifest.cacheDirectory !== "string" ||
    !Array.isArray(manifest.datasets) ||
    manifest.datasets.length === 0
  ) {
    throw new TypeError("fixtures/external/manifest.json has an unsupported shape.");
  }

  resolveRepositoryOutput(manifest.cacheDirectory, "Manifest cacheDirectory");
  const datasetIds = new Set();
  let hasQualifiedDataset = false;
  let hasLargeDataset = false;

  for (const [datasetIndex, dataset] of manifest.datasets.entries()) {
    const label = `Dataset ${datasetIndex}`;
    assertCanonicalId(dataset.id, `${label} id`);
    assertNonEmptyString(dataset.name, `${label} name`);
    if (datasetIds.has(dataset.id)) throw new TypeError(`Duplicate dataset ID ${dataset.id}.`);
    if (!datasetKinds.has(dataset.kind)) {
      throw new TypeError(`Dataset ${dataset.id} has an unsupported kind.`);
    }
    if (!datasetStatuses.has(dataset.status)) {
      throw new TypeError(`Dataset ${dataset.id} has an unsupported status.`);
    }
    if (!datasetTiers.has(dataset.tier)) {
      throw new TypeError(`Dataset ${dataset.id} has an unsupported tier.`);
    }
    if (typeof dataset.requiresAllowLarge !== "boolean") {
      throw new TypeError(`Dataset ${dataset.id} requiresAllowLarge must be boolean.`);
    }
    assertStringList(dataset.purposes, `Dataset ${dataset.id} purposes`);
    assertPositiveInteger(dataset.expectedDownloadBytes, `Dataset ${dataset.id} download bytes`);

    const dynamicDownload = dataset.download !== undefined;
    if (dynamicDownload) {
      if (manifest.schemaVersion !== "1.1") {
        throw new TypeError(`Dataset ${dataset.id} download requires manifest schema 1.1.`);
      }
      assertTrimbleConnectDownload(dataset.download, `Dataset ${dataset.id} download`);
    }

    const source = dataset.source;
    if (typeof source !== "object" || source === null) {
      throw new TypeError(`Dataset ${dataset.id} source must be an object.`);
    }
    for (const field of ["revision", "license", "attribution"]) {
      assertNonEmptyString(source[field], `Dataset ${dataset.id} source.${field}`);
    }
    for (const field of ["landingPage", "licenseUrl"]) {
      assertHttpsUrl(source[field], `Dataset ${dataset.id} source.${field}`);
    }
    assertHttpsUrl(source.repository, `Dataset ${dataset.id} source.repository`);
    const licensePath = resolveInside(
      externalFixtureDirectory,
      source.licenseFile,
      `Dataset ${dataset.id} source.licenseFile`,
    );
    await assertRegularFile(licensePath, `Dataset ${dataset.id} license file`);

    if (!Array.isArray(dataset.assets) || dataset.assets.length === 0) {
      throw new TypeError(`Dataset ${dataset.id} must declare assets.`);
    }
    const assetIds = new Set();
    const assetPaths = new Set();
    const remoteObjectIds = new Set();
    let byteTotal = 0;
    for (const [assetIndex, asset] of dataset.assets.entries()) {
      const assetLabel = `Dataset ${dataset.id} asset ${assetIndex}`;
      assertCanonicalId(asset.id, `${assetLabel} id`);
      if (assetIds.has(asset.id)) throw new TypeError(`Duplicate asset ID ${asset.id}.`);
      if (!assetRoles.has(asset.role)) throw new TypeError(`${assetLabel} has invalid role.`);
      if (!assetFormats.has(asset.format)) throw new TypeError(`${assetLabel} has invalid format.`);
      if (asset.role === "archive" && asset.format !== "zip") {
        throw new TypeError(`${assetLabel} archive must use ZIP format.`);
      }
      if (asset.role === "source" && asset.format === "zip") {
        throw new TypeError(`${assetLabel} source must be an inspectable Part 21 file.`);
      }
      resolveInside(repositoryRoot, asset.path, `${assetLabel} path`);
      if (assetPaths.has(asset.path)) throw new TypeError(`Duplicate asset path ${asset.path}.`);
      if (dynamicDownload) {
        if (asset.url !== undefined) {
          throw new TypeError(`${assetLabel} cannot declare url with a dataset downloader.`);
        }
        assertNonEmptyString(asset.remoteObjectId, `${assetLabel} remoteObjectId`);
        assertNonEmptyString(asset.remoteName, `${assetLabel} remoteName`);
        if (remoteObjectIds.has(asset.remoteObjectId)) {
          throw new TypeError(
            `Dataset ${dataset.id} has duplicate remoteObjectId ${asset.remoteObjectId}.`,
          );
        }
        remoteObjectIds.add(asset.remoteObjectId);
      } else {
        assertHttpsUrl(asset.url, `${assetLabel} url`);
        if (asset.remoteObjectId !== undefined || asset.remoteName !== undefined) {
          throw new TypeError(`${assetLabel} remote identity requires a dataset downloader.`);
        }
      }
      assertPositiveInteger(asset.byteLength, `${assetLabel} byteLength`);
      assertSha256(asset.sha256, `${assetLabel} sha256`);
      byteTotal += asset.byteLength;

      if (asset.role === "archive") {
        if (!Array.isArray(asset.archiveMembers) || asset.archiveMembers.length === 0) {
          throw new TypeError(`${assetLabel} must select archive members.`);
        }
        const memberIds = new Set();
        for (const [memberIndex, member] of asset.archiveMembers.entries()) {
          const memberLabel = `${assetLabel} member ${memberIndex}`;
          assertCanonicalId(member.id, `${memberLabel} id`);
          if (memberIds.has(member.id)) throw new TypeError(`Duplicate member ID ${member.id}.`);
          assertNonEmptyString(member.archivePath, `${memberLabel} archivePath`);
          resolveInside(repositoryRoot, member.cachePath, `${memberLabel} cachePath`);
          if (!assetFormats.has(member.format) || member.format === "zip") {
            throw new TypeError(`${memberLabel} has invalid format.`);
          }
          assertPositiveInteger(member.byteLength, `${memberLabel} byteLength`);
          assertSha256(member.sha256, `${memberLabel} sha256`);
          assertStringList(member.purposes, `${memberLabel} purposes`);
          memberIds.add(member.id);
        }
      } else if (asset.archiveMembers !== undefined) {
        throw new TypeError(`${assetLabel} source cannot declare archive members.`);
      }

      assetIds.add(asset.id);
      assetPaths.add(asset.path);
    }
    if (byteTotal !== dataset.expectedDownloadBytes) {
      throw new TypeError(
        `Dataset ${dataset.id} byte total is ${byteTotal}, expected ${dataset.expectedDownloadBytes}.`,
      );
    }
    if (dataset.tier === "real-large" && !dataset.requiresAllowLarge) {
      throw new TypeError(`Dataset ${dataset.id} must require --allow-large.`);
    }
    if (dataset.status === "qualified") {
      assertNonEmptyString(dataset.evidenceFile, `Dataset ${dataset.id} evidenceFile`);
      hasQualifiedDataset = true;
      if (options.validateEvidence !== false) {
        await validateEvidence(dataset, manifestSha256);
      }
    } else if (dataset.evidenceFile !== undefined) {
      throw new TypeError(`Registered dataset ${dataset.id} cannot claim evidence.`);
    }

    hasLargeDataset ||= dataset.tier === "real-large";
    datasetIds.add(dataset.id);
  }

  if (!hasQualifiedDataset || !hasLargeDataset) {
    throw new TypeError("Manifest must contain qualified and opt-in large datasets.");
  }
}

export function findDataset(manifest, datasetId) {
  const dataset = manifest.datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) throw new TypeError(`Unknown external fixture dataset: ${datasetId}`);
  return dataset;
}

export function fixtureCacheRoot(manifest) {
  return resolveRepositoryOutput(manifest.cacheDirectory, "Manifest cacheDirectory");
}

export function assetCachePath(manifest, dataset, asset) {
  const datasetRoot = resolveInside(fixtureCacheRoot(manifest), dataset.id, "Dataset cache path");
  return resolveInside(datasetRoot, asset.path, `Asset ${asset.id} cache path`);
}

export function memberCachePath(manifest, dataset, member) {
  const datasetRoot = resolveInside(fixtureCacheRoot(manifest), dataset.id, "Dataset cache path");
  return resolveInside(datasetRoot, member.cachePath, `Member ${member.id} cache path`);
}

async function digestFile(path) {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    byteLength += chunk.length;
  }
  return { byteLength, sha256: hash.digest("hex") };
}

async function verifyFile(path, expected, label) {
  const actual = await digestFile(path);
  if (actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
    throw new TypeError(
      `${label} verification failed: expected ${expected.byteLength} bytes/${expected.sha256}, ` +
        `got ${actual.byteLength} bytes/${actual.sha256}.`,
    );
  }
  return actual;
}

async function fetchProviderJson(fetchImpl, url, init, label) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new TypeError(`${label} request failed.`);
  }
  if (!response.ok) {
    throw new TypeError(`${label} request failed: HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new TypeError(`${label} returned invalid JSON.`);
  }
}

function providerUrl(apiBaseUrl, path) {
  return new URL(`${apiBaseUrl.replace(/\/+$/u, "")}/${path}`);
}

async function resolveTrimbleConnectShare(dataset, fetchImpl) {
  const provider = dataset.download;
  assertTrimbleConnectDownload(provider, `Dataset ${dataset.id} download`);

  const shareUrl = providerUrl(
    provider.apiBaseUrl,
    `shares/token/${encodeURIComponent(provider.shareToken)}`,
  );
  const share = await fetchProviderJson(
    fetchImpl,
    shareUrl,
    { redirect: "error" },
    `Dataset ${dataset.id} public share`,
  );

  if (share?.mode !== "PUBLIC" || share.permission !== "DOWNLOAD") {
    throw new TypeError(`Dataset ${dataset.id} public share is not PUBLIC/DOWNLOAD.`);
  }
  if (share.projectId !== provider.projectId) {
    throw new TypeError(`Dataset ${dataset.id} public share project does not match the manifest.`);
  }
  assertNonEmptyString(share.accessToken, `Dataset ${dataset.id} public share accessToken`);
  if (!Array.isArray(share.objects)) {
    throw new TypeError(`Dataset ${dataset.id} public share objects must be an array.`);
  }

  const objectsById = new Map();
  for (const object of share.objects) {
    if (typeof object?.id !== "string" || objectsById.has(object.id)) {
      throw new TypeError(`Dataset ${dataset.id} public share has invalid object identities.`);
    }
    objectsById.set(object.id, object);
  }

  const resolvedObjects = new Map();
  for (const asset of dataset.assets) {
    const object = objectsById.get(asset.remoteObjectId);
    if (
      object?.id !== asset.remoteObjectId ||
      object.name !== asset.remoteName ||
      object.type !== "FILE" ||
      object.useLatestVersion !== true
    ) {
      throw new TypeError(
        `Dataset ${dataset.id} public share object ${asset.id} does not match the manifest.`,
      );
    }
    resolvedObjects.set(asset.id, object);
  }

  return {
    accessToken: share.accessToken,
    objectsByAssetId: resolvedObjects,
    provider,
  };
}

function createAssetDownloadResolver(dataset, fetchImpl) {
  if (dataset.download === undefined) {
    return async (asset) => asset.url;
  }

  let sharePromise;
  return async (asset) => {
    sharePromise ??= resolveTrimbleConnectShare(dataset, fetchImpl);
    const share = await sharePromise;
    const object = share.objectsByAssetId.get(asset.id);
    if (!object) {
      throw new TypeError(`Dataset ${dataset.id} public share has no object for ${asset.id}.`);
    }

    const versionId = object.id;
    const downloadUrl = providerUrl(
      share.provider.apiBaseUrl,
      `files/fs/${encodeURIComponent(object.id)}/downloadurl`,
    );
    downloadUrl.searchParams.set("versionId", versionId);
    const resolved = await fetchProviderJson(
      fetchImpl,
      downloadUrl,
      {
        redirect: "error",
        headers: {
          authorization: `Bearer ${share.accessToken}`,
          "x-share-token": share.provider.shareToken,
        },
      },
      `Dataset ${dataset.id} asset ${asset.id} download URL`,
    );
    if (resolved?.id !== object.id || resolved.versionId !== versionId) {
      throw new TypeError(
        `Dataset ${dataset.id} asset ${asset.id} download identity does not match the share.`,
      );
    }
    assertHttpsUrl(resolved.url, `Dataset ${dataset.id} asset ${asset.id} download URL`);
    return resolved.url;
  };
}

async function downloadFile(asset, targetPath, resolveDownloadUrl, fetchImpl) {
  try {
    await verifyFile(targetPath, asset, `Cached asset ${asset.id}`);
    return { downloaded: false };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.partial-${process.pid}`;
  await rm(temporaryPath, { force: true });
  const url = await resolveDownloadUrl(asset);
  let response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch {
    throw new TypeError(`Download failed for ${asset.id}.`);
  }
  if (!response.ok || response.body === null) {
    throw new TypeError(`Download failed for ${asset.id}: HTTP ${response.status}.`);
  }

  const hash = createHash("sha256");
  let byteLength = 0;
  const file = await open(temporaryPath, "wx");
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      byteLength += bytes.length;
      if (byteLength > asset.byteLength) {
        throw new TypeError(
          `Downloaded asset ${asset.id} failed verification: exceeded the pinned ` +
            `${asset.byteLength}-byte limit.`,
        );
      }
      await file.write(bytes);
    }
  } catch (error) {
    await file.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await file.close();

  const sha256 = hash.digest("hex");
  if (byteLength !== asset.byteLength || sha256 !== asset.sha256) {
    await rm(temporaryPath, { force: true });
    throw new TypeError(
      `Downloaded asset ${asset.id} failed verification: expected ` +
        `${asset.byteLength} bytes/${asset.sha256}, got ${byteLength} bytes/${sha256}.`,
    );
  }
  await rename(temporaryPath, targetPath);
  return { downloaded: true };
}

function findEndOfCentralDirectory(zip) {
  const minimumOffset = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new TypeError("ZIP end-of-central-directory record was not found.");
}

export function readZipMember(zip, requestedPath) {
  const eocdOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let offset = zip.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new TypeError("ZIP central directory is malformed.");
    }
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedLength = zip.readUInt32LE(offset + 20);
    const uncompressedLength = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (name === requestedPath) {
      if ((flags & 1) !== 0) throw new TypeError(`ZIP member ${name} is encrypted.`);
      if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new TypeError(`ZIP member ${name} has an invalid local header.`);
      }
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(dataOffset, dataOffset + compressedLength);
      const contents =
        method === 0
          ? Buffer.from(compressed)
          : method === 8
            ? inflateRawSync(compressed)
            : undefined;
      if (contents === undefined) {
        throw new TypeError(`ZIP member ${name} uses unsupported compression method ${method}.`);
      }
      if (contents.length !== uncompressedLength) {
        throw new TypeError(`ZIP member ${name} has an invalid uncompressed length.`);
      }
      return contents;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new TypeError(`ZIP member not found: ${requestedPath}`);
}

async function extractSelectedMembers(manifest, dataset, asset, archivePath) {
  const zip = await readFile(archivePath);
  for (const member of asset.archiveMembers) {
    const contents = readZipMember(zip, member.archivePath);
    const actual = {
      byteLength: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
    if (actual.byteLength !== member.byteLength || actual.sha256 !== member.sha256) {
      throw new TypeError(`Archive member ${member.id} failed verification.`);
    }
    const targetPath = memberCachePath(manifest, dataset, member);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contents);
  }
}

export async function fetchDataset(manifest, dataset, options = {}) {
  if (dataset.requiresAllowLarge && options.allowLarge !== true) {
    throw new TypeError(
      `${dataset.id} is ${dataset.expectedDownloadBytes.toLocaleString("en-US")} bytes; ` +
        "pass --allow-large to fetch it explicitly.",
    );
  }

  const selectedIds = options.assetIds ? new Set(options.assetIds) : undefined;
  if (selectedIds) {
    for (const id of selectedIds) {
      if (!dataset.assets.some((asset) => asset.id === id)) {
        throw new TypeError(`Dataset ${dataset.id} has no asset ${id}.`);
      }
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }
  const resolveDownloadUrl = createAssetDownloadResolver(dataset, fetchImpl);
  const results = [];
  for (const asset of dataset.assets) {
    if (selectedIds && !selectedIds.has(asset.id)) continue;
    const path = assetCachePath(manifest, dataset, asset);
    const result = await downloadFile(asset, path, resolveDownloadUrl, fetchImpl);
    if (asset.role === "archive") await extractSelectedMembers(manifest, dataset, asset, path);
    results.push({ id: asset.id, path, ...result });
  }
  return results;
}

export async function verifyDataset(manifest, dataset) {
  const verified = [];
  for (const asset of dataset.assets) {
    const path = assetCachePath(manifest, dataset, asset);
    await verifyFile(path, asset, `Asset ${asset.id}`);
    verified.push({ id: asset.id, format: asset.format, path });
    if (asset.role !== "archive") continue;
    for (const member of asset.archiveMembers) {
      const memberPath = memberCachePath(manifest, dataset, member);
      await verifyFile(memberPath, member, `Archive member ${member.id}`);
      verified.push({ id: member.id, format: member.format, path: memberPath });
    }
  }
  return verified;
}

function sortedRecord(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

export async function inspectPart21(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Number.POSITIVE_INFINITY });
  const entityTypes = new Map();
  let firstNonEmpty = "";
  let lastNonEmpty = "";
  let header = "";
  let readingHeader = true;
  let entityCount = 0;
  let lineCount = 0;
  let maxEntityId = 0;

  for await (const line of lines) {
    lineCount += 1;
    const trimmed = line.trim();
    if (trimmed !== "") {
      firstNonEmpty ||= trimmed;
      lastNonEmpty = trimmed;
    }
    if (readingHeader) {
      header += `${line}\n`;
      if (trimmed === "DATA;") readingHeader = false;
    }

    const match = /^\s*#(\d+)\s*=\s*(?:\(\s*)?([A-Za-z][A-Za-z0-9_]*)\s*\(/u.exec(line);
    if (!match) continue;
    const entityId = Number(match[1]);
    const entityType = match[2].toUpperCase();
    entityCount += 1;
    maxEntityId = Math.max(maxEntityId, entityId);
    entityTypes.set(entityType, (entityTypes.get(entityType) ?? 0) + 1);
  }

  const schemaStatement = /FILE_SCHEMA\s*\(\s*\(([\s\S]*?)\)\s*\)\s*;/iu.exec(header)?.[1] ?? "";
  const schemas = [...schemaStatement.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  const relationships = [...entityTypes.entries()]
    .filter(([type]) => type.startsWith("IFCREL"))
    .reduce((total, [, count]) => total + count, 0);

  return {
    envelopeValid:
      firstNonEmpty === "ISO-10303-21;" &&
      header.includes("HEADER;") &&
      !readingHeader &&
      lastNonEmpty === "END-ISO-10303-21;",
    schemas,
    lineCount,
    entityCount,
    maxEntityId,
    entityTypeCounts: sortedRecord(entityTypes.entries()),
    indicators: {
      relationships,
      mappedItems: entityTypes.get("IFCMAPPEDITEM") ?? 0,
      representationMaps: entityTypes.get("IFCREPRESENTATIONMAP") ?? 0,
      projects: entityTypes.get("IFCPROJECT") ?? 0,
      sites: entityTypes.get("IFCSITE") ?? 0,
      buildings: entityTypes.get("IFCBUILDING") ?? 0,
      storeys: entityTypes.get("IFCBUILDINGSTOREY") ?? 0,
      spaces: entityTypes.get("IFCSPACE") ?? 0,
      propertySets: entityTypes.get("IFCPROPERTYSET") ?? 0,
      singleValueProperties: entityTypes.get("IFCPROPERTYSINGLEVALUE") ?? 0,
    },
  };
}

function selectedSourceFiles(manifest, dataset) {
  const files = [];
  for (const asset of dataset.assets) {
    if (asset.role === "source") {
      files.push({ ...asset, cachePath: assetCachePath(manifest, dataset, asset) });
      continue;
    }
    for (const member of asset.archiveMembers) {
      files.push({ ...member, cachePath: memberCachePath(manifest, dataset, member) });
    }
  }
  return files;
}

export async function inspectDataset(manifest, manifestSha256, dataset) {
  await verifyDataset(manifest, dataset);
  const files = [];
  for (const source of selectedSourceFiles(manifest, dataset)) {
    files.push({
      id: source.id,
      fileName: basename(source.cachePath),
      format: source.format,
      byteLength: source.byteLength,
      sha256: source.sha256,
      part21: await inspectPart21(source.cachePath),
    });
  }

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    manifestSha256,
    dataset: {
      id: dataset.id,
      name: dataset.name,
      kind: dataset.kind,
      tier: dataset.tier,
      revision: dataset.source.revision,
      landingPage: dataset.source.landingPage,
      license: dataset.source.license,
      attribution: dataset.source.attribution,
    },
    summary: {
      fileCount: files.length,
      byteLength: files.reduce((total, file) => total + file.byteLength, 0),
      entityCount: files.reduce((total, file) => total + file.part21.entityCount, 0),
      allEnvelopesValid: files.every((file) => file.part21.envelopeValid),
    },
    files,
  };
}

export async function writeInspection(outputPath, inspection) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
}
