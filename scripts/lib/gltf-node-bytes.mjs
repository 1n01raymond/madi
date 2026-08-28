/**
 * Measures where a compiled glTF document spends its bytes.
 *
 * The scanner streams the document instead of parsing it: a federation-scale
 * `scene.gltf` is hundreds of megabytes, and `JSON.parse` would cost several
 * gigabytes of heap to answer a question about byte counts. Bytes are charged
 * compact-equivalently -- whitespace outside strings is ignored -- so a
 * pretty-printed and a compact document of the same scene are comparable. A
 * member's key, its colon, its value, and the comma that follows it are all
 * charged to that member, because eliding the member removes all four.
 */

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/** Stack depth at which the objects of a measured top-level array live. */
const ELEMENT_DEPTH = 2;
/** Field values captured verbatim, to classify each node without parsing it. */
const CAPTURED_FIELDS = new Set([
  "matrix",
  "name",
  "extras.madi.occurrenceId",
  "extras.madi.prototypeId",
  "extras.madi.semanticId",
  "extras.madi.sourceRef",
  "extras.madi.tags",
  "extras.madi.initialVisibility",
]);
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const unquote = (value) => (
  value?.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : undefined
);

/** True when a serialized matrix differs from the identity only in translation. */
function isTranslationOnly(values) {
  return IDENTITY_MATRIX.every((expected, element) => (
    element >= 12 && element < 15 ? true : values[element] === expected
  ));
}

function classify(node, facts) {
  const matrix = node.matrix === undefined ? undefined : JSON.parse(node.matrix);
  if (matrix) {
    if (IDENTITY_MATRIX.every((expected, at) => matrix[at] === expected)) {
      facts.identityMatrix += 1;
    } else if (isTranslationOnly(matrix)) facts.translationOnlyMatrix += 1;
  }
  const prototypeId = unquote(node["extras.madi.prototypeId"]);
  const occurrenceId = unquote(node["extras.madi.occurrenceId"]);
  const semanticId = unquote(node["extras.madi.semanticId"]);
  const sourceRef = unquote(node["extras.madi.sourceRef"]);
  if (semanticId !== undefined && semanticId === `semantic:${prototypeId}`) {
    facts.semanticIdFromPrototypeId += 1;
  }
  if (sourceRef !== undefined && semanticId?.startsWith("semantic:")
    && sourceRef === `source:${semanticId.slice("semantic:".length)}`) {
    facts.sourceRefFromSemanticId += 1;
  }
  if (sourceRef !== undefined && sourceRef === `source:${occurrenceId}`) {
    facts.sourceRefFromOccurrenceId += 1;
  }
  if (node["extras.madi.tags"] === "[]") facts.emptyTags += 1;
  if (node["extras.madi.initialVisibility"] === "true") facts.defaultVisibility += 1;
  if (node.name !== undefined && node.name === node["extras.madi.occurrenceId"]) {
    facts.nameEqualsOccurrenceId += 1;
  }
}

/**
 * @param chunks async iterable of `Uint8Array`/`Buffer` holding the document.
 * @param arrayName top-level array whose elements are split per field.
 */
