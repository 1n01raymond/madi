// Repository-local Markdown link and anchor validation.
//
// The functions here are pure: they take Markdown text and a set of known
// repository paths, and return findings. Discovery, process exit, and
// reporting live in scripts/validate-markdown-links.mjs so the parsing rules
// can be unit-tested without a checkout.

/**
 * URI schemes this repository deliberately does not resolve. Anything else
 * that looks like a scheme is reported so a typo such as `htp://` or an
 * unreviewed scheme stays visible instead of being silently skipped.
 */
export const externalSchemes = new Set([
  "ftp",
  "ftps",
  "http",
  "https",
  "irc",
  "mailto",
  "news",
  "ssh",
  "tel",
]);

const schemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const atxHeadingPattern = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/u;
const setextUnderlinePattern = /^ {0,3}(=+|-+)\s*$/u;
const htmlIdPattern = /\b(?:id|name)\s*=\s*"([^"]+)"/gu;

/**
 * Marks every character that sits inside a fenced code block, an inline code
 * span, or an HTML comment. Masked offsets are ignored by every extractor, so
 * documentation that *shows* a broken link in an example stays valid.
 *
 * @param {string} text
 * @returns {Uint8Array} one byte per character; 1 means "ignore".
 */
export function maskCodeAndComments(text) {
  const mask = new Uint8Array(text.length);
  const lines = text.split("\n");

  let offset = 0;
  let fence = null;
  for (const line of lines) {
    const match = fencePattern.exec(line);
    if (fence === null) {
      if (match) {
        fence = { marker: match[1][0], length: match[1].length };
        mask.fill(1, offset, offset + line.length);
      }
    } else {
      mask.fill(1, offset, offset + line.length);
      const closes =
        match &&
        match[1][0] === fence.marker &&
        match[1].length >= fence.length &&
        match[2].trim() === "";
      if (closes) fence = null;
    }
    offset += line.length + 1;
  }

  maskInlineCode(text, mask);
  maskHtmlComments(text, mask);
  return mask;
}

function maskInlineCode(text, mask) {
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`" || mask[index] === 1) {
      index += 1;
      continue;
    }
    let openEnd = index;
    while (openEnd < text.length && text[openEnd] === "`") openEnd += 1;
    const runLength = openEnd - index;

    let cursor = openEnd;
    let closeStart = -1;
    while (cursor < text.length) {
      // An inline code span never spans a blank line.
      if (text.startsWith("\n\n", cursor)) break;
      if (text[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let runEnd = cursor;
      while (runEnd < text.length && text[runEnd] === "`") runEnd += 1;
      if (runEnd - cursor === runLength) {
        closeStart = cursor;
        break;
      }
      cursor = runEnd;
    }

    if (closeStart === -1) {
      index = openEnd;
      continue;
    }
    mask.fill(1, index, closeStart + runLength);
    index = closeStart + runLength;
  }
}

function maskHtmlComments(text, mask) {
  let index = text.indexOf("<!--");
  while (index !== -1) {
    if (mask[index] === 1) {
      index = text.indexOf("<!--", index + 4);
      continue;
    }
    const end = text.indexOf("-->", index + 4);
    const stop = end === -1 ? text.length : end + 3;
    mask.fill(1, index, stop);
    index = text.indexOf("<!--", stop);
  }
}

/**
 * Offsets of the first character of every line, for offset-to-line reporting.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

/**
 * @param {number[]} starts result of lineStarts
 * @param {number} offset
 * @returns {number} 1-based line number
 */
export function lineForOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/**
 * Reads a Markdown link destination that starts at `start` (the character
 * after the opening parenthesis), honouring `<...>` destinations, nested
 * parentheses, backslash escapes, and an optional title.
 *
 * @returns {{destination: string} | null}
 */
function readInlineDestination(text, start) {
  let index = start;
  while (index < text.length && /\s/u.test(text[index])) index += 1;

  if (text[index] === "<") {
    const end = text.indexOf(">", index + 1);
    if (end === -1) return null;
    const destination = text.slice(index + 1, end);
    if (destination.includes("\n")) return null;
    return { destination };
  }

  let depth = 0;
  const characters = [];
  while (index < text.length) {
    const character = text[index];
    if (character === "\\" && index + 1 < text.length) {
      characters.push(text[index + 1]);
      index += 2;
      continue;
    }
    if (/\s/u.test(character)) break;
    if (character === "(") depth += 1;
    if (character === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    characters.push(character);
    index += 1;
  }
  return { destination: characters.join("") };
}

/**
 * Extracts every repository-checkable target from Markdown text: inline links
 * and images, link reference definitions, and HTML `href`/`src` attributes.
 *
 * @param {string} text
 * @returns {{target: string, offset: number}[]}
 */
export function extractTargets(text) {
  const mask = maskCodeAndComments(text);
  const found = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "[" || mask[index] === 1) continue;
    // Walk to the matching close bracket so nested brackets in link text work.
    let depth = 1;
    let cursor = index + 1;
    while (cursor < text.length && depth > 0) {
      const character = text[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "[") depth += 1;
      else if (character === "]") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) continue;
    if (text[cursor] !== "(") continue;
    const destination = readInlineDestination(text, cursor + 1);
    if (destination && destination.destination !== "") {
      found.push({ target: destination.destination, offset: index });
    }
    index = cursor;
  }

  collectReferenceDefinitions(text, mask, found);
  collectHtmlAttributes(text, mask, found);

  found.sort((left, right) => left.offset - right.offset);
  return found;
}

