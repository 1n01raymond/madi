import { describe, expect, it } from "vitest";

import {
  classifyTarget,
  collectAnchors,
  extractTargets,
  headingSlug,
  lineForOffset,
  lineStarts,
  maskCodeAndComments,
  resolveRepositoryPath,
  splitTarget,
} from "../../../scripts/lib/markdown-links.mjs";

/** A tracked-path tree standing in for `git ls-files` in these tests. */
const tree = {
  files: new Set([
    "README.md",
    "docs/ROADMAP.md",
    "docs/adr/0001-product-wedge.md",
    "docs/media/naru-hero.svg",
    "docs/media/a file.png",
  ]),
  directories: new Set(["docs", "docs/adr", "docs/media"]),
};

const anchorSources: Record<string, string> = {
  "README.md": "# Title\n\n## Second Section\n",
  "docs/ROADMAP.md": "# Roadmap\n\n## Phase 1 — Vertical slice\n",
};

function anchorsFor(path: string): Set<string> | null {
  const text = anchorSources[path];
  return text === undefined ? null : collectAnchors(text);
}

function classify(file: string, target: string) {
  return classifyTarget(file, target, tree, anchorsFor);
}

function targetsOf(text: string): string[] {
  return extractTargets(text).map((entry: { target: string }) => entry.target);
}

describe("extractTargets", () => {
  it("reads inline links, images, reference definitions, and HTML attributes", () => {
    const text = [
      "[relative](docs/ROADMAP.md)",
      "![local image](docs/media/naru-hero.svg)",
      "[reference]: docs/adr/0001-product-wedge.md",
      '<a href="README.md">html</a>',
      '<img src="docs/media/naru-hero.svg" alt="x" />',
    ].join("\n");

    expect(targetsOf(text)).toStrictEqual([
      "docs/ROADMAP.md",
      "docs/media/naru-hero.svg",
      "docs/adr/0001-product-wedge.md",
      "README.md",
      "docs/media/naru-hero.svg",
    ]);
  });

  it("ignores targets inside fenced code, inline code, and HTML comments", () => {
    const text = [
      "```md",
      "[fenced](docs/NOPE.md)",
      "```",
      "`[inline](docs/NOPE.md)`",
      "<!-- [commented](docs/NOPE.md) -->",
      "[real](docs/ROADMAP.md)",
    ].join("\n");

    expect(targetsOf(text)).toStrictEqual(["docs/ROADMAP.md"]);
  });

  it("ignores a tilde fence and a fence that stays open to end of file", () => {
    const tilde = ["~~~", "[a](docs/NOPE.md)", "~~~", "[b](README.md)"].join("\n");
    expect(targetsOf(tilde)).toStrictEqual(["README.md"]);

    const unclosed = ["```", "[a](docs/NOPE.md)"].join("\n");
    expect(targetsOf(unclosed)).toStrictEqual([]);
  });

  it("handles angle-bracket destinations, titles, and nested brackets", () => {
    const text = [
      "[spaces](<docs/media/a file.png>)",
      '[titled](docs/ROADMAP.md "Roadmap")',
      "[text [with] brackets](README.md)",
    ].join("\n");

    expect(targetsOf(text)).toStrictEqual([
      "docs/media/a file.png",
      "docs/ROADMAP.md",
      "README.md",
    ]);
  });

  it("does not treat a bare bracket span as a link", () => {
    expect(targetsOf("[not a link] and [neither][ref]")).toStrictEqual([]);
  });
});

describe("headingSlug and collectAnchors", () => {
  it("slugs like GitHub, keeping Unicode letters", () => {
    expect(headingSlug("Where to start")).toBe("where-to-start");
    expect(headingSlug("Phase 1 — Vertical slice")).toBe("phase-1--vertical-slice");
    expect(headingSlug("현재 컴파일러 증거")).toBe("현재-컴파일러-증거");
    expect(headingSlug("現在のコンパイラ検証")).toBe("現在のコンパイラ検証");
    expect(headingSlug("`code` and **bold**")).toBe("code-and-bold");
    expect(headingSlug("A [linked](x.md) heading")).toBe("a-linked-heading");
  });

  it("suffixes duplicate headings the way GitHub does", () => {
    const anchors = collectAnchors("# Notes\n\n# Notes\n\n# Notes\n");
    expect([...anchors].sort()).toStrictEqual(["notes", "notes-1", "notes-2"]);
  });

  it("collects setext headings and explicit HTML ids", () => {
    const anchors = collectAnchors(
      ['Underlined', '========', '', '<a id="manual-anchor"></a>'].join("\n"),
    );
    expect(anchors.has("underlined")).toBe(true);
    expect(anchors.has("manual-anchor")).toBe(true);
  });

  it("ignores headings inside fenced code", () => {
    const anchors = collectAnchors(["```", "# Not a heading", "```", "# Real"].join("\n"));
    expect(anchors.has("not-a-heading")).toBe(false);
    expect(anchors.has("real")).toBe(true);
  });
});