export async function measureGltfNodeBytes(chunks, arrayName = "nodes") {
  const stack = [];
  const fieldBytes = new Map();
  const topLevelBytes = new Map();
  const classBytes = { meshed: 0, meshless: 0 };
  const classCount = { meshed: 0, meshless: 0 };
  const distinctTagSets = new Set();
  const distinctNames = new Set();
  const facts = {
    identityMatrix: 0,
    translationOnlyMatrix: 0,
    meshless: 0,
    semanticIdFromPrototypeId: 0,
    sourceRefFromSemanticId: 0,
    sourceRefFromOccurrenceId: 0,
    emptyTags: 0,
    defaultVisibility: 0,
    nameEqualsOccurrenceId: 0,
  };
  let inString = false;
  let escaped = false;
  let readingKey = false;
  let token = [];
  let pendingKeyBytes = 0;
  let field;
  let rawBytes = 0;
  let compactBytes = 0;
  let elementCount = 0;
  let elementBytes = 0;
  let element = {};
  let captured = [];
  let capturedField;
  /** Stack depth the captured member was named at; its value nests deeper. */
  let capturedDepth = 0;

  const inArray = () => stack[0]?.key === arrayName && stack[1]?.type === "array";
  const fieldFor = () => {
    if (!inArray() || stack.length <= ELEMENT_DEPTH) return undefined;
    const member = stack[ELEMENT_DEPTH]?.key;
    if (member === undefined) return "(element punctuation)";
    if (member !== "extras") return member;
    // extras -> madi -> key; the envelope itself is charged on its own.
    const key = stack[ELEMENT_DEPTH + 2]?.key;
    return key === undefined ? "extras (envelope)" : `extras.madi.${key}`;
  };
  const flushCapture = () => {
    if (capturedField === undefined) return;
    const text = Buffer.from(captured).toString("utf8");
    const body = text.startsWith(":") ? text.slice(1) : text;
    element[capturedField] = body.endsWith(",") ? body.slice(0, -1) : body;
    captured = [];
    capturedField = undefined;
  };
  const refreshField = () => {
    const next = fieldFor();
    if (next === field) return;
    if (capturedField !== undefined && next !== capturedField) flushCapture();
    field = next;
    if (field === "mesh") element.mesh = true;
    if (field !== undefined && CAPTURED_FIELDS.has(field)) {
      capturedField = field;
      capturedDepth = stack.length;
    }
  };
  const charge = (count, byte) => {
    compactBytes += count;
    const top = stack[0]?.key ?? "(document)";
    topLevelBytes.set(top, (topLevelBytes.get(top) ?? 0) + count);
    if (field === undefined) return;
    fieldBytes.set(field, (fieldBytes.get(field) ?? 0) + count);
    elementBytes += count;
    // Bounded: a captured value is an identifier or a 16-number matrix.
    if (capturedField !== undefined && byte !== undefined && captured.length < 1024) {
      captured.push(byte);
    }
  };
  const finishElement = () => {
    elementCount += 1;
    const meshed = element.mesh === true;
    classBytes[meshed ? "meshed" : "meshless"] += elementBytes;
    classCount[meshed ? "meshed" : "meshless"] += 1;
    if (!meshed) facts.meshless += 1;
    if (element["extras.madi.tags"] !== undefined) {
      distinctTagSets.add(element["extras.madi.tags"]);
    }
    if (element.name !== undefined) distinctNames.add(element.name);
    classify(element, facts);
    elementBytes = 0;
    element = {};
  };

  for await (const chunk of chunks) {
    rawBytes += chunk.length;
    for (const byte of chunk) {
      if (inString) {
        if (readingKey) pendingKeyBytes += 1;
        else charge(1, byte);
        if (escaped) {
          escaped = false;
          token.push(byte);
          continue;
        }
        if (byte === BACKSLASH) {
          escaped = true;
          token.push(byte);
          continue;
        }
        if (byte === QUOTE) {
          inString = false;
          if (readingKey) {
            readingKey = false;
            const frame = stack[stack.length - 1];
            if (frame) frame.key = Buffer.from(token).toString("utf8");
            refreshField();
            // The key is charged to the member it names, not to the enclosing
            // object, so a field's cost includes the cost of naming it.
            charge(pendingKeyBytes);
            pendingKeyBytes = 0;
          }
          token = [];
          continue;
        }
        token.push(byte);
        continue;
      }
      if (WHITESPACE.has(byte)) continue;
      if (byte === QUOTE) {
        const frame = stack[stack.length - 1];
        inString = true;
        token = [];
        if (frame?.type === "object" && frame.key === undefined) {
          readingKey = true;
          pendingKeyBytes = 1;
        } else charge(1, byte);
        continue;
      }
      if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
        charge(1, byte);
        stack.push({ type: byte === OPEN_BRACE ? "object" : "array", key: undefined });
        refreshField();
        continue;
      }
      if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
        const closesElement = byte === CLOSE_BRACE
          && stack.length === ELEMENT_DEPTH + 1
          && inArray();
        // A closer deeper than the captured member belongs to its value; one at
        // its own depth closes the object the member lives in.
        charge(1, stack.length > capturedDepth ? byte : undefined);
        stack.pop();
        if (closesElement) {
          flushCapture();
          finishElement();
        }
        const frame = stack[stack.length - 1];
        if (frame?.type === "object") frame.key = undefined;
        refreshField();
        continue;
      }
      if (byte === COMMA) {
        charge(1, byte);
        const frame = stack[stack.length - 1];
        if (frame?.type === "object") {
          frame.key = undefined;
          refreshField();
        }
        continue;
      }
      charge(1, byte);
    }
  }
  flushCapture();

  const fields = [...fieldBytes.entries()]
    .map(([name, bytes]) => ({ field: name, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.field.localeCompare(b.field));
  const topLevel = [...topLevelBytes.entries()]
    .map(([member, bytes]) => ({ member, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.member.localeCompare(b.member));
  return {
    rawBytes,
    compactBytes,
    arrayName,
    elementCount,
    elementBytes: fields.reduce((sum, entry) => sum + entry.bytes, 0),
    fields,
    topLevel,
    classes: {
      meshed: { count: classCount.meshed, bytes: classBytes.meshed },
      meshless: { count: classCount.meshless, bytes: classBytes.meshless },
    },
    distinctTagSets: distinctTagSets.size,
    distinctNames: distinctNames.size,
    facts,
  };
}

/** 8 MiB, so a 400 MB document is never copied whole into a second buffer. */
const STRING_CHUNK_LENGTH = 8 * 1024 * 1024;

function* utf8Chunks(json) {
  let at = 0;
  while (at < json.length) {
    let end = Math.min(at + STRING_CHUNK_LENGTH, json.length);
    // Never split a surrogate pair: the halves would each encode as U+FFFD and
    // the byte count would drift from what the file on disk holds.
    const code = json.charCodeAt(end - 1);
    if (end < json.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    yield Buffer.from(json.slice(at, end), "utf8");
    at = end;
  }
}

/** Measures a document already held in memory as a string. */
export function measureGltfNodeBytesInString(json, arrayName = "nodes") {
  return measureGltfNodeBytes(utf8Chunks(json), arrayName);
}
