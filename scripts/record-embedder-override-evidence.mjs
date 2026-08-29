/**
 * Records what an embedder other than the Studio can do with the compiled
 * package loader's transfer policy.
 *
 * ADR-0011 settled ceilings and a same-origin rule for remote packages, but its
 * open gate was that nothing in this repository exercised an override: the
 * policy lived inside the Studio, and the Studio always took the defaults. The
 * policy now ships with `@naru3d/runtime-webgpu`, and `tools/package-embedder`
 * is a second consumer of it -- a headless Node host that imports only the
 * published entry point and chooses its own ceilings, origins, and transfer.
 *
 * Every scenario below runs against committed packages served over real local
 * HTTP, so an "opened" row is a decode that happened and a "refused" row is the
 * message a host would actually see. Origins are recorded under stable labels
 * because the servers bind to ephemeral ports.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const artifactDirectory = resolve(
  repositoryRoot,
  argument("--output", "artifacts/security/embedder-overrides"),
);

const { openCompiledPackage } = await import(
  pathToFileURL(resolve(repositoryRoot, "tools/package-embedder/dist/index.js")).href
);
const { defaultCompiledPackageLimits, defaultPackageTransferLimits } = await import(
  pathToFileURL(resolve(repositoryRoot, "packages/runtime-webgpu/dist/index.js")).href
);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contentTypes = new Map([
  [".gltf", "model/gltf+json"],
  [".json", "application/json"],
  [".bin", "application/octet-stream"],
]);
const contentTypeOf = (name) => {
  for (const [suffix, type] of contentTypes) if (name.endsWith(suffix)) return type;
  throw new TypeError(`No package content type for ${name}.`);
};

/** Serves a fixed set of resources, and remembers what was asked for. */
async function serveResources(resources) {
  const requests = [];
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    requests.push(path);
    const bytes = resources.get(path);
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypeOf(path),
      "Content-Length": String(bytes.byteLength),
    });
    response.end(bytes);
  });
  await new Promise((settle) => server.listen(0, "127.0.0.1", settle));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new TypeError("The resource server did not bind a port.");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    resources,
    requests,
    close: () => new Promise((settle) => server.close(() => settle(undefined))),
  };
}

const corpora = [
  { id: "ifc-explicit-edges", directory: "artifacts/ifc/explicit-edges" },
  { id: "step-repeated-fasteners", directory: "artifacts/phase1/repeated-fasteners" },
  { id: "step-repeated-fasteners-ap242", directory: "artifacts/phase1/repeated-fasteners-ap242" },
];

/** Reads a committed package: the document plus every file it names. */
async function loadCorpus(corpus) {
  const directory = resolve(repositoryRoot, corpus.directory);
  const documentBytes = await readFile(resolve(directory, "scene.gltf"));
  const document = JSON.parse(documentBytes.toString("utf8"));
  const resources = new Map([["/scene.gltf", documentBytes]]);
  const uris = new Set(document.buffers.map((buffer) => buffer.uri));
  const properties = document.extras?.madi?.properties?.uri;
  if (properties) uris.add(properties);
  for (const uri of uris) {
    resources.set(`/${uri}`, await readFile(resolve(directory, uri)));
  }
  return { ...corpus, document, documentBytes, resources };
}

const loaded = [];
for (const corpus of corpora) loaded.push(await loadCorpus(corpus));

const primary = await serveResources(
  new Map(loaded.flatMap((corpus) => [...corpus.resources].map(
    ([path, bytes]) => [`/${corpus.id}${path}`, bytes],
  ))),
);
/** A second origin, so an announced host is a real cross-origin transfer. */
const secondary = await serveResources(
  new Map(loaded.flatMap((corpus) => [...corpus.resources]
    .filter(([path]) => path !== "/scene.gltf")
    .map(([path, bytes]) => [`/${corpus.id}${path}`, bytes]))),
);

/** Servers bind ephemeral ports, so the record names origins, not addresses. */
const label = (text) => text
  .replaceAll(primary.origin, "http://origin-a")
  .replaceAll(secondary.origin, "http://origin-b");
const documentUrlOf = (corpus, origin = primary.origin) =>
  `${origin}/${corpus.id}/scene.gltf`;