describe("splitTarget", () => {
  it("percent-decodes path components and fragments", () => {
    expect(splitTarget("docs/media/a%20file.png")).toStrictEqual({
      path: "docs/media/a file.png",
      fragment: "",
    });
    expect(splitTarget("docs/ROADMAP.md#phase-1")).toStrictEqual({
      path: "docs/ROADMAP.md",
      fragment: "phase-1",
    });
    expect(splitTarget("#%ED%98%84%EC%9E%AC")).toStrictEqual({ path: "", fragment: "현재" });
  });

  it("reports malformed percent-encoding instead of throwing", () => {
    expect(splitTarget("docs/%ZZ.md")).toStrictEqual({
      reason: "target is not valid percent-encoding",
    });
  });
});

describe("resolveRepositoryPath", () => {
  it("resolves relative to the containing file and normalizes traversal", () => {
    expect(resolveRepositoryPath("docs/ROADMAP.md", "adr/0001-product-wedge.md")).toBe(
      "docs/adr/0001-product-wedge.md",
    );
    expect(resolveRepositoryPath("docs/adr/0001-product-wedge.md", "../ROADMAP.md")).toBe(
      "docs/ROADMAP.md",
    );
    expect(resolveRepositoryPath("docs/ROADMAP.md", "./PHASE_0.md")).toBe("docs/PHASE_0.md");
  });

  it("refuses paths that leave the repository root", () => {
    expect(resolveRepositoryPath("README.md", "../outside.md")).toBeNull();
    expect(resolveRepositoryPath("docs/ROADMAP.md", "../../../etc/passwd")).toBeNull();
  });
});

describe("classifyTarget", () => {
  it("accepts tracked files, local images, and directory targets", () => {
    expect(classify("README.md", "docs/ROADMAP.md").status).toBe("ok");
    expect(classify("README.md", "docs/media/naru-hero.svg").status).toBe("ok");
    expect(classify("README.md", "docs/adr").status).toBe("ok");
    expect(classify("README.md", "docs/media/a%20file.png").status).toBe("ok");
  });

  it("rejects missing paths with the resolved path in the reason", () => {
    const verdict = classify("docs/ROADMAP.md", "MISSING.md");
    expect(verdict).toStrictEqual({
      status: "broken",
      reason: "no tracked file or directory at 'docs/MISSING.md'",
    });
  });

  it("checks same-file and cross-file anchors", () => {
    expect(classify("README.md", "#second-section").status).toBe("ok");
    expect(classify("README.md", "docs/ROADMAP.md#phase-1--vertical-slice").status).toBe("ok");
    expect(classify("README.md", "#nope")).toStrictEqual({
      status: "broken",
      reason: "no heading anchor '#nope' in this file",
    });
    expect(classify("README.md", "docs/ROADMAP.md#nope")).toStrictEqual({
      status: "broken",
      reason: "no heading anchor '#nope' in 'docs/ROADMAP.md'",
    });
  });

  it("does not demand anchors from non-Markdown targets", () => {
    expect(classify("README.md", "docs/media/naru-hero.svg#gradient").status).toBe("ok");
  });

  it("skips documented external schemes and protocol-relative URLs", () => {
    expect(classify("README.md", "https://example.com/a").status).toBe("external");
    expect(classify("README.md", "http://example.com/a").status).toBe("external");
    expect(classify("README.md", "mailto:someone@example.com").status).toBe("external");
    expect(classify("README.md", "//example.com/a").status).toBe("external");
  });

  it("reports an undocumented scheme rather than silently skipping it", () => {
    expect(classify("README.md", "htp://example.com")).toStrictEqual({
      status: "broken",
      reason: "unsupported URI scheme 'htp:'",
    });
  });

  it("rejects repository escapes, root-absolute paths, and empty targets", () => {
    expect(classify("README.md", "../outside.md")).toStrictEqual({
      status: "broken",
      reason: "path escapes the repository root",
    });
    expect(classify("README.md", "/docs/ROADMAP.md")).toStrictEqual({
      status: "broken",
      reason: "root-absolute path does not resolve inside the repository",
    });
    expect(classify("README.md", "#")).toStrictEqual({
      status: "broken",
      reason: "empty target",
    });
  });
});

describe("offset reporting", () => {
  it("maps offsets back to 1-based line numbers", () => {
    const text = "line one\nline two\n\nline four";
    const starts = lineStarts(text);
    expect(lineForOffset(starts, 0)).toBe(1);
    expect(lineForOffset(starts, text.indexOf("two"))).toBe(2);
    expect(lineForOffset(starts, text.indexOf("four"))).toBe(4);
  });

  it("reports the line of each extracted target", () => {
    const text = ["intro", "", "see [a](README.md)", "and [b](docs/ROADMAP.md)"].join("\n");
    const starts = lineStarts(text);
    const lines = extractTargets(text).map((entry: { offset: number }) =>
      lineForOffset(starts, entry.offset),
    );
    expect(lines).toStrictEqual([3, 4]);
  });

  it("masks exactly the fenced region", () => {
    const text = ["a", "```", "b", "```", "c"].join("\n");
    const mask = maskCodeAndComments(text);
    expect(mask[0]).toBe(0);
    expect(mask[text.indexOf("b")]).toBe(1);
    expect(mask[text.lastIndexOf("c")]).toBe(0);
  });
});
