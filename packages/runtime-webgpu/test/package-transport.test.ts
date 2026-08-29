import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPackageBudget,
  assertPackageOrigin,
  assertPackageUrl,
  openPackageTransport,
  PackageTransport,
  defaultPackageTransferLimits,
  fetchPackageResource,
  openPackageResponse,
  readBoundedBody,
  resolvePackageResourceUrl,
  resolvePackageTransferLimits,
} from "../src/package-transport.js";

const documentUrl = new URL("https://example.com/package/scene.gltf");

function streamed(
  chunks: readonly Uint8Array[],
  headers: Record<string, string>,
  status = 200,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("package resource URLs", () => {
  it("resolves relative resources against the document", () => {
    expect(resolvePackageResourceUrl("geometry/scene.bin", documentUrl, "scene.gltf").href).toBe(
      "https://example.com/package/geometry/scene.bin",
    );
  });

  it("refuses another origin, another scheme, and embedded credentials", () => {
    expect(() =>
      resolvePackageResourceUrl("https://attacker.example/scene.bin", documentUrl, "scene.gltf"),
    ).toThrow(/must stay on https:\/\/example\.com/u);
    expect(() =>
      resolvePackageResourceUrl("data:application/octet-stream,AAAA", documentUrl, "scene.gltf"),
    ).toThrow(/HTTP or HTTPS/u);
    expect(() =>
      resolvePackageResourceUrl("https://user:pass@example.com/x.bin", documentUrl, "scene.gltf"),
    ).toThrow(/credentials/u);
    expect(() => assertPackageUrl(new URL("ftp://example.com/x.bin"), "resource")).toThrow(
      /HTTP or HTTPS/u,
    );
  });
});

describe("package budget", () => {
  const limits = resolvePackageTransferLimits({
    documentBytes: 1_000,
    resourceBytes: 500,
    packageBytes: 1_400,
    resourceCount: 2,
  });

  it("accepts a package inside every ceiling", () => {
    expect(() =>
      assertPackageBudget(400, [{ uri: "a.bin", byteLength: 500 }, { uri: "b.bin", byteLength: 500 }], limits),
    ).not.toThrow();
  });

  it("refuses too many resources, an oversized document, and an oversized resource", () => {
    const three = [1, 2, 3].map((n) => ({ uri: `${String(n)}.bin`, byteLength: 1 }));
    expect(() => assertPackageBudget(10, three, limits)).toThrow(/declares 3 external resources/u);
    expect(() => assertPackageBudget(1_001, [], limits)).toThrow(/document declares 1001 bytes/u);
    expect(() => assertPackageBudget(10, [{ uri: "a.bin", byteLength: 501 }], limits)).toThrow(
      /a\.bin declares 501 bytes/u,
    );
  });

  it("refuses an aggregate over the package ceiling and an unusable length", () => {
    expect(() =>
      assertPackageBudget(500, [{ uri: "a.bin", byteLength: 500 }, { uri: "b.bin", byteLength: 500 }], limits),
    ).toThrow(/more than 1400 bytes/u);
    expect(() =>
      assertPackageBudget(10, [{ uri: "a.bin", byteLength: -1 }], limits),
    ).toThrow(/unusable byte length/u);
    expect(() =>
      assertPackageBudget(10, [{ uri: "a.bin", byteLength: Number.MAX_VALUE }], limits),
    ).toThrow(/unusable byte length/u);
  });

  it("validates limit overrides and keeps the reviewed defaults otherwise", () => {
    expect(resolvePackageTransferLimits({ resourceCount: 8 })).toEqual({
      ...defaultPackageTransferLimits,
      resourceCount: 8,
    });
    expect(() => resolvePackageTransferLimits({ documentBytes: 0 })).toThrow(/positive safe integer/u);
    expect(() => resolvePackageTransferLimits({ resourceBytes: 1.5 })).toThrow(/positive safe integer/u);
  });
});

describe("package transport policy", () => {
  it("fetches without following redirects or reading a cache, and asks for the range", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Uint8Array(4)),
    );
    vi.stubGlobal("fetch", fetchMock);

    await openPackageResponse(documentUrl, {
      kind: "gltf",
      label: "scene.gltf",
      range: { byteOffset: 16, byteLength: 8 },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch was called without an init object.");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string> | undefined)?.Range).toBe("bytes=16-23");
  });

  it("refuses a document type where a package resource was expected", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    );

    await expect(
      openPackageResponse(documentUrl, { kind: "gltf", label: "scene.gltf" }),
    ).rejects.toThrow(/served as text\/html/u);
  });

  it("accepts the types the compiler declares and reports a failed status", async () => {
    for (const [kind, type] of [
      ["gltf", "model/gltf+json"],
      ["json", "application/json"],
      ["binary", "application/octet-stream"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        async () => new Response(new Uint8Array(2), { headers: { "Content-Type": type } }),
      );
      await expect(
        openPackageResponse(documentUrl, { kind, label: "resource" }),
      ).resolves.toBeInstanceOf(Response);
    }
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(
      openPackageResponse(documentUrl, { kind: "binary", label: "scene.bin" }),
    ).rejects.toThrow(/Failed to load scene\.bin \(404\)/u);
  });
});