function collectReferenceDefinitions(text, mask, found) {
  const pattern = /^ {0,3}\[([^\]]+)\]:\s*(\S+)/gmu;
  let match = pattern.exec(text);
  while (match !== null) {
    if (mask[match.index] !== 1) {
      const destination = match[2].replace(/^<|>$/gu, "");
      if (destination !== "") found.push({ target: destination, offset: match.index });
    }
    match = pattern.exec(text);
  }
}

function collectHtmlAttributes(text, mask, found) {
  const pattern = /\b(?:href|src)\s*=\s*"([^"]*)"/gu;
  let match = pattern.exec(text);
  while (match !== null) {
    if (mask[match.index] !== 1 && match[1].trim() !== "") {
      found.push({ target: match[1].trim(), offset: match.index });
    }
    match = pattern.exec(text);
  }
}

/**
 * GitHub's heading slug: strip inline formatting, lowercase, drop characters
 * that are neither letters, numbers, marks, underscores, spaces, nor hyphens,
 * then join words with hyphens. Unicode letters survive, so Korean and
 * Japanese headings keep working anchors.
 *
 * @param {string} heading raw heading text
 * @returns {string}
 */
export function headingSlug(heading) {
  const plain = heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/`+/gu, "")
    .replace(/[*_~]+/gu, "");

  return plain
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
    .replace(/ /gu, "-");
}

/**
 * Every anchor a Markdown document exposes: heading slugs (with GitHub's
 * `-1`, `-2` suffixes for repeated headings) plus explicit HTML `id`/`name`
 * attributes.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function collectAnchors(text) {
  const mask = maskCodeAndComments(text);
  const starts = lineStarts(text);
  const lines = text.split("\n");
  const anchors = new Set();
  const seen = new Map();

  const addHeading = (raw) => {
    const slug = headingSlug(raw);
    if (slug === "") return;
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (mask[starts[index]] === 1) continue;
    const line = lines[index];

    const atx = atxHeadingPattern.exec(line);
    if (atx) {
      addHeading((atx[2] ?? "").replace(/\s+#+\s*$/u, ""));
      continue;
    }

    const underline = setextUnderlinePattern.exec(line);
    const previous = index > 0 ? lines[index - 1] : "";
    if (underline && previous.trim() !== "" && !atxHeadingPattern.test(previous)) {
      addHeading(previous.trim());
    }
  }

  htmlIdPattern.lastIndex = 0;
  let match = htmlIdPattern.exec(text);
  while (match !== null) {
    if (mask[match.index] !== 1) anchors.add(match[1]);
    match = htmlIdPattern.exec(text);
  }
  return anchors;
}

/**
 * Splits a link target into its path and fragment, percent-decoding each path
 * component. Returns a `reason` instead of throwing when the target cannot be
 * decoded.
 *
 * @param {string} target
 * @returns {{path: string, fragment: string} | {reason: string}}
 */
export function splitTarget(target) {
  const hashIndex = target.indexOf("#");
  const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? "" : target.slice(hashIndex + 1);

  let path;
  let fragment;
  try {
    path = rawPath
      .split("/")
      .map((component) => decodeURIComponent(component))
      .join("/");
    fragment = decodeURIComponent(rawFragment);
  } catch {
    return { reason: "target is not valid percent-encoding" };
  }
  return { path, fragment };
}

/**
 * Classifies one target found in `file`.
 *
 * @param {string} file repository-relative path of the containing Markdown file
 * @param {string} target raw link target
 * @param {{files: Set<string>, directories: Set<string>}} tree tracked paths
 * @param {(path: string) => Set<string> | null} anchorsFor resolves anchors for
 *   a tracked Markdown path, or null when it cannot be read
 * @returns {{status: "ok"} | {status: "external"} | {status: "broken", reason: string}}
 */
export function classifyTarget(file, target, tree, anchorsFor) {
  if (target.startsWith("//")) return { status: "external" };

  const schemeMatch = schemePattern.exec(target);
  if (schemeMatch) {
    const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
    if (externalSchemes.has(scheme)) return { status: "external" };
    return { status: "broken", reason: `unsupported URI scheme '${scheme}:'` };
  }

  if (target.startsWith("/")) {
    return {
      status: "broken",
      reason: "root-absolute path does not resolve inside the repository",
    };
  }

  const split = splitTarget(target);
  if ("reason" in split) return { status: "broken", reason: split.reason };
  const { path, fragment } = split;

  if (path === "") {
    if (fragment === "") return { status: "broken", reason: "empty target" };
    const anchors = anchorsFor(file);
    if (anchors === null) return { status: "broken", reason: "containing file is unreadable" };
    if (!anchors.has(fragment)) {
      return { status: "broken", reason: `no heading anchor '#${fragment}' in this file` };
    }
    return { status: "ok" };
  }

  const resolved = resolveRepositoryPath(file, path);
  if (resolved === null) {
    return { status: "broken", reason: "path escapes the repository root" };
  }

  const isFile = tree.files.has(resolved);
  if (!isFile && !tree.directories.has(resolved)) {
    return { status: "broken", reason: `no tracked file or directory at '${resolved}'` };
  }

  if (fragment === "" || !isFile) return { status: "ok" };
  if (!resolved.toLowerCase().endsWith(".md")) return { status: "ok" };

  const anchors = anchorsFor(resolved);
  if (anchors === null) return { status: "broken", reason: `cannot read '${resolved}'` };
  if (!anchors.has(fragment)) {
    return { status: "broken", reason: `no heading anchor '#${fragment}' in '${resolved}'` };
  }
  return { status: "ok" };
}

/**
 * Resolves `target` relative to the directory holding `file`, using POSIX
 * semantics so results match Git's index on every platform. Returns null when
 * the result would leave the repository root.
 *
 * @param {string} file repository-relative path
 * @param {string} target relative path
 * @returns {string | null} normalized repository-relative path
 */
export function resolveRepositoryPath(file, target) {
  const base = file.split("/").slice(0, -1);
  const segments = [...base, ...target.split("/")];
  const stack = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (stack.length === 0) return null;
  return stack.join("/");
}