/** Runs one scenario and records the outcome, opened or refused. */
async function attempt(scenario, options) {
  const before = primary.requests.length + secondary.requests.length;
  try {
    const opened = await openCompiledPackage(options);
    return {
      ...scenario,
      outcome: "opened",
      representation: opened.representation,
      documentByteLength: opened.documentByteLength,
      transferLimits: opened.transport.limits,
      origins: opened.transport.origins.map(label),
      resources: opened.resources.map((resource) => ({
        uri: label(resource.uri),
        origin: label(resource.origin),
        byteLength: resource.byteLength,
      })),
      prototypeBatches: opened.prototypeBatches,
      partOccurrences: opened.partOccurrences,
      triangles: opened.triangles,
      edgeSegments: opened.edgeSegments,
      binaryByteLength: opened.binaryByteLength,
      transfers: opened.transfers.map(label),
      servedRequests: primary.requests.length + secondary.requests.length - before,
    };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      ...scenario,
      outcome: "refused",
      errorName: error.name,
      errorMessage: label(error.message),
      servedRequests: primary.requests.length + secondary.requests.length - before,
    };
  }
}

const scenarios = [];

// The PHASE_2 regression: every committed package still opens on the reviewed
// defaults, through a consumer that shares no code with the Studio.
for (const corpus of loaded) {
  scenarios.push(await attempt(
    { id: `defaults-${corpus.id}`, corpus: corpus.id, axis: "reviewed-defaults", representation: "target" },
    { documentUrl: documentUrlOf(corpus) },
  ));
  if (corpus.document.extras?.madi?.progressive?.coarseBuffer) {
    scenarios.push(await attempt(
      { id: `defaults-coarse-${corpus.id}`, corpus: corpus.id, axis: "reviewed-defaults", representation: "coarse" },
      { documentUrl: documentUrlOf(corpus), representation: "coarse" },
    ));
  }
}

const ceilingCorpus = loaded.find((corpus) => corpus.id === "step-repeated-fasteners-ap242");
const countCorpus = loaded.find((corpus) => corpus.id === "ifc-explicit-edges");
if (!ceilingCorpus || !countCorpus) throw new TypeError("A committed corpus is missing.");
const ceilingBinaryBytes = ceilingCorpus.document.buffers[0].byteLength;

// Lowering one ceiling at a time: each refusal names the ceiling that stopped
// it, so an embedder can tell which of its own numbers was too small.
scenarios.push(await attempt(
  { id: "document-ceiling", corpus: ceilingCorpus.id, axis: "transfer-limits", override: { documentBytes: ceilingCorpus.documentBytes.byteLength - 1 } },
  { documentUrl: documentUrlOf(ceilingCorpus), policy: { limits: { documentBytes: ceilingCorpus.documentBytes.byteLength - 1 } } },
));
scenarios.push(await attempt(
  { id: "resource-ceiling", corpus: ceilingCorpus.id, axis: "transfer-limits", override: { resourceBytes: ceilingBinaryBytes - 1 } },
  { documentUrl: documentUrlOf(ceilingCorpus), policy: { limits: { resourceBytes: ceilingBinaryBytes - 1 } } },
));
scenarios.push(await attempt(
  { id: "package-ceiling", corpus: ceilingCorpus.id, axis: "transfer-limits", override: { packageBytes: 4_096 } },
  { documentUrl: documentUrlOf(ceilingCorpus), policy: { limits: { packageBytes: 4_096 } } },
));
scenarios.push(await attempt(
  { id: "resource-count-ceiling", corpus: countCorpus.id, axis: "transfer-limits", override: { resourceCount: 1 } },
  { documentUrl: documentUrlOf(countCorpus), policy: { limits: { resourceCount: 1 } } },
));

// The structural half of ADR-0011 is overridable from the same host.
scenarios.push(await attempt(
  { id: "structural-node-ceiling", corpus: ceilingCorpus.id, axis: "structural-limits", override: { nodes: 2 } },
  { documentUrl: documentUrlOf(ceilingCorpus), packageLimits: { nodes: 2 } },
));
scenarios.push(await attempt(
  { id: "structural-depth-ceiling", corpus: ceilingCorpus.id, axis: "structural-limits", override: { traversalDepth: 1 } },
  { documentUrl: documentUrlOf(ceilingCorpus), packageLimits: { traversalDepth: 1 } },
));

// No committed package is split across hosts, so the cross-origin case is a
// synthesized document: the same corpus, with its buffers moved to origin-b.
const splitDocument = {
  ...ceilingCorpus.document,
  buffers: ceilingCorpus.document.buffers.map((buffer) => ({
    ...buffer,
    uri: `${secondary.origin}/${ceilingCorpus.id}/${buffer.uri}`,
  })),
};
const splitPath = `/${ceilingCorpus.id}-split/scene.gltf`;
primary.resources.set(splitPath, Buffer.from(`${JSON.stringify(splitDocument, null, 2)}\n`, "utf8"));
const splitUrl = `${primary.origin}${splitPath}`;