describe("bounded response bodies", () => {
  it("reads a body that matches its declared length", async () => {
    const response = streamed(
      [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
      { "Content-Length": "4" },
    );

    await expect(readBoundedBody(response, 8, "scene.bin")).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("refuses a body longer than the length it declared", async () => {
    const response = streamed([new Uint8Array(4), new Uint8Array(4)], { "Content-Length": "4" });

    await expect(readBoundedBody(response, 64, "scene.bin")).rejects.toThrow(
      /sent more than the 4 bytes it declared/u,
    );
  });

  it("refuses a truncated body and an unusable declared length", async () => {
    const truncated = streamed([new Uint8Array(2)], { "Content-Length": "4" });
    await expect(readBoundedBody(truncated, 64, "scene.bin")).rejects.toThrow(
      /ended after 2 of 4 declared bytes/u,
    );

    const nonsense = streamed([new Uint8Array(2)], { "Content-Length": "not-a-number" });
    await expect(readBoundedBody(nonsense, 64, "scene.bin")).rejects.toThrow(
      /unusable Content-Length/u,
    );
  });

  it("refuses a declared length over the limit without reading the body", async () => {
    const response = streamed([new Uint8Array(128)], { "Content-Length": "128" });

    await expect(readBoundedBody(response, 64, "scene.bin")).rejects.toThrow(
      /declares 128 bytes; the limit is 64/u,
    );
    expect(response.bodyUsed).toBe(false);
  });

  it("bounds a body that declares no length, and cancels the transfer", async () => {
    const short = streamed([new Uint8Array(2), new Uint8Array(2)], {});
    await expect(readBoundedBody(short, 64, "scene.bin")).resolves.toHaveLength(4);

    // A body with no declared end keeps arriving until the ceiling stops it.
    let cancelled = false;
    const long = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(40));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(readBoundedBody(long, 64, "scene.bin")).rejects.toThrow(
      /larger than 64 bytes/u,
    );
    expect(cancelled).toBe(true);
  });

  it("applies the whole policy in one call", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        streamed([new Uint8Array([7, 7, 7])], {
          "Content-Type": "application/octet-stream",
          "Content-Length": "3",
        }),
    );

    await expect(
      fetchPackageResource(documentUrl, { kind: "binary", label: "scene.bin", limitBytes: 3 }),
    ).resolves.toEqual(new Uint8Array([7, 7, 7]));
  });
});

