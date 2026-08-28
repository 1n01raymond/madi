// Rejects broken repository-local Markdown links and heading anchors.
//
// The check is portable and offline: it resolves targets against Git's tracked
// file list rather than the filesystem, so a link that only works because of a
// case-insensitive macOS volume or an untracked local file still fails here the
// way it would fail for anyone cloning the repository. External URLs are never
// fetched.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyTarget,
  collectAnchors,
  extractTargets,
  lineForOffset,
  lineStarts,
} from "./lib/markdown-links.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const exceptionsPath = resolve(repositoryRoot, "scripts/markdown-link-exceptions.json");

function trackedPaths() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = new Set(output.split("\0").filter((path) => path !== ""));
  const directories = new Set();
  for (const path of files) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return { files, directories };
}

function loadExceptions() {
  if (!existsSync(exceptionsPath)) return [];
  const parsed = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  if (!Array.isArray(parsed.exceptions)) {
    throw new TypeError("markdown-link-exceptions.json must hold an `exceptions` array.");
  }
  return parsed.exceptions.map((entry, index) => {
    for (const field of ["file", "target", "reason"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        throw new TypeError(`Exception ${index} needs a non-empty '${field}'.`);
      }
    }
    return { file: entry.file, target: entry.target, reason: entry.reason, used: false };
  });
}

function main() {
  const tree = trackedPaths();
  const markdownFiles = [...tree.files]
    .filter((path) => path.toLowerCase().endsWith(".md"))
    .sort();
  const exceptions = loadExceptions();

  const contents = new Map();
  const readMarkdown = (path) => {
    if (contents.has(path)) return contents.get(path);
    let text;
    try {
      text = readFileSync(resolve(repositoryRoot, path), "utf8");
    } catch {
      text = null;
    }
    contents.set(path, text);
    return text;
  };

  const anchorCache = new Map();
  const anchorsFor = (path) => {
    if (anchorCache.has(path)) return anchorCache.get(path);
    const text = readMarkdown(path);
    const anchors = text === null ? null : collectAnchors(text);
    anchorCache.set(path, anchors);
    return anchors;
  };

  const findings = [];
  let checked = 0;

  for (const file of markdownFiles) {
    const text = readMarkdown(file);
    if (text === null) {
      findings.push({ file, line: 1, target: file, reason: "file is unreadable" });
      continue;
    }
    const starts = lineStarts(text);
    for (const { target, offset } of extractTargets(text)) {
      const verdict = classifyTarget(file, target, tree, anchorsFor);
      if (verdict.status === "external") continue;
      checked += 1;
      if (verdict.status === "ok") continue;

      const exception = exceptions.find(
        (entry) => entry.file === file && entry.target === target,
      );
      if (exception) {
        exception.used = true;
        continue;
      }
      findings.push({
        file,
        line: lineForOffset(starts, offset),
        target,
        reason: verdict.reason,
      });
    }
  }

  const stale = exceptions.filter((entry) => !entry.used);
  for (const entry of stale) {
    findings.push({
      file: entry.file,
      line: 1,
      target: entry.target,
      reason: "exception is no longer needed; remove it from markdown-link-exceptions.json",
    });
  }

  if (findings.length > 0) {
    findings.sort(
      (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
    );
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}: '${finding.target}' — ${finding.reason}`);
    }
    console.error(
      `\n[markdown-links] ${findings.length} broken local ` +
        `${findings.length === 1 ? "target" : "targets"} across ${markdownFiles.length} files.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[markdown-links] verified ${checked} repository-local targets across ` +
      `${markdownFiles.length} Markdown files` +
      (exceptions.length > 0
        ? ` (${exceptions.length} reviewed ` +
          `${exceptions.length === 1 ? "exception" : "exceptions"})`
        : ""),
  );
}

main();
