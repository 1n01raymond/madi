import { describe, expect, it } from "vitest";

import {
  defaultScenePackageUrlVariable,
  resolveDefaultSceneUrl,
} from "../src/default-scene.js";

const pageHref = "https://1n01raymond.github.io/naru/studio/?scene=x";
const siteBuild = { baseUrl: "/naru/studio/" };

describe("resolveDefaultSceneUrl", () => {
  it("keeps the site-relative document when no delivery origin is configured", () => {
    expect(resolveDefaultSceneUrl(siteBuild, pageHref).href).toBe(
      "https://1n01raymond.github.io/naru/studio/scene.gltf",
    );
  });

  it("treats an unset repository variable's empty string as unconfigured", () => {
    for (const configuredPackageUrl of ["", "   ", undefined, null]) {
      expect(
        resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl }, pageHref).href,
      ).toBe("https://1n01raymond.github.io/naru/studio/scene.gltf");
    }
  });

  it("resolves the site-relative document against the page, not the site root", () => {
    expect(
      resolveDefaultSceneUrl({ baseUrl: "./" }, "http://localhost:5173/nested/index.html").href,
    ).toBe("http://localhost:5173/nested/scene.gltf");
  });

  it("opens a configured delivery origin verbatim", () => {
    const configuredPackageUrl = " https://packages.example.com/naru/dh-0e2ed454/scene.gltf ";
    expect(resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl }, pageHref).href).toBe(
      "https://packages.example.com/naru/dh-0e2ed454/scene.gltf",
    );
  });

  it("allows a plain-HTTP origin, which local delivery testing needs", () => {
    const configuredPackageUrl = "http://127.0.0.1:8787/dh/scene.gltf";
    expect(resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl }, pageHref).href).toBe(
      "http://127.0.0.1:8787/dh/scene.gltf",
    );
  });

  it("refuses a relative value instead of resolving it back against the site", () => {
    expect(() =>
      resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl: "packages/scene.gltf" }, pageHref),
    ).toThrow(/must be an absolute URL/u);
  });

  it("refuses a scheme the transport cannot fetch", () => {
    expect(() =>
      resolveDefaultSceneUrl(
        { ...siteBuild, configuredPackageUrl: "ftp://packages.example.com/scene.gltf" },
        pageHref,
      ),
    ).toThrow(/must use HTTP or HTTPS/u);
  });

  it("refuses embedded credentials", () => {
    expect(() =>
      resolveDefaultSceneUrl(
        { ...siteBuild, configuredPackageUrl: "https://user:secret@packages.example.com/scene.gltf" },
        pageHref,
      ),
    ).toThrow(/must not carry credentials/u);
  });

  it("refuses a query or fragment, neither of which survives resource resolution", () => {
    for (const configuredPackageUrl of [
      "https://packages.example.com/dh/scene.gltf?token=abc",
      "https://packages.example.com/dh/scene.gltf#view",
    ]) {
      expect(() => resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl }, pageHref)).toThrow(
        /must not carry a query or fragment/u,
      );
    }
  });

  it("refuses a directory URL, whose resources would resolve one level up", () => {
    expect(() =>
      resolveDefaultSceneUrl(
        { ...siteBuild, configuredPackageUrl: "https://packages.example.com/dh/" },
        pageHref,
      ),
    ).toThrow(/must name a compiled glTF document/u);
  });

  it("refuses a non-string configuration value", () => {
    expect(() =>
      resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl: 42 }, pageHref),
    ).toThrow(/must be a string/u);
  });

  it("names the variable in every refusal so a broken deploy says what to fix", () => {
    expect(() =>
      resolveDefaultSceneUrl({ ...siteBuild, configuredPackageUrl: "nope" }, pageHref),
    ).toThrow(new RegExp(defaultScenePackageUrlVariable, "u"));
  });
});