describe("embedder transport policy", () => {
  it("holds resources to the document origin unless the embedder announces another", () => {
    const strict = openPackageTransport(documentUrl);
    expect(() => strict.resolveResourceUrl("https://cdn.example/scene.bin")).toThrow(
      /must stay on https:\/\/example\.com/u,
    );

    const split = openPackageTransport(documentUrl, {
      additionalOrigins: ["https://cdn.example"],
    });
    expect(split.resolveResourceUrl("https://cdn.example/scene.bin").href).toBe(
      "https://cdn.example/scene.bin",
    );
    // The document origin stays first, and is never announced twice.
    expect(split.origins).toEqual(["https://example.com", "https://cdn.example"]);
    expect(
      openPackageTransport(documentUrl, { additionalOrigins: ["https://example.com"] }).origins,
    ).toEqual(["https://example.com"]);
    expect(() =>
      assertPackageOrigin(new URL("https://other.example/x.bin"), split.origins, "scene.gltf"),
    ).toThrow(/must stay on https:\/\/example\.com, https:\/\/cdn\.example/u);
  });

  it("applies the embedder's ceilings to the budget and to a single resource", () => {
    const lowered = openPackageTransport(documentUrl, {
      limits: { documentBytes: 1_000, resourceBytes: 500 },
    });
    expect(lowered.limits.documentBytes).toBe(1_000);
    // Unstated ceilings keep the reviewed default.
    expect(lowered.limits.packageBytes).toBe(defaultPackageTransferLimits.packageBytes);
    expect(() => lowered.assertBudget(1_001, [])).toThrow(
      /The glTF document declares 1001 bytes; the limit is 1000\./u,
    );
    expect(lowered.resourceLimit(200)).toBe(200);
    // A resource may declare more than the policy allows; the policy wins.
    expect(lowered.resourceLimit(5_000)).toBe(500);
    expect(lowered.resourceLimit()).toBe(500);
  });

  it("fetches through an injected transfer, still under the policy", async () => {
    const global = vi.fn(async () => new Response(new Uint8Array(4)));
    vi.stubGlobal("fetch", global);
    const injected = vi.fn(
      async (_url: URL, _init: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "Content-Length": "4", "Content-Type": "application/octet-stream" },
        }),
    );
    const transport = openPackageTransport(documentUrl, {
      limits: { resourceBytes: 2 },
      fetch: injected,
    });

    // The lowered ceiling refuses this body on its declared length alone, and
    // the injected transfer is what delivered it.
    await expect(
      transport.fetchResource(new URL("https://example.com/package/a.bin"), {
        kind: "binary",
        label: "a.bin",
        limitBytes: transport.resourceLimit(4),
      }),
    ).rejects.toThrow(/a\.bin declares 4 bytes; the limit is 2\./u);
    expect(injected).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();

    const wide = openPackageTransport(documentUrl, { fetch: injected });
    const bytes = await wide.fetchResource(new URL("https://example.com/package/a.bin"), {
      kind: "binary",
      label: "a.bin",
      limitBytes: wide.resourceLimit(4),
    });
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(injected).toHaveBeenCalledTimes(2);

    await expect(
      transport.fetchResource(new URL("https://attacker.example/a.bin"), {
        kind: "binary",
        label: "a.bin",
        limitBytes: 4,
      }),
    ).rejects.toThrow(/must stay on https:\/\/example\.com/u);
  });

  it("carries a resolved policy across a Worker boundary without widening it", () => {
    const transport = openPackageTransport(documentUrl, {
      limits: { resourceBytes: 512 },
      additionalOrigins: ["https://cdn.example"],
      fetch: async () => new Response(null),
    });
    const descriptor = transport.describe();
    expect(descriptor).toEqual({
      documentUrl: documentUrl.href,
      limits: transport.limits,
      origins: ["https://example.com", "https://cdn.example"],
    });
    expect(structuredClone(descriptor)).toEqual(descriptor);

    const rebuilt = PackageTransport.fromDescriptor(descriptor);
    expect(rebuilt.limits).toEqual(transport.limits);
    expect(rebuilt.origins).toEqual(transport.origins);
    expect(rebuilt.resolveResourceUrl("https://cdn.example/x.bin").href).toBe(
      "https://cdn.example/x.bin",
    );
    expect(() => rebuilt.resolveResourceUrl("https://other.example/x.bin")).toThrow(
      /must stay on/u,
    );
  });
});