scenarios.push(await attempt(
  { id: "split-host-default", corpus: ceilingCorpus.id, axis: "origins", synthesized: true },
  { documentUrl: splitUrl },
));
scenarios.push(await attempt(
  { id: "split-host-announced", corpus: ceilingCorpus.id, axis: "origins", synthesized: true, override: { additionalOrigins: ["http://origin-b"] } },
  { documentUrl: splitUrl, policy: { additionalOrigins: [secondary.origin] } },
));

// The transfer itself is the third axis: a host that resolves its own URLs
// still gets the ceilings, and never reaches the network here.
const memory = new Map([...ceilingCorpus.resources].map(
  ([path, bytes]) => [`${primary.origin}/${ceilingCorpus.id}${path}`, bytes],
));
const injected = (url) => {
  const bytes = memory.get(url.href);
  if (!bytes) return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentTypeOf(url.pathname),
      "Content-Length": String(bytes.byteLength),
    },
  }));
};
scenarios.push(await attempt(
  { id: "injected-transfer", corpus: ceilingCorpus.id, axis: "transfer", override: { fetch: "embedder-supplied" } },
  { documentUrl: documentUrlOf(ceilingCorpus), policy: { fetch: injected } },
));
scenarios.push(await attempt(
  { id: "injected-transfer-bounded", corpus: ceilingCorpus.id, axis: "transfer", override: { fetch: "embedder-supplied", resourceBytes: 4_096 } },
  { documentUrl: documentUrlOf(ceilingCorpus), policy: { fetch: injected, limits: { resourceBytes: 4_096 } } },
));

await primary.close();
await secondary.close();

const evidence = {
  schemaVersion: "naru.embedder-override-evidence.1",
  recordedAt: new Date().toISOString(),
  mode: "second-consumer-transfer-policy-matrix",
  host: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    cpuCount: availableParallelism(),
  },
  contract: {
    gate: "ADR-0011 stays Proposed until the embedder-facing override surface is settled against a second consumer.",
    consumer: "tools/package-embedder, a headless Node host that imports only the published @naru3d/runtime-webgpu entry point.",
    independence: "First-party and written alongside the surface it exercises; it is a second consumer, not an independent adopter, and it shares no code with the Studio.",
    axes: [
      "limits: the transfer ceilings a host raises or lowers",
      "additionalOrigins: hosts a package may be split across",
      "fetch: a transfer the embedder performs itself",
      "packageLimits: the structural ceilings the document is parsed under",
    ],
    regression: "Every committed package opens under the reviewed defaults through this consumer, which is the check-chain regression docs/PHASE_2.md asks for.",
  },
  method: {
    transport: "Two local HTTP servers on distinct loopback origins serve the committed packages; ports vary per run, so origins are recorded as origin-a and origin-b.",
    corpora: "Committed packages only. No package is split across hosts, so the cross-origin scenarios serve a synthesized document: the same corpus with its buffer URIs rewritten to origin-b. Those rows carry synthesized: true.",
    outcomes: "Each scenario reports opened with what the policy admitted, or refused with the error name and message a host would see. servedRequests counts HTTP requests the two servers answered during the scenario, so an injected transfer proves it never reached them.",
  },
  defaults: {
    transfer: defaultPackageTransferLimits,
    structural: defaultCompiledPackageLimits,
  },
  corpora: loaded.map((corpus) => ({
    id: corpus.id,
    directory: corpus.directory,
    documentByteLength: corpus.documentBytes.byteLength,
    documentSha256: digest(corpus.documentBytes),
    resources: [...corpus.resources]
      .filter(([path]) => path !== "/scene.gltf")
      .map(([path, bytes]) => ({
        uri: path.slice(1),
        byteLength: bytes.byteLength,
        sha256: digest(bytes),
      })),
  })),
  summary: {
    scenarios: scenarios.length,
    opened: scenarios.filter((scenario) => scenario.outcome === "opened").length,
    refused: scenarios.filter((scenario) => scenario.outcome === "refused").length,
    defaultOpens: scenarios.filter(
      (scenario) => scenario.axis === "reviewed-defaults" && scenario.outcome === "opened",
    ).length,
  },
  scenarios,
};

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  resolve(artifactDirectory, "embedder-override-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(
  `[embedder] ${String(evidence.summary.scenarios)} scenarios: ` +
    `${String(evidence.summary.opened)} opened, ${String(evidence.summary.refused)} refused ` +
    `(${String(evidence.summary.defaultOpens)} on reviewed defaults)`,
);
for (const scenario of scenarios) {
  console.log(
    `[embedder] ${scenario.id}: ${scenario.outcome}` +
      (scenario.outcome === "refused" ? ` -- ${scenario.errorName}: ${scenario.errorMessage}` : ""),
  );
}
